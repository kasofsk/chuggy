import assert from "node:assert/strict";
import { test } from "node:test";
import { released } from "./domain/testing.js";
import {
  TicketId,
  ContentRef,
  StageKey,
  EvaluatorKey,
} from "../../src/domain/chuggernaut/task.js";
import {
  ticketApplication,
  type TicketApplicationInbox,
} from "../../src/interpreter/ticketApplication.ts";
import type { TicketMachineInput } from "../../src/interpreter/ticketMachine.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asTenantId, asProjectId } from "../../src/interpreter/projectStore.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import {
  Pending,
  Ticket,
  TicketGraph,
} from "../../src/domain/chuggernaut/ticket.js";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const principal = asPrincipal("member");
const commit = asGitObjectId("a".repeat(40));

function catalogRelease(
  identity: ReturnType<typeof TicketId>,
  release: { readonly reworkLimit: number; readonly declared: boolean },
) {
  return Promise.resolve({
    definition: released(identity),
    stageNames: new Map([[StageKey(1), "review"]]),
    evaluatorNames: new Map([[EvaluatorKey(2), "ci"]]),
    reworkLimit: release.reworkLimit,
    reworkLimitDeclared: release.declared,
  });
}

function setup(
  authorized = true,
  release: { readonly reworkLimit: number; readonly declared: boolean } = {
    reworkLimit: 3,
    declared: true,
  },
  frozen = 3,
  availability:
    "Available" | "LegacyModelUnsupported" | "Inactive" = "Available",
  graph = new TicketGraph(new Map()),
  stored: string | undefined = undefined,
) {
  const submitted: TicketMachineInput[] = [];
  const inbox: TicketApplicationInbox = {
    submit: (_partition, input) => {
      submitted.push(input);
      return Promise.resolve({ accepted: "Accepted" });
    },
    outcome: () => Promise.resolve(undefined),
    reserveTicket: () =>
      Promise.resolve({ reserved: "Reserved", ticket: TicketId(7) }),
    releaseMetadata: () =>
      Promise.resolve({
        stageNames: [[1, "old review"]],
        evaluatorNames: [[2, "old ci"]],
        reworkLimit: frozen,
        source: 11,
      }),
  };
  let content = 0;
  const effects = { catalogs: 0, content: 0, drafts: 0 };
  const application = ticketApplication({
    access: {
      authorize: (_principal, _partition, operation) =>
        Promise.resolve(
          authorized
            ? {
                kind: asAuthorityKind("Member"),
                subject: asAuthoritySubject(`${principal}:${operation}`),
              }
            : undefined,
        ),
      authorizeTenant: () => Promise.resolve(undefined),
    },
    inbox,
    graphs: {
      read: () =>
        Promise.resolve(
          availability === "Available"
            ? graph
            : availability === "Inactive"
              ? undefined
              : availability,
        ),
    },
    catalogs: {
      catalog: () => {
        effects.catalogs += 1;
        return Promise.resolve({
          release: (identity) => catalogRelease(identity, release),
        });
      },
      draft: () => {
        effects.drafts += 1;
        return Promise.resolve({
          release: (identity, document) =>
            document === "ticket"
              ? catalogRelease(identity, release)
              : Promise.reject(
                  new TypeError("catalog document must be a mapping"),
                ),
        });
      },
    },
    content: () => ({
      put: () => {
        effects.content += 1;
        return Promise.resolve(ContentRef(++content));
      },
      read: () =>
        Promise.resolve(
          stored === undefined
            ? undefined
            : { mediaType: "application/yaml", content: stored },
        ),
    }),
  });
  return { application, submitted, effects };
}

test("create reserves an identity and submits the frozen catalog release", async () => {
  const { application, submitted } = setup();
  const result = await application.create(principal, {
    partition,
    identity: "opaque-create",
    source: "ticket",
    catalogCommit: commit,
  });
  assert.equal(result.result, "Authorized");
  const input = submitted[0];
  assert.ok(input?.authorization !== undefined);
  assert.equal(input.command.kind, "CreateTicket");
  assert.equal(input.authorization.principal, principal);
  assert.equal(input.authorization.authorizedOperation, "Mutate");
  assert.equal(input.authorization.policyRevision, "project-access-v1");
  assert.deepEqual(input.metadata, {
    stageNames: [[1, "review"]],
    evaluatorNames: [[2, "ci"]],
    reworkLimit: 3,
    source: 1,
  });
});

test("update preserves an omitted rework limit", async () => {
  const { application, submitted } = setup(
    true,
    { reworkLimit: 9, declared: false },
    4,
  );
  const result = await application.update(principal, {
    partition,
    identity: "opaque-update",
    ticket: TicketId(7),
    expectedRevision: 1,
    source: "ticket",
    catalogCommit: commit,
  });
  assert.equal(result.result, "Authorized");
  assert.equal(submitted[0]?.metadata?.reworkLimit, 4);
});

test("update refuses an explicit change to the frozen rework limit", async () => {
  const { application, submitted } = setup(
    true,
    { reworkLimit: 9, declared: true },
    4,
  );
  const result = await application.update(principal, {
    partition,
    identity: "opaque-update",
    ticket: TicketId(7),
    expectedRevision: 1,
    source: "ticket",
    catalogCommit: commit,
  });
  assert.deepEqual(result, {
    result: "Authorized",
    value: {
      accepted: "AuthoringRefused",
      code: "ReworkLimitChanged",
      message: "rework_limit must remain 4",
    },
  });
  assert.equal(submitted.length, 0);
});

test("authorization precedes legacy model rejection", async () => {
  const denied = setup(false);
  assert.deepEqual(await denied.application.graph(principal, partition), {
    result: "NotFound",
  });
  const allowed = setup(true, undefined, undefined, "LegacyModelUnsupported");
  assert.deepEqual(await allowed.application.graph(principal, partition), {
    result: "LegacyModelUnsupported",
  });
});

test("update and dispatch stop before side effects when the project is unavailable", async () => {
  for (const availability of ["LegacyModelUnsupported", "Inactive"] as const) {
    const { application, effects, submitted } = setup(
      true,
      undefined,
      undefined,
      availability,
    );
    const update = await application.update(principal, {
      partition,
      identity: `update-${availability}`,
      ticket: TicketId(7),
      expectedRevision: 1,
      source: "ticket",
      catalogCommit: commit,
    });
    const dispatch = await application.dispatch(principal, {
      partition,
      identity: `dispatch-${availability}`,
      ticket: TicketId(7),
      repository: "repository",
      commit: "b".repeat(40),
    });
    const result =
      availability === "LegacyModelUnsupported"
        ? "LegacyModelUnsupported"
        : "NotFound";
    assert.deepEqual(update, { result });
    assert.deepEqual(dispatch, { result });
    assert.deepEqual(effects, { catalogs: 0, content: 0, drafts: 0 });
    assert.equal(submitted.length, 0);
  }
});

test("dispatch writes source content inside the project scope", async () => {
  const { application, submitted } = setup();
  await application.dispatch(principal, {
    partition,
    identity: "opaque-dispatch",
    ticket: TicketId(7),
    repository: "repository",
    commit: "b".repeat(40),
  });
  const input = submitted[0];
  assert.ok(input?.authorization !== undefined);
  assert.equal(input.command.kind, "DispatchTicket");
  assert.equal(input.authorization.authorizedOperation, "DispatchTicket");
});

test("operation reads reject legacy projects after authorization", async () => {
  const hidden = setup(false, undefined, undefined, "LegacyModelUnsupported");
  assert.deepEqual(
    await hidden.application.outcome(principal, partition, "id"),
    { result: "NotFound" },
  );
  const legacy = setup(true, undefined, undefined, "LegacyModelUnsupported");
  assert.deepEqual(
    await legacy.application.outcome(principal, partition, "id"),
    { result: "LegacyModelUnsupported" },
  );
  const current = setup();
  assert.deepEqual(
    await current.application.outcome(principal, partition, "id"),
    { result: "Authorized", value: undefined },
  );
});

test("a definition read returns the held ticket beside its retained source", async () => {
  const held = new Ticket(released(TicketId(7)), 2, 0, new Pending());
  const { application } = setup(
    true,
    undefined,
    undefined,
    "Available",
    new TicketGraph(new Map([[TicketId(7), held]])),
    "title: kept\n",
  );
  assert.deepEqual(
    await application.definition(principal, partition, TicketId(7)),
    { result: "Authorized", value: { held, source: "title: kept\n" } },
  );
  assert.deepEqual(
    await application.definition(principal, partition, TicketId(8)),
    { result: "Authorized", value: undefined },
  );
});

test("validation reports findings over draft content and writes nothing", async () => {
  const { application, effects, submitted } = setup();
  assert.deepEqual(
    await application.validate(principal, {
      partition,
      source: "ticket",
      catalogCommit: commit,
    }),
    { result: "Authorized", value: { valid: true, findings: [] } },
  );
  assert.deepEqual(
    await application.validate(principal, {
      partition,
      source: "not a ticket",
      catalogCommit: commit,
    }),
    {
      result: "Authorized",
      value: { valid: false, findings: ["catalog document must be a mapping"] },
    },
  );
  assert.deepEqual(effects, { catalogs: 0, content: 0, drafts: 2 });
  assert.equal(submitted.length, 0);
});

test("validation refuses a principal that may not author", async () => {
  const { application } = setup(false);
  assert.deepEqual(
    await application.validate(principal, {
      partition,
      source: "ticket",
      catalogCommit: commit,
    }),
    { result: "NotFound" },
  );
});
