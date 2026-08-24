import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeConfigurationCursor,
  parseConfigurationCursor,
  nativeHttpBasePath,
  nativeHttpContractDocument,
  nativeHttpMediaType,
  nativeHttpRoutes,
  encodeInventoryCursor,
  parseInventoryCursor,
  parseConfigurationCreation,
  parseDraftCreation,
  parseDraftRevision,
  parsePartition,
  parseSubmission,
} from "../../src/adapters/http/contract.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";

test("the versioned route and media contracts move together", () => {
  assert.equal(nativeHttpBasePath, "/api/v1");
  assert.equal(nativeHttpMediaType, "application/vnd.chuggy.v1+json");
  assert.deepEqual(Object.values(nativeHttpRoutes), [
    "/api/v1/contract",
    "/api/v1/projects",
    "/api/v1/tenants/:tenant/projects/:project",
    "/api/v1/tenants/:tenant/projects/:project/tickets",
    "/api/v1/tenants/:tenant/projects/:project/tickets/:ticket",
    "/api/v1/tenants/:tenant/projects/:project/operational-status",
    "/api/v1/tenants/:tenant/projects/:project/selector-context",
    "/api/v1/tenants/:tenant/projects/:project/executions",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution/artifacts/:ordinal",
    "/api/v1/tenants/:tenant/projects/:project/operations",
    "/api/v1/tenants/:tenant/projects/:project/operations/:operation",
    "/api/v1/tenants/:tenant/projects/:project/notifications",
    "/api/v1/tenants/:tenant/projects/:project/configurations",
    "/api/v1/tenants/:tenant/projects/:project/configurations/:revision",
    "/api/v1/tenants/:tenant/projects/:project/drafts",
    "/api/v1/tenants/:tenant/projects/:project/drafts/:ticket",
    "/api/v1/tenants/:tenant/projects/:project/dispatch-view",
  ]);
});

test("the frontend contract is generated from the checked request schemas", () => {
  const document = nativeHttpContractDocument() as {
    schemas: { publicMutation: { oneOf: unknown[] } };
    notifications: string;
    caching: string;
  };
  assert.ok(document.schemas.publicMutation.oneOf.length > 0);
  assert.equal(document.notifications, "bounded-polling");
  assert.equal(document.caching, "no-store");
});

const authoring = {
  dependencies: [1, 2],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: { type: "Budgeted", value: 1 },
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
} as const;

test("authoring DTOs translate into existing application types", () => {
  assert.deepEqual(
    parseConfigurationCreation({
      revision: "revision",
      canonical: '{"image":"worker:v1","version":1}',
    }),
    {
      revision: "revision",
      canonical: '{"image":"worker:v1","version":1}',
    },
  );
  assert.deepEqual(
    parseDraftCreation({ configurationRevision: "revision", authoring }),
    {
      configurationRevision: "revision",
      authoring: {
        deps: new Set([1, 2]),
        prog: authoring.program,
        workFanout: 1,
        reworkPolicy: authoring.reworkPolicy,
        finalizationPricing: authoring.finalizationPricing,
        resumePricing: "RetryCharged",
        finalizer: "ManagedFinalizer",
      },
    },
  );
  assert.equal(
    parseDraftRevision({
      expectedVersion: 3,
      configurationRevision: "revision",
      authoring,
    }).expectedVersion,
    3,
  );
});

test("authoring DTOs reject duplicates, unknown fields, and noncanonical config", () => {
  assert.throws(() =>
    parseDraftCreation({
      configurationRevision: "revision",
      authoring: { ...authoring, dependencies: [1, 1] },
    }),
  );
  assert.throws(() =>
    parseDraftCreation({
      configurationRevision: "revision",
      authoring: { ...authoring, hidden: true },
    }),
  );
  assert.throws(() =>
    parseConfigurationCreation({
      revision: "revision",
      canonical: '{"version":1,"image":"worker:v1"}',
    }),
  );
});

test("partition identities remain opaque strings", () => {
  assert.deepEqual(parsePartition("tenant/one", "project two"), {
    tenant: "tenant/one",
    project: "project two",
  });
});

test("inventory cursors are opaque, canonical, and round trip", () => {
  const partition = parsePartition("tenant/one", "project two");
  const cursor = encodeInventoryCursor(partition);
  assert.deepEqual(parseInventoryCursor(cursor), partition);
  assert.throws(() => parseInventoryCursor(`${cursor}=`));
  assert.throws(() => parseInventoryCursor("not-json"));
});

test("configuration cursors preserve the stable newest-first key", () => {
  const after = {
    createdAt: asPublicInstant("2026-08-24T12:00:00Z"),
    revision: asConfigurationRevisionId("revision-2"),
  };
  const partition = parsePartition("tenant", "project");
  const cursor = encodeConfigurationCursor(partition, after);
  assert.deepEqual(parseConfigurationCursor(cursor, partition), after);
  assert.throws(() =>
    parseConfigurationCursor(cursor, parsePartition("tenant", "other")),
  );
  assert.throws(() => parseConfigurationCursor(`${cursor}=`, partition));
  assert.throws(() => parseConfigurationCursor("not-json", partition));
  const invalidTimestamp = Buffer.from(
    JSON.stringify({
      version: 1,
      tenant: "tenant",
      project: "project",
      createdAt: "not-a-timestamp",
      revision: "revision-a",
    }),
  ).toString("base64url");
  assert.throws(() => parseConfigurationCursor(invalidTimestamp, partition));
});

test("a purpose-specific mutation becomes its one application command", () => {
  assert.deepEqual(
    parseSubmission("operation", "Key", {
      mutation: "RevokeTicket",
      ticket: 7,
    }),
    {
      operation: "operation",
      key: "Key",
      command: {
        version: 1,
        command: "Decide",
        event: { type: "Revoke", value: 7 },
      },
    },
  );
});

test("the public mutation union rejects internal commands and unknown fields", () => {
  assert.throws(() =>
    parseSubmission("operation", "key", {
      mutation: "TaskDone",
      ticket: 1,
      task: 1,
    }),
  );
  assert.throws(() =>
    parseSubmission("operation", "key", {
      mutation: "ManualDispatch",
      ticket: 1,
      expectedTicketVersion: 2,
      priority: "Safety",
    }),
  );
});

test("submission identities retain their owning normalization and bounds", () => {
  assert.equal(
    parseSubmission("operation", "e\u0301", {
      mutation: "ResumeTicket",
      ticket: 3,
    }).key,
    "é",
  );
  assert.throws(() =>
    parseSubmission("", "key", { mutation: "ResumeTicket", ticket: 3 }),
  );
});
