import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  createNativeHttpApp,
  type NativeHttpLimits,
} from "../../src/adapters/http/server.ts";
import {
  asPrincipal,
  asPublicInstant,
  type NativeWeb,
  type TicketNativeAction,
} from "../../src/interpreter/nativeWeb.ts";
import {
  projectNativeActionsResponseSchema,
  ticketNativeActionsResponseSchema,
} from "../../src/contract/responses.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { resolvedSelectorSettings } from "../../src/interpreter/selector.ts";
import type {
  SelectorProjectSettingsAdministration,
  SelectorProjectSettingsRecord,
} from "../../src/interpreter/selectorProjectSettings.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  asInstallationId,
  asTaskId,
  asTicketId,
} from "../../src/domain/ids.ts";
import {
  encodeDraftCursor,
  encodeExecutionCursor,
  parsePartition,
} from "../../src/adapters/http/contract.ts";
import { unreadableLeadReads } from "./leadReadFixtures.ts";
import { twoBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  asSessionId,
  sessionBearerPrefix,
} from "../../src/interpreter/agentSession.ts";
import { unservedLeadInquiries, unservedThreads } from "./threadFixtures.ts";

const authority = {
  installationAuthority: () =>
    Promise.resolve(asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab")),
};

/**
 * What the app takes, read from the app rather than restated here: a suite
 * holding its own copy of that roster is a second place for it to drift, and
 * the boundary gains a method every slice or two.
 */
type ServedNativeWeb = Parameters<typeof createNativeHttpApp>[0];

function fakeTicket(calls: string[]): NativeWeb["ticket"] {
  return (_principal, _partition, ticket) => {
    calls.push(`ticket:${String(ticket)}`);
    return Promise.resolve({
      ticket,
      phase: "Working",
      sequence: 4,
      releasedAt: asPublicInstant("2026-01-01T00:00:00Z"),
      changedAt: asPublicInstant("2026-01-01T00:00:04Z"),
    });
  };
}

/** One ticket per kind, one whose action was resolved, and one that never existed. */
const nativeActionsByTicket = new Map<number, readonly TicketNativeAction[]>([
  [
    1,
    [
      {
        action: "escalation",
        kind: "TicketEscalation",
        authorizingSequence: 11,
        admits: ["Resume", "Revoke"],
      },
    ],
  ],
  [
    2,
    [
      {
        action: "handoff",
        kind: "HandoffBlock",
        authorizingSequence: 12,
        admits: ["RetryHandoff", "AbandonHandoff"],
      },
    ],
  ],
  [
    3,
    [
      {
        action: "approval",
        kind: "FinalizationApproval",
        authorizingSequence: 13,
        admits: ["Approve", "Decline"],
      },
    ],
  ],
  [4, []],
]);

function fakeTicketNativeActions(
  calls: string[],
): NativeWeb["ticketNativeActions"] {
  return (_principal, _partition, ticket) => {
    calls.push(`nativeActions:${String(ticket)}`);
    return Promise.resolve(nativeActionsByTicket.get(ticket));
  };
}

/** One page of a project's open actions, with a cursor position to encode. */
function fakeNativeActions(calls: string[]): NativeWeb["nativeActions"] {
  return (_principal, _partition, query) => {
    calls.push(
      `nativeActionsPage:${String(query.limit)}:${query.after?.action ?? ""}`,
    );
    const listed = [...nativeActionsByTicket].flatMap(([ticket, actions]) =>
      actions.map((action) => ({ ticket: asTicketId(ticket), ...action })),
    );
    return Promise.resolve({
      result: "Authorized",
      value: {
        actions: listed,
        ...(query.after === undefined
          ? { nextAfter: { authorizingSequence: 13, action: "approval" } }
          : {}),
      },
    });
  };
}

function fakeOperations(
  calls: string[],
): Pick<
  NativeWeb,
  | "operationalStatus"
  | "selectorOperationalContext"
  | "executions"
  | "execution"
  | "outputContent"
  | "runTurns"
  | "runTranscript"
  | "runConfiguration"
> {
  return {
    selectorOperationalContext: () => {
      calls.push("selectorOperationalContext");
      return Promise.resolve({ result: "NotFound" });
    },
    operationalStatus: () => {
      calls.push("operationalStatus");
      return Promise.resolve({ result: "NotFound" });
    },
    executions: (_principal, _partition, query) => {
      const after =
        query.after === undefined
          ? ""
          : `${String(query.after.ticket)}.${String(query.after.task)}`;
      calls.push(
        `executions:${String(query.limit)}:${String(query.ticket ?? "")}:${after}`,
      );
      return Promise.resolve({ result: "NotFound" });
    },
    execution: (_principal, _partition, execution) => {
      calls.push(`execution:${execution}`);
      return Promise.resolve(undefined);
    },
    outputContent: (_principal, _partition, execution, ordinal) => {
      calls.push(`output:${execution}:${String(ordinal)}`);
      return Promise.resolve({ read: "NotFound" });
    },
    runTurns: (_principal, _partition, execution, attempt, query) => {
      calls.push(`runTurns:${execution}:${attempt}:${String(query.limit)}`);
      return Promise.resolve(undefined);
    },
    runTranscript: (_principal, _partition, execution, attempt, after) => {
      calls.push(`runTranscript:${execution}:${attempt}:${String(after)}`);
      return Promise.resolve({ read: "NotFound" });
    },
    runConfiguration: (_principal, _partition, execution, attempt) => {
      calls.push(`runConfiguration:${execution}:${attempt}`);
      return Promise.resolve({ read: "NotFound" });
    },
  };
}

function fakeConfigurations(
  calls: string[],
): Pick<
  NativeWeb,
  | "configuration"
  | "configurations"
  | "createConfiguration"
  | "importRepositoryConfigurations"
> {
  return {
    configuration: (_principal, _partition, revision) => {
      calls.push(`configuration:${revision}`);
      return Promise.resolve(undefined);
    },
    configurations: (_principal, _partition, query) => {
      calls.push(`configurations:${String(query.limit)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    createConfiguration: (_principal, input) => {
      calls.push(`createConfiguration:${input.revision}`);
      return Promise.resolve({ result: "NotFound" });
    },
    importRepositoryConfigurations: (_principal, _partition, commit) => {
      calls.push(`importRepositoryConfigurations:${commit}`);
      return Promise.resolve({ result: "Imported" });
    },
  };
}

function fakeDrafts(
  calls: string[],
): Pick<
  NativeWeb,
  | "createDraft"
  | "initializeDraft"
  | "deleteDraft"
  | "reviseDraft"
  | "draft"
  | "drafts"
> {
  return {
    createDraft: () => {
      calls.push("createDraft");
      return Promise.resolve({ result: "NotFound" });
    },
    initializeDraft: () => {
      calls.push("initializeDraft");
      return Promise.resolve({ result: "NotFound" });
    },
    deleteDraft: (_principal, input) => {
      calls.push(`deleteDraft:${String(input.expectedVersion)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    reviseDraft: (_principal, input) => {
      calls.push(`reviseDraft:${String(input.expectedVersion)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    draft: (_principal, _partition, ticket) => {
      calls.push(`draft:${String(ticket)}`);
      return Promise.resolve(undefined);
    },
    drafts: (_principal, _partition, query) => {
      calls.push(`drafts:${String(query.cursor)}:${String(query.limit)}`);
      return Promise.resolve({ result: "NotFound" });
    },
  };
}

function fakeWeb(calls: string[]): ServedNativeWeb {
  return {
    ...unreadableLeadReads(),
    ...unservedThreads,
    ...unservedLeadInquiries,
    ...fakeOperations(calls),
    ...fakeConfigurations(calls),
    ...fakeDrafts(calls),
    cancel: (_principal, _partition, operation) => {
      calls.push(`cancel:${operation}`);
      return Promise.resolve({ result: "NotFound" });
    },
    dispatchView: (_principal, _partition, query) => {
      calls.push(`dispatchView:${String(query.limit)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    notifications: (_principal, _partition, cursor) => {
      calls.push(
        `notifications:${String(cursor.after)}:${String(cursor.limit)}`,
      );
      return Promise.resolve({
        result: "Authorized",
        value: { result: "Events", cursor: cursor.after, events: [] },
      });
    },
    operation: (_principal, _partition, operation) => {
      calls.push(`operation:${operation}`);
      return Promise.resolve({
        operation,
        acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        state: "Pending",
      });
    },
    project: (_principal, _partition, query) => {
      calls.push(
        `project:${String(query.limit)}:${query.order ?? "Identity"}:${String(query.recentActivityAfter?.sequence ?? "")}`,
      );
      return Promise.resolve({ result: "NotFound" });
    },
    projectInventory: (_principal, _after, limit) => {
      calls.push(`inventory:${String(limit)}`);
      return Promise.resolve({ projects: [] });
    },
    submit: (_principal, submission) => {
      const via =
        submission.viaSession === undefined
          ? ""
          : `:via:${String(submission.viaSession)}`;
      calls.push(`submit:${submission.command.command}${via}`);
      return Promise.resolve({
        result: "Authorized",
        acceptance: { accepted: "InvalidCommand" },
      });
    },
    ticket: fakeTicket(calls),
    ticketNativeActions: fakeTicketNativeActions(calls),
    nativeActions: fakeNativeActions(calls),
  };
}

const selectorPartition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

const selectorDefaults = {
  revision: 3,
  mode: "Running",
  dispatchMode: "ApprovalRequired",
  basePrompt: "Select at most one currently dispatchable ticket.",
  modelAllowlist: ["*"],
  toolAllowlist: ["*"],
  limits: {
    tokensPerDecision: 8192,
    millisecondsPerDecision: 120_000,
    toolCallsPerDecision: 20,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
} as const;

function selectorRecord(
  revision: number,
  northStar?: string,
): SelectorProjectSettingsRecord {
  const overrides = northStar === undefined ? {} : { northStar };
  return {
    partition: selectorPartition,
    revision,
    overrides,
    effective: resolvedSelectorSettings(
      selectorPartition,
      selectorDefaults,
      revision,
      overrides,
    ),
  };
}

function fakeSelectorSettings(
  calls: string[],
): SelectorProjectSettingsAdministration {
  return {
    read: () => {
      calls.push("selector-settings:read");
      return Promise.resolve({
        result: "Found",
        settings: selectorRecord(1, "Ship the console."),
      });
    },
    write: (_principal, _partition, expectedRevision, overrides) => {
      calls.push(
        `selector-settings:write:${String(expectedRevision)}:${String(overrides.northStar)}`,
      );
      if (overrides.dispatchMode === "Automatic")
        return Promise.resolve({
          result: "Refused",
          refusal: "AutomaticDispatchUnavailable",
        });
      if (overrides.basePrompt === "contend")
        return Promise.resolve({
          result: "Refused",
          refusal: "SettingsWriteContended",
        });
      return expectedRevision === 1
        ? Promise.resolve({
            result: "Written",
            settings: selectorRecord(2, overrides.northStar),
          })
        : Promise.resolve({
            result: "Conflict",
            settings: selectorRecord(1, "Ship the console."),
          });
    },
    history: (_principal, _partition, after, limit) => {
      calls.push(`selector-settings:history:${String(after)}:${String(limit)}`);
      return Promise.resolve({ result: "Found", revisions: [] });
    },
  };
}

function appOf(
  calls: string[],
  authenticated = true,
  limits?: NativeHttpLimits,
) {
  return createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          authenticated && token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: asPrincipal("issuer\u0000subject") },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    authority,
    limits,
    undefined,
    fakeSelectorSettings(calls),
  );
}

const selectorSettingsPath =
  "/api/v1/tenants/acme/projects/atlas/selector-settings";

test("a project's selector settings are read, written and historied", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const headers = { authorization: "Bearer valid" };
  const found = await app.inject({
    method: "GET",
    url: selectorSettingsPath,
    headers,
  });
  assert.equal(found.statusCode, 200);
  assert.equal(
    found.json<{ effective: { northStar?: string } }>().effective.northStar,
    "Ship the console.",
  );
  const written = await app.inject({
    method: "PUT",
    url: selectorSettingsPath,
    headers: {
      ...headers,
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({
      expectedRevision: 1,
      overrides: { northStar: "Land the panel." },
    }),
  });
  assert.equal(written.statusCode, 200);
  assert.equal(written.json<{ revision: number }>().revision, 2);
  const listed = await app.inject({
    method: "GET",
    url: `${selectorSettingsPath}/history?after=1&limit=10`,
    headers,
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(calls, [
    "selector-settings:read",
    "selector-settings:write:1:Land the panel.",
    "selector-settings:history:1:10",
  ]);
});

test("a settings write that lost its fence is a conflict rather than a rewrite", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    method: "PUT",
    url: selectorSettingsPath,
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({ expectedRevision: 9, overrides: {} }),
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    "SettingsRevisionConflict",
  );
});

test("automatic dispatch with no ready host is a refusal the caller can act on", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    method: "PUT",
    url: selectorSettingsPath,
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({
      expectedRevision: 1,
      overrides: { dispatchMode: "Automatic" },
    }),
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    "AutomaticDispatchUnavailable",
  );
});

test("a settings write that lost a race for its project is retryable", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    method: "PUT",
    url: selectorSettingsPath,
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({
      expectedRevision: 1,
      overrides: { basePrompt: "contend" },
    }),
  });
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.headers["retry-after"], "1");
  const envelope = refused.json<HttpErrorEnvelope>();
  assert.equal(envelope.error.code, "SettingsWriteContended");
  assert.equal(envelope.error.message, "The request can be retried.");
});

test("a settings body naming a field the wire does not is refused", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    method: "PUT",
    url: selectorSettingsPath,
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({
      expectedRevision: 1,
      overrides: { concurrentDecisions: 9 },
    }),
  });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(calls, []);
});

test("authentication failure never reaches NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({ method: "GET", url: "/api/v1/projects" });
  assert.equal(found.statusCode, 401);
  assert.equal(found.headers["www-authenticate"], "Bearer");
  assert.equal(found.headers["cache-control"], "no-store");
  assert.deepEqual(calls, []);
});

test("installation authority is a public read-only bootstrap resource", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, false);
  const found = await app.inject({
    method: "GET",
    url: "/api/v1/installation",
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), {
    installation: "018f84a1-4c2b-7def-8abc-0123456789ab",
  });
  assert.deepEqual(calls, []);
});

test("health is separate from authenticated product routes", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, false);
  assert.equal((await app.inject({ url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 200);
  const contract = await app.inject({ url: "/api/v1/contract" });
  assert.equal(contract.statusCode, 200);
  assert.equal(contract.headers["cache-control"], "no-cache");
  assert.deepEqual(calls, []);
});

test("valid submission reaches only the NativeWeb submission method", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      operation: "operation",
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 422);
  assert.deepEqual(calls, ["submit:Decide"]);
});

test("malformed mutation is rejected before NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      operation: asOperationId("operation"),
      mutation: { mutation: "TaskDone", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 400);
  assert.deepEqual(calls, []);
});

test("mutation submission requires the versioned request media type", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/json",
    },
    body: {
      operation: "operation",
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 415);
  assert.deepEqual(calls, []);
});

test("polling queries apply defaults and reject noncanonical integers", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/notifications";
  assert.equal(
    (
      await app.inject({
        url: root,
        headers: { authorization: "Bearer valid" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: `${root}?after=01`,
        headers: { authorization: "Bearer valid" },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(calls, ["notifications:0:50"]);
});

test("unknown query fields and oversized bodies fail before NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const headers = { authorization: "Bearer valid" };
  assert.equal(
    (await app.inject({ url: "/api/v1/projects?offset=1", headers }))
      .statusCode,
    400,
  );
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      ...headers,
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({ padding: "x".repeat(70_000) }),
  });
  assert.equal(found.statusCode, 413);
  assert.deepEqual(calls, []);
});

test("ticket phase filters and detail are parsed before NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/tickets";
  const headers = { authorization: "Bearer valid" };
  assert.equal(
    (
      await app.inject({
        url: `${root}?phase=Pending&phase=Escalated&limit=7`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `${root}?phase=NonTerminal`, headers }))
      .statusCode,
    404,
  );
  const detail = await app.inject({ url: `${root}/3`, headers });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json(), {
    ticket: 3,
    phase: "Working",
    sequence: 4,
    releasedAt: "2026-01-01T00:00:00Z",
    changedAt: "2026-01-01T00:00:04Z",
  });
  assert.equal(
    (await app.inject({ url: `${root}?phase=Unknown`, headers })).statusCode,
    400,
  );
  assert.deepEqual(calls, [
    "project:7:Identity:",
    "project:50:Identity:",
    "ticket:3",
  ]);
});

test("a ticket's open actions answer per kind with the fence and the answers", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/tickets";
  const headers = { authorization: "Bearer valid" };
  const listed = async (ticket: number) => {
    const found = await app.inject({
      url: `${root}/${String(ticket)}/native-actions`,
      headers,
    });
    assert.equal(found.statusCode, 200);
    return ticketNativeActionsResponseSchema.parse(found.json()).actions;
  };
  assert.deepEqual(await listed(1), [
    {
      action: "escalation",
      kind: "TicketEscalation",
      authorizingSequence: 11,
      admits: ["Resume", "Revoke"],
    },
  ]);
  assert.deepEqual(await listed(2), [
    {
      action: "handoff",
      kind: "HandoffBlock",
      authorizingSequence: 12,
      admits: ["RetryHandoff", "AbandonHandoff"],
    },
  ]);
  assert.deepEqual(await listed(3), [
    {
      action: "approval",
      kind: "FinalizationApproval",
      authorizingSequence: 13,
      admits: ["Approve", "Decline"],
    },
  ]);
  assert.deepEqual(await listed(4), []);
  assert.deepEqual(calls, [
    "nativeActions:1",
    "nativeActions:2",
    "nativeActions:3",
    "nativeActions:4",
  ]);
});

test("an unreadable ticket's actions are a not-found, and a bad identity a fault", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/tickets";
  const headers = { authorization: "Bearer valid" };
  const concealed = await app.inject({
    url: `${root}/9/native-actions`,
    headers,
  });
  assert.equal(concealed.statusCode, 404);
  assert.equal(concealed.json<HttpErrorEnvelope>().error.code, "NotFound");
  assert.equal(
    (await app.inject({ url: `${root}/0/native-actions`, headers })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: `${root}/9/native-actions` })).statusCode,
    401,
  );
  assert.deepEqual(calls, ["nativeActions:9"]);
});

test("a project's open actions page behind an opaque cursor of its own", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/native-actions";
  const headers = { authorization: "Bearer valid" };
  const first = await app.inject({ url: `${root}?limit=2`, headers });
  assert.equal(first.statusCode, 200);
  const page = projectNativeActionsResponseSchema.parse(first.json());
  assert.deepEqual(
    page.actions.map(({ ticket, kind }) => [ticket, kind]),
    [
      [1, "TicketEscalation"],
      [2, "HandoffBlock"],
      [3, "FinalizationApproval"],
    ],
  );
  const cursor = page.nextCursor;
  assert.ok(cursor !== undefined);
  const next = await app.inject({
    url: `${root}?cursor=${encodeURIComponent(cursor)}`,
    headers,
  });
  assert.equal(next.statusCode, 200);
  assert.equal(
    projectNativeActionsResponseSchema.parse(next.json()).nextCursor,
    undefined,
  );
  assert.equal(
    (await app.inject({ url: `${root}?cursor=not-a-cursor`, headers }))
      .statusCode,
    400,
  );
  assert.equal((await app.inject({ url: root })).statusCode, 401);
  assert.deepEqual(calls, [
    "nativeActionsPage:2:",
    "nativeActionsPage:50:approval",
  ]);
});

test("recent activity ordering requires its opaque cursor contract", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/tickets";
  const headers = { authorization: "Bearer valid" };
  assert.equal(
    (await app.inject({ url: `${root}?order=RecentActivity`, headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `${root}?order=Newest`, headers })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: `${root}?order=RecentActivity&after=1`, headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `${root}?order=RecentActivity&cursor=not-a-cursor`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(calls, ["project:50:RecentActivity:"]);
});

/** A position the server itself would have minted, which is the only value the
 * route accepts and the only one a client ever holds. */
const executionsCursor = encodeExecutionCursor(
  { tenant: asTenantId("tenant"), project: asProjectId("project") },
  { ticket: asTicketId(3), task: asTaskId(5) },
);

test("operational routes parse bounded filters and artifact identities", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project";
  const headers = { authorization: "Bearer valid" };
  await app.inject({ url: `${root}/operational-status`, headers });
  await app.inject({
    url: `${root}/executions?state=Queued&state=Running&ticket=3&limit=7`,
    headers,
  });
  await app.inject({
    url: `${root}/executions?cursor=${executionsCursor}&ticket=3&limit=7`,
    headers,
  });
  await app.inject({ url: `${root}/executions/execution-1`, headers });
  await app.inject({
    url: `${root}/executions/execution-1/artifacts/2`,
    headers,
  });
  assert.equal(
    (
      await app.inject({
        url: `${root}/executions?state=Unknown`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `${root}/executions?after=execution-1`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(calls, [
    "operationalStatus",
    "executions:7:3:",
    "executions:7:3:3.5",
    "execution:execution-1",
    "output:execution-1:2",
  ]);
});

const publicAuthoring = {
  dependencies: [],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: { type: "Budgeted", value: 1 },
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};

const publicBrief = {
  intent: "Serve the brief on the ticket resource.",
  links: ["https://example.test/issues/340"],
  branch: "refs/heads/rt/ticket-brief",
};

const publicDraftCreation = {
  configurationRevision: "revision",
  configurationDigest: "a".repeat(64),
  expectedProjectSequence: 7,
  authoring: publicAuthoring,
  brief: publicBrief,
};

test("authoring and dispatch routes remain thin NativeWeb adapters", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const project = "/api/v1/tenants/tenant/projects/project";
  const headers = {
    authorization: "Bearer valid",
    "content-type": "application/vnd.chuggy.v1+json",
  };
  await app.inject({
    url: `${project}/configurations?limit=2`,
    headers: { authorization: "Bearer valid" },
  });
  await app.inject({
    method: "POST",
    url: `${project}/configurations`,
    headers,
    body: {
      revision: "revision",
      canonical: '{"image":"worker:v1","version":1}',
    },
  });
  await app.inject({
    url: `${project}/configurations/revision`,
    headers: { authorization: "Bearer valid" },
  });
  await app.inject({
    method: "POST",
    url: `${project}/configurations/imports`,
    headers,
    body: { commit: "a".repeat(40) },
  });
  await app.inject({
    method: "POST",
    url: `${project}/drafts`,
    headers,
    body: publicDraftCreation,
  });
  await app.inject({
    method: "PUT",
    url: `${project}/drafts/1`,
    headers,
    body: {
      expectedVersion: 2,
      configurationRevision: "revision",
      authoring: publicAuthoring,
      brief: publicBrief,
    },
  });
  await app.inject({
    method: "DELETE",
    url: `${project}/drafts/1?expectedVersion=3`,
    headers: { authorization: "Bearer valid" },
  });
  await app.inject({
    url: `${project}/dispatch-view?limit=4`,
    headers: { authorization: "Bearer valid" },
  });
  assert.deepEqual(calls, [
    "configurations:2",
    "createConfiguration:revision",
    "configuration:revision",
    `importRepositoryConfigurations:${"a".repeat(40)}`,
    "createDraft",
    "reviseDraft:2",
    "deleteDraft:3",
    "dispatchView:4",
  ]);
});

test("a drafts page routes its cursor and its bound, and nothing else", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const project = "/api/v1/tenants/tenant/projects/project";
  const headers = { authorization: "Bearer valid" };
  await app.inject({ url: `${project}/drafts?limit=3`, headers });
  await app.inject({ url: `${project}/drafts`, headers });
  const cursor = encodeDraftCursor(
    parsePartition("tenant", "project"),
    asTicketId(7),
  );
  await app.inject({
    url: `${project}/drafts?cursor=${encodeURIComponent(cursor)}`,
    headers,
  });
  assert.deepEqual(calls, [
    "drafts:undefined:3",
    "drafts:undefined:50",
    "drafts:7:50",
  ]);
});

test("draft initialization routes the selected revision", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const response = await app.inject({
    url: "/api/v1/tenants/tenant/projects/project/draft-initializations/revision",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(calls, ["initializeDraft"]);
});

test("the bearer scheme is matched without regard to its case", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "bearer valid" },
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(calls, ["inventory:50"]);
});

test("selector context is an authenticated project resource", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    url: "/api/v1/tenants/tenant/projects/project/selector-context",
    headers: { authorization: "bearer valid" },
  });
  assert.equal(found.statusCode, 404);
  assert.deepEqual(calls, ["selectorOperationalContext"]);
});

test("a failing NativeWeb call is a server fault, not a client fault", async () => {
  const calls: string[] = [];
  const failing = {
    ...fakeWeb(calls),
    projectInventory: () =>
      Promise.reject(new Error("the pool is unreachable")),
  };
  await using app = createNativeHttpApp(
    failing,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: asPrincipal("issuer subject") },
        }),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 500);
  assert.equal(found.json<HttpErrorEnvelope>().error.code, "InternalError");
  assert.ok(!found.body.includes("pool"));
});

test("a corrupt stored document is a server fault, not a malformed request", async () => {
  const calls: string[] = [];
  const failing = {
    ...fakeWeb(calls),
    draft: () =>
      Promise.reject(
        new SyntaxError("Unexpected token } in JSON at position 7"),
      ),
  };
  await using app = createNativeHttpApp(
    failing,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: asPrincipal("issuer subject") },
        }),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/tenants/tenant/projects/project/drafts/1",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 500);
  assert.equal(found.json<HttpErrorEnvelope>().error.code, "InternalError");
});

const capacityPollAttemptsMax = 200;
const capacityPollIntervalMs = 10;

async function capacityLivenessReaches(
  port: number,
  status: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < capacityPollAttemptsMax; attempt += 1) {
    const found = await fetch(`http://127.0.0.1:${String(port)}/health/live`);
    await found.arrayBuffer();
    if (found.status === status) return true;
    await delay(capacityPollIntervalMs);
  }
  return false;
}

function capacityAbandonedRequest(port: number): Promise<net.Socket> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        "POST /api/v1/tenants/tenant/projects/project/operations HTTP/1.1\r\n" +
          "host: localhost\r\n" +
          "idempotency-key: key\r\n" +
          "content-type: application/vnd.chuggy.v1+json\r\n" +
          "content-length: 4096\r\n\r\n{",
      );
      resolve(socket);
    });
  });
}

test("an aborted request returns the capacity slot it took", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, true, {
    concurrentRequestsMax: 1,
    requestTimeoutMs: 15_000,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  const abandoned = await capacityAbandonedRequest(address.port);
  assert.ok(
    await capacityLivenessReaches(address.port, 503),
    "the abandoned request should hold the only slot",
  );
  abandoned.destroy();
  assert.ok(
    await capacityLivenessReaches(address.port, 200),
    "the aborted request should have returned its slot",
  );
  assert.deepEqual(calls, []);
});

test("a verification this server could not carry out is its own failure", async () => {
  const calls: string[] = [];
  await using app = createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: () =>
        Promise.resolve({ authenticated: "AuthorityUnavailable" as const }),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 503);
  assert.equal(
    found.json<HttpErrorEnvelope>().error.code,
    "AuthorityUnavailable",
  );
  assert.equal(found.headers["retry-after"], "1");
  assert.equal(found.headers["www-authenticate"], undefined);
});

test("a port that throws is unavailable rather than a refusal of the token", async () => {
  const calls: string[] = [];
  await using app = createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: () =>
        Promise.reject(new Error("the key set is unreachable")),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 503);
  assert.ok(!found.body.includes("key set"));
});

test("only a token this server rejected carries the invalid-token challenge", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer stale" },
  });
  assert.equal(refused.statusCode, 401);
  assert.equal(
    refused.headers["www-authenticate"],
    'Bearer error="invalid_token"',
  );
  const offered = await app.inject({ url: "/api/v1/projects" });
  assert.equal(offered.statusCode, 401);
  assert.equal(offered.headers["www-authenticate"], "Bearer");
});

/** A secret minted the way the scheduler mints one, so the routing under test is the real one. */
function sessionSecret(): string {
  return `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
}

const liveSession = asSessionId("session-one");

/**
 * The server as it is composed once a session authority stands beside the
 * issuer, which is the only arrangement in which either bearer kind is routed.
 */
function twoBearerAppOf(calls: string[], known: ReadonlySet<string>) {
  return createNativeHttpApp(
    fakeWeb(calls),
    twoBearerAuthentication(
      {
        authenticateBearer: (token) => {
          calls.push(`oidc:${token}`);
          return Promise.resolve(
            token === "valid"
              ? {
                  authenticated: "Bearer" as const,
                  bearer: { principal: asPrincipal("issuer subject") },
                }
              : { authenticated: "InvalidToken" as const },
          );
        },
      },
      {
        authenticate: (secret) => {
          calls.push("session-authority");
          return Promise.resolve(
            known.has(secret)
              ? {
                  partition: {
                    tenant: asTenantId("tenant"),
                    project: asProjectId("project"),
                  },
                  session: liveSession,
                  kind: "Thread" as const,
                  principal: asPrincipal("issuer subject"),
                }
              : undefined,
          );
        },
      },
    ),
    { ready: () => Promise.resolve(true) },
    authority,
  );
}

/** One submission, offered under whichever bearer a case is about. */
function submissionUnder(token: string) {
  return {
    method: "POST" as const,
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "key",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      operation: "operation",
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  };
}

test("an OIDC bearer still authenticates, and stamps no session", async () => {
  const calls: string[] = [];
  await using app = twoBearerAppOf(calls, new Set());
  const found = await app.inject(submissionUnder("valid"));
  assert.equal(found.statusCode, 422);
  assert.deepEqual(calls, ["oidc:valid", "submit:Decide"]);
});

test("a session bearer submits as its principal, and the record says which session", async () => {
  const calls: string[] = [];
  const secret = sessionSecret();
  await using app = twoBearerAppOf(calls, new Set([secret]));
  const found = await app.inject(submissionUnder(secret));
  assert.equal(found.statusCode, 422);
  assert.deepEqual(calls, [
    "session-authority",
    `submit:Decide:via:${String(liveSession)}`,
  ]);
});

test("a session bearer no live row answers is unauthenticated, not forbidden", async () => {
  const calls: string[] = [];
  await using app = twoBearerAppOf(calls, new Set());
  const found = await app.inject(submissionUnder(sessionSecret()));
  assert.equal(found.statusCode, 401);
  assert.equal(
    found.headers["www-authenticate"],
    'Bearer error="invalid_token"',
  );
  assert.deepEqual(calls, ["session-authority"]);
});

/**
 * A malformed session bearer must not reach the hook's blanket catch, which
 * would report a bad token as this server's own outage — so the case is written
 * against the status the server actually sends rather than against the routing.
 */
test("a malformed session bearer is refused, and never reported as an outage", async () => {
  for (const token of [
    sessionBearerPrefix,
    `${sessionBearerPrefix}!!`,
    `${sessionBearerPrefix.toUpperCase()}${randomUUID()}${randomUUID()}`,
  ]) {
    const calls: string[] = [];
    await using app = twoBearerAppOf(calls, new Set());
    const found = await app.inject(submissionUnder(token));
    assert.equal(found.statusCode, 401, token);
    assert.equal(
      found.headers["www-authenticate"],
      'Bearer error="invalid_token"',
      token,
    );
    assert.equal(found.headers["retry-after"], undefined, token);
    assert.equal(
      calls.includes("session-authority"),
      false,
      `${token} reached the session authority`,
    );
  }
});
