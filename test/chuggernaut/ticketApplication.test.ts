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
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { ticketCatalogRoot } from "../../src/interpreter/ticketCatalog.ts";
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

type Effects = {
  catalogs: number;
  content: number;
  drafts: number;
  snapshots: number;
  tips: number;
};

/** The catalog port, whose draft refuses anything the create double accepts. */
function catalogsDouble(
  effects: Effects,
  reads: string[],
  release: { readonly reworkLimit: number; readonly declared: boolean },
) {
  return {
    tip: () => {
      effects.tips += 1;
      return Promise.resolve({
        repository: asRepositoryId("github.com/acme/atlas"),
        commit,
      });
    },
    catalog: () => {
      effects.catalogs += 1;
      return Promise.resolve({
        release: (identity: ReturnType<typeof TicketId>) =>
          catalogRelease(identity, release),
      });
    },
    snapshot: () => {
      effects.snapshots += 1;
      return Promise.resolve({
        repository: "repository",
        snapshot: {
          read: (path: string) => {
            reads.push(path);
            return Promise.resolve("prompt: run\n");
          },
        },
        entries: () =>
          Promise.resolve([
            { path: "workloads/work.yaml", origin: "Git" as const },
            { path: "evaluators/ci.yaml", origin: "Git" as const },
            { path: "workloads/runtime.yaml", origin: "Runtime" as const },
          ]),
      });
    },
  };
}

function inboxDouble(
  submitted: TicketMachineInput[],
  frozen: number,
): TicketApplicationInbox {
  return {
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
    releaseReworkLimits: () =>
      Promise.resolve(new Map([[TicketId(7), frozen]])),
  };
}

function accessDouble(authorized: boolean) {
  return {
    authorize: (_principal: unknown, _partition: unknown, operation: string) =>
      Promise.resolve(
        authorized
          ? {
              kind: asAuthorityKind("Member"),
              subject: asAuthoritySubject(`${principal}:${operation}`),
            }
          : undefined,
      ),
    authorizeTenant: () => Promise.resolve(undefined),
  };
}

/** A draft that will not build rejects where the real catalog reads its project. */
function draftDouble(
  release: { readonly reworkLimit: number; readonly declared: boolean },
  fault: Error | undefined,
) {
  if (fault !== undefined) return Promise.reject(fault);
  return Promise.resolve({
    release: (identity: TicketId, document: string) =>
      document === "ticket"
        ? catalogRelease(identity, release)
        : Promise.reject(new TypeError("catalog document must be a mapping")),
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
  draftFault: Error | undefined = undefined,
) {
  const submitted: TicketMachineInput[] = [];
  const inbox = inboxDouble(submitted, frozen);
  let content = 0;
  const effects = { catalogs: 0, content: 0, drafts: 0, snapshots: 0, tips: 0 };
  const reads: string[] = [];
  const held = new Map<string, string>();
  const application = ticketApplication({
    fragments: {
      paths: () => Promise.resolve([...held.keys()]),
      read: (_partition, reference) => Promise.resolve(held.get(reference)),
      write: (_partition, reference, value) => {
        held.set(reference, value);
        return Promise.resolve();
      },
      remove: (_partition, reference) =>
        Promise.resolve(held.delete(reference)),
    },
    access: accessDouble(authorized),
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
      ...catalogsDouble(effects, reads, release),
      draft: () => {
        effects.drafts += 1;
        return draftDouble(release, draftFault);
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
  return { application, submitted, effects, reads, held };
}

test("create reserves an identity and submits the frozen catalog release", async () => {
  const { application, submitted } = setup();
  const result = await application.create(principal, {
    partition,
    identity: "opaque-create",
    source: "ticket",
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

test("a graph read carries the limit each release froze beside the graph", async () => {
  const held = new Ticket(released(TicketId(7)), 2, 1, new Pending());
  const graph = new TicketGraph(new Map([[TicketId(7), held]]));
  const { application } = setup(true, undefined, 4, "Available", graph);
  const read = await application.graph(principal, partition);
  assert.equal(read.result, "Authorized");
  assert.equal(read.value.graph, graph);
  assert.deepEqual([...read.value.reworkLimits], [[TicketId(7), 4]]);
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
    assert.deepEqual(effects, {
      catalogs: 0,
      content: 0,
      drafts: 0,
      snapshots: 0,
      tips: 0,
    });
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
    {
      result: "Authorized",
      value: { held, reworkLimit: 3, source: "title: kept\n" },
    },
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
    }),
    { result: "Authorized", value: { valid: true, findings: [], commit } },
  );
  assert.deepEqual(
    await application.validate(principal, {
      partition,
      source: "not a ticket",
    }),
    {
      result: "Authorized",
      value: {
        valid: false,
        findings: [{ path: "", message: "catalog document must be a mapping" }],
        commit,
      },
    },
  );
  assert.deepEqual(effects, {
    catalogs: 0,
    content: 0,
    drafts: 2,
    snapshots: 0,
    tips: 2,
  });
  assert.equal(submitted.length, 0);
});

test("a write against a catalog that has moved is refused and submits nothing", async () => {
  const { application, submitted, held } = setup();
  const moved = asGitObjectId("c".repeat(40));
  const refusal = {
    accepted: "AuthoringRefused",
    code: "CatalogCommitStale",
    message: `the catalog has moved from ${moved} to ${commit}`,
  };
  assert.deepEqual(
    await application.create(principal, {
      partition,
      identity: "opaque-create",
      source: "ticket",
      expectedCatalogCommit: moved,
    }),
    { result: "Authorized", value: refusal },
  );
  assert.deepEqual(
    await application.writeCatalogFile(
      principal,
      { partition, expectedCatalogCommit: moved },
      "workloads/new.yaml",
      "prompt: new\n",
    ),
    {
      result: "Authorized",
      value: { written: "Refused", message: refusal.message },
    },
  );
  assert.equal(submitted.length, 0);
  assert.equal(held.size, 0);
});

test("a write carrying the commit the server resolved is taken", async () => {
  const { application, submitted } = setup();
  const result = await application.create(principal, {
    partition,
    identity: "opaque-create",
    source: "ticket",
    expectedCatalogCommit: commit,
  });
  assert.equal(result.result, "Authorized");
  assert.equal(submitted.length, 1);
});

test("validation refuses a principal that may not author", async () => {
  const { application } = setup(false);
  assert.deepEqual(
    await application.validate(principal, {
      partition,
      source: "ticket",
    }),
    { result: "NotFound" },
  );
});

test("a catalog that will not build is a finding, not a refusal", async () => {
  const { application } = setup(
    true,
    { reworkLimit: 3, declared: true },
    3,
    "Available",
    new TicketGraph(new Map()),
    undefined,
    new TypeError("project document must be a mapping"),
  );
  assert.deepEqual(
    await application.validate(principal, { partition, source: "ticket" }),
    {
      result: "Authorized",
      value: {
        valid: false,
        findings: [{ path: "", message: "project document must be a mapping" }],
        commit,
      },
    },
  );
});

test("a catalog read answers sorted references and one file's content", async () => {
  const { application, effects, reads } = setup();
  assert.deepEqual(await application.catalog(principal, { partition }), {
    result: "Authorized",
    value: {
      entries: [
        { path: "evaluators/ci.yaml", origin: "Git" },
        { path: "workloads/runtime.yaml", origin: "Runtime" },
        { path: "workloads/work.yaml", origin: "Git" },
      ],
    },
  });
  assert.deepEqual(
    await application.catalogFile(
      principal,
      { partition },
      "workloads/work.yaml",
    ),
    {
      result: "Authorized",
      value: {
        path: "workloads/work.yaml",
        origin: "Git",
        content: "prompt: run\n",
      },
    },
  );
  assert.deepEqual(reads, [`${ticketCatalogRoot}workloads/work.yaml`]);
  assert.equal(effects.snapshots, 2);
});

test("a catalog read is refused to a principal that may not author", async () => {
  const { application, effects } = setup(false);
  assert.deepEqual(await application.catalog(principal, { partition }), {
    result: "NotFound",
  });
  assert.equal(effects.snapshots, 0);
});

test("a file read carries the origin its entry was listed under", async () => {
  const { application } = setup();
  assert.deepEqual(
    await application.catalogFile(
      principal,
      { partition },
      "workloads/runtime.yaml",
    ),
    {
      result: "Authorized",
      value: {
        path: "workloads/runtime.yaml",
        origin: "Runtime",
        content: "prompt: run\n",
      },
    },
  );
  assert.deepEqual(
    await application.catalogFile(
      principal,
      { partition },
      "workloads/absent.yaml",
    ),
    { result: "Authorized", value: undefined },
  );
});

test("a runtime fragment is written and read back under its reference", async () => {
  const { application, held } = setup();
  assert.deepEqual(
    await application.writeCatalogFile(
      principal,
      { partition },
      "workloads/new.yaml",
      "prompt: new\n",
    ),
    { result: "Authorized", value: { written: "Written" } },
  );
  assert.deepEqual([...held], [["workloads/new.yaml", "prompt: new\n"]]);
  assert.deepEqual(
    await application.removeCatalogFile(
      principal,
      { partition },
      "workloads/new.yaml",
    ),
    { result: "Authorized", value: { written: "Removed" } },
  );
  assert.deepEqual(
    await application.removeCatalogFile(
      principal,
      { partition },
      "workloads/new.yaml",
    ),
    { result: "Authorized", value: { written: "NotHeld" } },
  );
});

test("a fragment shadowing a committed reference is refused by name", async () => {
  const { application, held } = setup();
  assert.deepEqual(
    await application.writeCatalogFile(
      principal,
      { partition },
      "workloads/work.yaml",
      "prompt: shadow\n",
    ),
    {
      result: "Authorized",
      value: {
        written: "Refused",
        message:
          "the repository already holds workloads/work.yaml; a runtime fragment may not shadow it",
      },
    },
  );
  assert.equal(held.size, 0);
});

test("a fragment naming what no catalog serves is refused before any store", async () => {
  const { application, held, effects } = setup();
  assert.deepEqual(
    await application.writeCatalogFile(
      principal,
      { partition },
      "secrets/deploy.yaml",
      "token: leaked\n",
    ),
    {
      result: "Authorized",
      value: {
        written: "Refused",
        message: "catalog reference names a file that is never served",
      },
    },
  );
  assert.equal(held.size, 0);
  assert.equal(effects.snapshots, 0);
});

test("a fragment write is refused to a principal that may not author", async () => {
  const { application, held } = setup(false);
  assert.deepEqual(
    await application.writeCatalogFile(
      principal,
      { partition },
      "workloads/new.yaml",
      "prompt: new\n",
    ),
    { result: "NotFound" },
  );
  assert.deepEqual(
    await application.removeCatalogFile(
      principal,
      { partition },
      "workloads/new.yaml",
    ),
    { result: "NotFound" },
  );
  assert.equal(held.size, 0);
});
