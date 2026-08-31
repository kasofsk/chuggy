import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpContractDocument } from "../../src/contract/document.ts";
import {
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  encodeConfigurationCursor,
  parseConfigurationCursor,
  encodeExecutionCursor,
  encodeInventoryCursor,
  encodeNativeActionCursor,
  encodeTicketActivityCursor,
  parseExecutionCursor,
  parseInventoryCursor,
  parseNativeActionCursor,
  parseTicketActivityCursor,
  parseConfigurationCreation,
  parseRepositoryConfigurationImport,
  parseDraftCreation,
  parseDraftRevision,
  parsePartition,
  parseSubmission,
} from "../../src/adapters/http/contract.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import { checkedExecutionListQuery } from "../../src/interpreter/operationsView.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { id } from "../domain/fixtures.ts";

test("the versioned route and media contracts move together", () => {
  assert.equal(nativeHttpBasePath, "/api/v1");
  assert.equal(nativeHttpMediaType, "application/vnd.chuggy.v1+json");
  assert.deepEqual(Object.values(nativeHttpRoutes), [
    "/api/v1/contract",
    "/api/v1/installation",
    "/api/v1/projects",
    "/api/v1/tenants/:tenant/projects/:project",
    "/api/v1/tenants/:tenant/projects/:project/tickets",
    "/api/v1/tenants/:tenant/projects/:project/tickets/:ticket",
    "/api/v1/tenants/:tenant/projects/:project/tickets/:ticket/native-actions",
    "/api/v1/tenants/:tenant/projects/:project/native-actions",
    "/api/v1/tenants/:tenant/projects/:project/operational-status",
    "/api/v1/tenants/:tenant/projects/:project/selector-context",
    "/api/v1/tenants/:tenant/projects/:project/selector-settings",
    "/api/v1/tenants/:tenant/projects/:project/selector-settings/history",
    "/api/v1/tenants/:tenant/projects/:project/executions",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution/artifacts/:ordinal",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/turns",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/transcript",
    "/api/v1/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/configuration",
    "/api/v1/tenants/:tenant/projects/:project/operations",
    "/api/v1/tenants/:tenant/projects/:project/operations/:operation",
    "/api/v1/tenants/:tenant/projects/:project/notifications",
    "/api/v1/tenants/:tenant/projects/:project/events",
    "/api/v1/tenants/:tenant/projects/:project/configurations",
    "/api/v1/tenants/:tenant/projects/:project/configurations/imports",
    "/api/v1/tenants/:tenant/projects/:project/configurations/:revision",
    "/api/v1/tenants/:tenant/projects/:project/drafts",
    "/api/v1/tenants/:tenant/projects/:project/draft-initializations/:revision",
    "/api/v1/tenants/:tenant/projects/:project/drafts/:ticket",
    "/api/v1/tenants/:tenant/projects/:project/dispatch-view",
  ]);
});

test("the frontend contract is generated from the checked request schemas", () => {
  const document = nativeHttpContractDocument() as {
    schemas: { publicMutation: { oneOf: unknown[] } };
    notifications: string;
    events: string;
    caching: string;
  };
  assert.ok(document.schemas.publicMutation.oneOf.length > 0);
  assert.equal(document.notifications, "bounded-polling");
  assert.equal(document.events, "sse");
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

const brief = {
  intent: "Serve the brief on the ticket resource.",
  links: ["https://example.test/issues/340"],
  branch: "refs/heads/rt/ticket-brief",
  finalization: { mode: "PullRequest", target: "refs/heads/main" },
} as const;

test("authoring DTOs translate into existing application types", () => {
  assert.equal(
    parseRepositoryConfigurationImport({ commit: "a".repeat(40) }),
    "a".repeat(40),
  );
  assert.throws(
    () =>
      parseRepositoryConfigurationImport({
        commit: "a".repeat(40),
        repository: "untrusted",
      }),
    /[Uu]nrecognized key/u,
  );
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
    parseDraftCreation({
      configurationRevision: "revision",
      configurationDigest: "a".repeat(64),
      expectedProjectSequence: 7,
      authoring,
      brief,
    }),
    {
      configurationRevision: "revision",
      configurationDigest: "a".repeat(64),
      expectedProjectSequence: 7,
      authoring: {
        deps: new Set([1, 2]),
        prog: authoring.program,
        workFanout: 1,
        reworkPolicy: authoring.reworkPolicy,
        finalizationPricing: authoring.finalizationPricing,
        resumePricing: "RetryCharged",
        finalizer: "ManagedFinalizer",
      },
      brief: {
        intent: "Serve the brief on the ticket resource.",
        links: ["https://example.test/issues/340"],
        branch: "refs/heads/rt/ticket-brief",
        finalization: { mode: "PullRequest", target: "refs/heads/main" },
      },
    },
  );
  assert.equal(
    parseDraftRevision({
      expectedVersion: 3,
      configurationRevision: "revision",
      authoring,
      brief,
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

test("execution cursors carry the history position, not an identity", () => {
  const partition = parsePartition("tenant", "project");
  const position = { ticket: id(21), task: asTaskId(8) };
  const cursor = encodeExecutionCursor(partition, position);
  assert.deepEqual(parseExecutionCursor(cursor, partition), position);
  assert.throws(() =>
    parseExecutionCursor(cursor, parsePartition("tenant", "other")),
  );
  assert.throws(() => parseExecutionCursor(`${cursor}=`, partition));
  assert.throws(() => parseExecutionCursor("not-json", partition));
  const identity = Buffer.from(
    JSON.stringify({
      version: 1,
      tenant: "tenant",
      project: "project",
      execution: "execution-b0a1-8",
    }),
  ).toString("base64url");
  assert.throws(() => parseExecutionCursor(identity, partition));
});

/** Both directions, because each answers with something a reader would believe:
 * an earlier cursor restarts the selected ticket, a later one empties it. */
test("a query is refused a cursor resuming a ticket it does not select", () => {
  const at = { ticket: id(21), task: asTaskId(8) };
  assert.deepEqual(
    checkedExecutionListQuery({ after: at, ticket: id(21), limit: 10 }).after,
    at,
  );
  assert.deepEqual(
    checkedExecutionListQuery({ after: at, limit: 10 }).after,
    at,
  );
  assert.throws(
    () => checkedExecutionListQuery({ after: at, ticket: id(22), limit: 10 }),
    RangeError,
  );
  assert.throws(
    () => checkedExecutionListQuery({ after: at, ticket: id(20), limit: 10 }),
    RangeError,
  );
});

test("ticket activity cursors bind the composite position to one project", () => {
  const partition = parsePartition("tenant", "project");
  const position = { sequence: 7, ticket: id(3) };
  const cursor = encodeTicketActivityCursor(partition, position);
  assert.deepEqual(parseTicketActivityCursor(cursor, partition), position);
  assert.throws(() =>
    parseTicketActivityCursor(cursor, parsePartition("tenant", "other")),
  );
  assert.throws(() => parseTicketActivityCursor(`${cursor}=`, partition));
});

test("native action cursors bind the fence and its tie-breaker to one project", () => {
  const partition = parsePartition("tenant", "project");
  const position = { authorizingSequence: 7, action: "escalation" };
  const cursor = encodeNativeActionCursor(partition, position);
  assert.deepEqual(parseNativeActionCursor(cursor, partition), position);
  assert.throws(() =>
    parseNativeActionCursor(cursor, parsePartition("tenant", "other")),
  );
  assert.throws(() => parseNativeActionCursor(`${cursor}=`, partition));
  assert.throws(() => parseNativeActionCursor("not-json", partition));
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

test("a brief the interpreter would refuse never reaches a draft", () => {
  const creation = {
    configurationRevision: "revision",
    configurationDigest: "a".repeat(64),
    expectedProjectSequence: 7,
    authoring,
  };
  for (const refused of [
    { intent: "", links: [] },
    { intent: "Fix it.\u0007", links: [] },
    { intent: "Fix it.", links: ["http://example.test/one"] },
    { intent: "Fix it.", links: [], branch: "rt/ticket-brief" },
    { intent: "Fix it.", links: [], branch: "refs/heads/one..two" },
    { intent: "Fix it.", links: [], branch: "refs/heads/one.lock" },
    {
      intent: "Fix it.",
      links: [],
      finalization: { mode: "Push", target: "refs/heads/one..two" },
    },
  ])
    assert.throws(
      () => parseDraftCreation({ ...creation, brief: refused }),
      `a brief is refused: ${JSON.stringify(refused)}`,
    );
  assert.deepEqual(
    parseDraftCreation({
      ...creation,
      brief: { intent: "Fix it.", links: [] },
    }).brief,
    { intent: "Fix it.", links: [] },
  );
});
