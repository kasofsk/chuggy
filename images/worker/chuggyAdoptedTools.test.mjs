import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolHandler,
  sessionCapabilityTools,
} from "./chuggyTools.mjs";

const task = {
  tenant: "tenant",
  project: "project",
  api: { url: "https://api.invalid" },
};

function adoptedTools(capabilities) {
  const calls = [];
  const context = chuggyToolContext(task, "bearer", {
    capabilities,
    turn: () => "turn-1",
    request: async (_task, _bearer, path, init) => {
      calls.push({ path, init });
      return {
        status: 200,
        text: () =>
          Promise.resolve(
            path.endsWith("/tickets") && init.method === "GET"
              ? '{"tickets":[{"ticket":7,"revision":2,"state":"Pending","dependencies":[],"workCyclesStarted":0}]}'
              : '{"identity":"accepted","accepted":"Accepted"}',
          ),
      };
    },
  });
  const tools = new Map(
    chuggyToolDefinitions(context).map((definition) => [
      definition.name,
      chuggyToolHandler(definition, z),
    ]),
  );
  return { calls, call: (name, args) => tools.get(name)(args) };
}

test("standard authoring capabilities expose only adopted ticket mutations", () => {
  assert.deepEqual(sessionCapabilityTools.DraftOriginate, ["create_ticket"]);
  assert.deepEqual(sessionCapabilityTools.DraftAuthor, [
    "update_ticket",
    "dispatch_ticket",
    "revoke_ticket",
    "resume_ticket",
  ]);
});

test("ticket YAML authoring carries its catalog pin and stable identity", async () => {
  const tools = adoptedTools(["DraftOriginate", "DraftAuthor"]);
  await tools.call("create_ticket", {
    source: "version: 2\ntitle: Work\n",
    catalogCommit: "a".repeat(40),
    repository: "repository",
  });
  await tools.call("update_ticket", {
    ticket: 7,
    expectedRevision: 2,
    source: "version: 2\ntitle: Revised\n",
    catalogCommit: "b".repeat(40),
  });

  assert.deepEqual(
    tools.calls.map(({ path, init }) => ({
      path,
      method: init.method,
      contentType: init.headers["content-type"],
      catalog: init.headers["x-chug-catalog-commit"],
      hasIdentity: init.headers["idempotency-key"].startsWith("session-"),
    })),
    [
      {
        path: "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets",
        method: "POST",
        contentType: "application/yaml",
        catalog: "a".repeat(40),
        hasIdentity: true,
      },
      {
        path: "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets/7",
        method: "PUT",
        contentType: "application/yaml",
        catalog: "b".repeat(40),
        hasIdentity: true,
      },
    ],
  );
});

test("adopted lifecycle tools and operation polling use ticket-machine routes", async () => {
  const tools = adoptedTools(["ProjectRead", "DraftAuthor"]);
  await tools.call("read_ticket", { ticket: 7 });
  await tools.call("dispatch_ticket", {
    ticket: 7,
    repository: "repository",
    commit: "c".repeat(40),
  });
  await tools.call("revoke_ticket", { ticket: 7 });
  await tools.call("resume_ticket", { ticket: 7 });
  await tools.call("read_operation", { operation: "opaque/id" });

  assert.deepEqual(
    tools.calls.map(({ path, init }) => [init.method, path]),
    [
      ["GET", "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets"],
      [
        "POST",
        "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets/7/dispatch",
      ],
      [
        "POST",
        "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets/7/revoke",
      ],
      [
        "POST",
        "/api/v1/tenants/tenant/projects/project/ticket-machine/tickets/7/resume",
      ],
      [
        "GET",
        "/api/v1/tenants/tenant/projects/project/ticket-machine/operations?identity=opaque%2Fid",
      ],
    ],
  );
});
