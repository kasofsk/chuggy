import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asPrincipal,
  asProjectAccessKind,
  asPublicInstant,
  checkedProjectReadQuery,
  nativeActionPageLimitMax,
  nativeWeb,
  oidcPrincipal,
  type NativeWeb,
  type NativeReadStore,
  type NativeSubmission,
  type ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type OperationInbox,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import type { RepositoryConfigurationImportPorts } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  type AuthoringStore,
} from "../../src/interpreter/authoring.ts";
import { refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import type { NotificationStore } from "../../src/interpreter/notifications.ts";
import {
  allBacklogScopes,
  openExecutionBacklogGuard,
  type ExecutionBacklogGuard,
} from "../../src/interpreter/schedulerContext.ts";
import {
  asIdempotencyKey,
  asOperationDecisionEvent,
  type TicketCommand,
} from "../../src/interpreter/operationInbox.ts";
import { dispatchEvent, revokeEvent } from "../../src/actor/decisionEvent.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const operation = asOperationId("operation");
const principal = asPrincipal("principal");
const authority = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("internal-subject"),
};

test("ticket ordering cursors cannot cross ordering contracts", () => {
  assert.throws(() =>
    checkedProjectReadQuery({
      limit: 10,
      order: "RecentActivity",
      after: id(1),
    }),
  );
  assert.throws(() =>
    checkedProjectReadQuery({
      limit: 10,
      recentActivityAfter: { sequence: 2, ticket: id(1) },
    }),
  );
});

function ticketRead(calls: string[]): NativeReadStore["ticket"] {
  return (_partition, ticket) => {
    calls.push(`read:ticket:${String(ticket)}`);
    return Promise.resolve({ ticket, phase: "Pending", sequence: 1 });
  };
}

function nativeActionsRead(
  calls: string[],
): NativeReadStore["ticketNativeActions"] {
  return (_partition, ticket) => {
    calls.push(`read:nativeActions:${String(ticket)}`);
    return Promise.resolve([
      {
        action: "action",
        kind: "TicketEscalation" as const,
        authorizingSequence: 7,
        admits: ["Resume" as const, "Revoke" as const],
      },
    ]);
  };
}

function authoringStore(
  calls: string[],
  initialization: ReturnType<
    AuthoringStore["initializeDraft"]
  > = Promise.resolve(undefined),
): AuthoringStore {
  return {
    initializeDraft: (_partition, _revision, maximum) => {
      calls.push(`initialize:${String(maximum)}`);
      return initialization;
    },
    configurations: () => {
      calls.push("read:configurations");
      return Promise.resolve({ partition, configurations: [] });
    },
    configuration: () => {
      calls.push("read:configuration");
      return Promise.resolve(undefined);
    },
    draft: () => {
      calls.push("read:draft");
      return Promise.resolve(undefined);
    },
    createConfiguration: () => Promise.resolve({ created: "ParentNotFound" }),
    createDraft: () => Promise.resolve({ created: "ConfigurationNotFound" }),
    reviseDraft: () => Promise.resolve({ revised: "NotFound" }),
    deleteDraft: () => Promise.resolve({ deleted: "NotFound" }),
  };
}

function readStore(calls: string[]): NativeReadStore {
  return {
    operation: () => {
      calls.push("read:operation");
      return Promise.resolve({
        operation,
        acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        state: "Pending" as const,
      });
    },
    project: () => {
      calls.push("read:project");
      return Promise.resolve({
        result: "Found" as const,
        project: { partition, sequence: 0, tickets: [] },
      });
    },
    ticket: ticketRead(calls),
    ticketNativeActions: nativeActionsRead(calls),
    nativeActions: (_partition, query) => {
      calls.push(`read:nativeActions:page:${String(query.limit)}`);
      return Promise.resolve({ actions: [] });
    },
  };
}

function boundary(
  allowed: boolean,
  backlog: ExecutionBacklogGuard = openExecutionBacklogGuard,
  repositoryConfigurationImports?: RepositoryConfigurationImportPorts,
  initialization?: ReturnType<AuthoringStore["initializeDraft"]>,
): {
  readonly web: ReturnType<typeof nativeWeb>;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const access: ProjectAccess = {
    authorize: (_principal, _partition, kind) => {
      calls.push(`authorize:${kind}`);
      return Promise.resolve(allowed ? authority : undefined);
    },
  };
  const reads = readStore(calls);
  const inbox: OperationInbox = {
    accept: () => {
      calls.push("accept");
      return Promise.resolve({ accepted: "InvalidCommand" });
    },
    cancel: (request) => {
      calls.push(`cancel:${request.authority.subject}`);
      return Promise.resolve({ cancelled: "Unknown" });
    },
    operation: () => Promise.resolve(undefined),
  };
  const notifications: NotificationStore = {
    read: () => {
      calls.push("read:notifications");
      return Promise.resolve({ result: "Events", cursor: 0, events: [] });
    },
  };
  return {
    web: nativeWeb(
      access,
      reads,
      inbox,
      authoringStore(calls, initialization),
      notifications,
      backlog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      repositoryConfigurationImports,
    ),
    calls,
  };
}

const readyConfiguration = asCanonicalConfiguration(
  '{"brief":{"acceptanceCriteria":["works"],"constraints":[],"motivation":["needed"]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
);

test("draft initialization authorizes before reading and returns bounded policy", async () => {
  const revision = asConfigurationRevisionId("revision");
  const initialization = Promise.resolve({
    configuration: {
      partition,
      revision,
      canonical: readyConfiguration,
      digest: "a".repeat(64),
    },
    projectSequence: 4,
    dependencyCandidates: [id(1)],
    dependencyCandidatesTruncated: true,
    domain: refinementInstance,
  });
  const denied = boundary(
    false,
    openExecutionBacklogGuard,
    undefined,
    initialization,
  );
  assert.equal(
    (await denied.web.initializeDraft(principal, partition, revision)).result,
    "NotFound",
  );
  assert.deepEqual(denied.calls, ["authorize:Mutate"]);
  const allowed = boundary(
    true,
    openExecutionBacklogGuard,
    undefined,
    initialization,
  );
  const result = await allowed.web.initializeDraft(
    principal,
    partition,
    revision,
  );
  assert.equal(result.result, "Authorized");
  assert.equal(
    result.result === "Authorized" && result.value.initialized === "Initialized"
      ? result.value.value.dependencyCandidatesTruncated
      : false,
    true,
  );
  assert.deepEqual(allowed.calls, ["authorize:Mutate", "initialize:100"]);
});

test("draft initialization bounds missing, unavailable, and incomplete configurations", async () => {
  const revision = asConfigurationRevisionId("revision");
  for (const [initialization, expected] of [
    [Promise.resolve(undefined), "ConfigurationNotFound"],
    [Promise.resolve("PolicyUnavailable" as const), "PolicyUnavailable"],
    [
      Promise.resolve({
        configuration: {
          partition,
          revision,
          canonical: asCanonicalConfiguration("{}"),
          digest: "a".repeat(64),
        },
        projectSequence: 0,
        dependencyCandidates: [],
        dependencyCandidatesTruncated: false,
        domain: refinementInstance,
      }),
      "ConfigurationIncomplete",
    ],
  ] as const) {
    const { web } = boundary(
      true,
      openExecutionBacklogGuard,
      undefined,
      initialization,
    );
    const result = await web.initializeDraft(principal, partition, revision);
    assert.equal(
      result.result === "Authorized" ? result.value.initialized : "NotFound",
      expected,
    );
  }
});

function repositoryImportPorts(
  calls: string[],
): RepositoryConfigurationImportPorts {
  return {
    bindings: {
      binding: (foundPartition) => {
        calls.push("binding");
        return Promise.resolve({
          partition: foundPartition,
          repository: asRepositoryId("repository"),
          recoveryEpoch: asRecoveryEpoch("epoch"),
        });
      },
    },
    snapshots: {
      snapshot: ({ commit }) => {
        calls.push(`snapshot:${commit}`);
        return Promise.resolve({
          read: "Snapshot",
          files: [
            {
              path: [".chug", "configurations", "work.json"].join("/"),
              kind: "File",
              content: JSON.stringify({
                version: 1,
                name: "work",
                configuration: {
                  version: 1,
                  image: "worker:v1",
                  practices: [],
                  brief: {
                    motivation: ["Do the work."],
                    acceptanceCriteria: ["The work is done."],
                    constraints: [],
                  },
                  work: { instructions: [] },
                  review: { instructions: [] },
                },
              }),
            },
          ],
        });
      },
    },
    store: {
      importRepositoryConfigurations: ({ declarations }) => {
        calls.push(`import:${String(declarations.length)}`);
        return Promise.resolve({ imported: "Imported" });
      },
    },
  };
}

/** A guard that refuses every dispatch, so a case can tell a gated path from an ungated one. */
const backloggedGuard: ExecutionBacklogGuard = {
  admitsDispatch: () =>
    Promise.resolve({
      admits: "Backlogged",
      scope: "Project",
      retryAfterSeconds: 5,
    }),
};

/** One submission carrying the named command, which is all these cases vary. */
function submissionOf(command: TicketCommand): NativeSubmission {
  return { partition, operation, key: asIdempotencyKey("key"), command };
}

test("inaccessible and absent operation reads share the not-found shape", async () => {
  const { web, calls } = boundary(false);
  assert.equal(await web.operation(principal, partition, operation), undefined);
  assert.deepEqual(calls, ["authorize:Read"]);
});

test("ticket detail reauthorizes and conceals inaccessible tickets", async () => {
  const denied = boundary(false);
  assert.equal(await denied.web.ticket(principal, partition, id(1)), undefined);
  assert.deepEqual(denied.calls, ["authorize:Read"]);

  const allowed = boundary(true);
  assert.equal(
    (await allowed.web.ticket(principal, partition, id(1)))?.ticket,
    id(1),
  );
  assert.deepEqual(allowed.calls, ["authorize:Read", "read:ticket:1"]);
});

test("a ticket's open actions reauthorize and conceal an inaccessible ticket", async () => {
  const denied = boundary(false);
  assert.equal(
    await denied.web.ticketNativeActions(principal, partition, id(1)),
    undefined,
  );
  assert.deepEqual(denied.calls, ["authorize:Read"]);

  const allowed = boundary(true);
  assert.deepEqual(
    await allowed.web.ticketNativeActions(principal, partition, id(1)),
    [
      {
        action: "action",
        kind: "TicketEscalation",
        authorizingSequence: 7,
        admits: ["Resume", "Revoke"],
      },
    ],
  );
  assert.deepEqual(allowed.calls, ["authorize:Read", "read:nativeActions:1"]);
});

test("a project's open actions authorize and enforce their page bound", async () => {
  const denied = boundary(false);
  assert.deepEqual(
    await denied.web.nativeActions(principal, partition, { limit: 10 }),
    { result: "NotFound" },
  );
  assert.deepEqual(denied.calls, ["authorize:Read"]);

  const allowed = boundary(true);
  assert.deepEqual(
    await allowed.web.nativeActions(principal, partition, { limit: 10 }),
    { result: "Authorized", value: { actions: [] } },
  );
  assert.deepEqual(allowed.calls, [
    "authorize:Read",
    "read:nativeActions:page:10",
  ]);
  await assert.rejects(
    () =>
      allowed.web.nativeActions(principal, partition, {
        limit: nativeActionPageLimitMax + 1,
      }),
    RangeError,
  );
});

test("configuration pages authorize and enforce their bound before reading", async () => {
  const denied = boundary(false);
  assert.deepEqual(
    await denied.web.configurations(principal, partition, { limit: 10 }),
    { result: "NotFound" },
  );
  assert.deepEqual(denied.calls, ["authorize:Read"]);

  const allowed = boundary(true);
  assert.deepEqual(
    await allowed.web.configurations(principal, partition, { limit: 10 }),
    { result: "Authorized", value: { partition, configurations: [] } },
  );
  assert.deepEqual(allowed.calls, ["authorize:Read", "read:configurations"]);
  await assert.rejects(
    allowed.web.configurations(principal, partition, { limit: 101 }),
    /configuration page limit/u,
  );
});

test("repository imports authorize, pin one snapshot, then persist ready declarations", async () => {
  const calls: string[] = [];
  const subject = boundary(
    true,
    openExecutionBacklogGuard,
    repositoryImportPorts(calls),
  );
  const commit = asGitObjectId("a".repeat(40));
  assert.deepEqual(
    await subject.web.importRepositoryConfigurations(
      principal,
      partition,
      commit,
    ),
    { result: "Imported" },
  );
  assert.deepEqual(subject.calls, ["authorize:Mutate"]);
  assert.deepEqual(calls, ["binding", `snapshot:${commit}`, "import:1"]);
});

test("repository imports conceal denial before reading any outer port", async () => {
  const calls: string[] = [];
  const subject = boundary(
    false,
    openExecutionBacklogGuard,
    repositoryImportPorts(calls),
  );
  assert.deepEqual(
    await subject.web.importRepositoryConfigurations(
      principal,
      partition,
      asGitObjectId("b".repeat(40)),
    ),
    { result: "NotFound" },
  );
  assert.deepEqual(subject.calls, ["authorize:Mutate"]);
  assert.deepEqual(calls, []);
});

test("repository imports are unavailable when their infrastructure is not composed", async () => {
  const allowed = boundary(true);
  assert.deepEqual(
    await allowed.web.importRepositoryConfigurations(
      principal,
      partition,
      asGitObjectId("b".repeat(40)),
    ),
    { result: "Unavailable", unavailable: "Repository" },
  );
  assert.deepEqual(allowed.calls, ["authorize:Mutate"]);

  const denied = boundary(false);
  assert.deepEqual(
    await denied.web.importRepositoryConfigurations(
      principal,
      partition,
      asGitObjectId("b".repeat(40)),
    ),
    { result: "NotFound" },
  );
  assert.deepEqual(denied.calls, ["authorize:Mutate"]);
});

test("repository imports refuse invalid declarations without writing", async () => {
  const calls: string[] = [];
  const ports = repositoryImportPorts(calls);
  const subject = boundary(true, openExecutionBacklogGuard, {
    ...ports,
    snapshots: {
      snapshot: () => {
        calls.push("snapshot:invalid");
        return Promise.resolve({
          read: "Snapshot",
          files: [
            {
              path: [".chug", "configurations", "invalid.json"].join("/"),
              kind: "File",
              content: "{}",
            },
          ],
        });
      },
    },
  });
  const result = await subject.web.importRepositoryConfigurations(
    principal,
    partition,
    asGitObjectId("c".repeat(40)),
  );
  assert.equal(result.result, "DeclarationsRefused");
  assert.deepEqual(calls, ["binding", "snapshot:invalid"]);
});

test("operational resources authorize before scheduler or artifact reads", async () => {
  const execution = asExecutionId("execution");
  for (const read of [
    (web: NativeWeb) => web.operationalStatus(principal, partition),
    (web: NativeWeb) => web.executions(principal, partition, { limit: 10 }),
    (web: NativeWeb) => web.execution(principal, partition, execution),
    (web: NativeWeb) => web.outputContent(principal, partition, execution, 1),
  ]) {
    const denied = boundary(false);
    await read(denied.web);
    assert.deepEqual(denied.calls, ["authorize:Read"]);
  }
});

test("cancellation reauthorizes before reading or writing", async () => {
  const denied = boundary(false);
  assert.deepEqual(await denied.web.cancel(principal, partition, operation), {
    result: "NotFound",
  });
  assert.deepEqual(denied.calls, ["authorize:Mutate"]);

  const allowed = boundary(true);
  assert.equal(
    (await allowed.web.cancel(principal, partition, operation)).result,
    "Found",
  );
  assert.deepEqual(allowed.calls, [
    "authorize:Mutate",
    "read:operation",
    "cancel:internal-subject",
  ]);
});

test("every notification page reauthorizes before reading", async () => {
  const denied = boundary(false);
  assert.deepEqual(
    await denied.web.notifications(principal, partition, {
      after: 0,
      limit: 10,
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(denied.calls, ["authorize:Read"]);
  const allowed = boundary(true);
  await allowed.web.notifications(principal, partition, {
    after: 0,
    limit: 10,
  });
  assert.deepEqual(allowed.calls, ["authorize:Read", "read:notifications"]);
});

test("authoring reads conceal inaccessible resources", async () => {
  const denied = boundary(false);
  assert.equal(await denied.web.draft(principal, partition, id(1)), undefined);
  assert.deepEqual(denied.calls, ["authorize:Read"]);
});

/** The dispatch decision the inbox refuses, which is what the case below is about. */
const dispatchDecision: TicketCommand = {
  version: 1,
  command: "Decide",
  event: asOperationDecisionEvent(dispatchEvent(id(1))),
};

/** Dispatch as it actually arrives, which is what the guard is consulted for. */
const manualDispatch: TicketCommand = {
  version: 1,
  command: "ManualDispatch",
  ticket: id(1),
  expectedTicketVersion: 1,
};

test("a command the inbox refuses is answered the same way backlogged or not", async () => {
  const backlogged = boundary(true, backloggedGuard);
  const admitting = boundary(true);
  const refused = {
    result: "Authorized",
    acceptance: { accepted: "InvalidCommand" },
  };
  assert.deepEqual(
    await backlogged.web.submit(principal, submissionOf(dispatchDecision)),
    refused,
  );
  assert.deepEqual(
    await admitting.web.submit(principal, submissionOf(dispatchDecision)),
    refused,
  );
  assert.deepEqual(backlogged.calls, ["authorize:Mutate", "accept"]);
  assert.deepEqual(admitting.calls, backlogged.calls);
});

test("the guard stops the two ingress spellings dispatch actually arrives as", async () => {
  const spellings: readonly (readonly [TicketCommand, string])[] = [
    [manualDispatch, "authorize:DispatchTicket"],
    [
      {
        version: 1,
        command: "ProposeDispatch",
        ticket: id(1),
        expectedTicketVersion: 1,
        observedViewToken: {
          tenant: "tenant",
          project: "project",
          recoveryEpoch: "epoch",
          schemaVersion: 1,
          watermark: 1,
          digest: "0".repeat(64),
        },
        selectorDecisionReference: "selection-one",
      },
      "authorize:ProposeDispatch",
    ],
  ];
  for (const [command, authorized] of spellings) {
    const { web, calls } = boundary(true, backloggedGuard);
    assert.deepEqual(await web.submit(principal, submissionOf(command)), {
      result: "Backlogged",
      scope: "Project",
      retryAfterSeconds: 5,
    });
    assert.deepEqual(calls, [authorized]);
  }
});

test("the execution backlog guard leaves correctness-reducing submission admissible", async () => {
  const { web, calls } = boundary(true, backloggedGuard);
  assert.equal(
    (
      await web.submit(
        principal,
        submissionOf({
          version: 1,
          command: "Decide",
          event: asOperationDecisionEvent(revokeEvent(id(1))),
        }),
      )
    ).result,
    "Authorized",
  );
  assert.deepEqual(calls, ["authorize:Mutate", "accept"]);
});

test("every ceiling the guard can name reaches the submitter unchanged", async () => {
  for (const scope of allBacklogScopes) {
    const { web, calls } = boundary(true, {
      admitsDispatch: () =>
        Promise.resolve({ admits: "Backlogged", scope, retryAfterSeconds: 5 }),
    });
    assert.deepEqual(
      await web.submit(principal, submissionOf(manualDispatch)),
      { result: "Backlogged", scope, retryAfterSeconds: 5 },
    );
    assert.deepEqual(calls, ["authorize:DispatchTicket"]);
  }
});

test("an unbacklogged project reaches acceptance for dispatch", async () => {
  const { web, calls } = boundary(true);
  assert.equal(
    (await web.submit(principal, submissionOf(manualDispatch))).result,
    "Authorized",
  );
  assert.deepEqual(calls, ["authorize:DispatchTicket", "accept"]);
});

test("principal identity is collision-free across issuer and subject", () => {
  assert.notEqual(
    oidcPrincipal("https://one.example", "/subject"),
    oidcPrincipal("https://one.example/", "subject"),
  );
  assert.equal(
    oidcPrincipal("https://one.example", "subject"),
    oidcPrincipal("https://one.example", "subject"),
  );
});

test("a principal needs both halves of the identity it names", () => {
  assert.throws(() => oidcPrincipal("", "subject"), RangeError);
  assert.throws(() => oidcPrincipal("https://one.example", ""), RangeError);
});

test("only the access kinds the authorization function knows narrow", () => {
  assert.equal(asProjectAccessKind("DispatchTicket"), "DispatchTicket");
  assert.throws(() => asProjectAccessKind("Dispatch"), RangeError);
  assert.throws(() => asProjectAccessKind(""), RangeError);
});
