import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpRoutes,
  encodeInventoryCursor,
  parseInventoryCursor,
  parsePartition,
  parseSubmission,
} from "../../src/adapters/http/contract.ts";

test("the versioned route and media contracts move together", () => {
  assert.equal(nativeHttpBasePath, "/api/v1");
  assert.equal(nativeHttpMediaType, "application/vnd.chuggy.v1+json");
  assert.deepEqual(Object.values(nativeHttpRoutes), [
    "/api/v1/projects",
    "/api/v1/tenants/:tenant/projects/:project",
    "/api/v1/tenants/:tenant/projects/:project/operations",
    "/api/v1/tenants/:tenant/projects/:project/operations/:operation",
    "/api/v1/tenants/:tenant/projects/:project/notifications",
  ]);
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
