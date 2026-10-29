/**
 * A Pending ticket's dependencies changed by real updates through the writer,
 * read back by every reader of them and by the dispatch that follows.
 *
 * EACH READER IS ASKED AFTER THE UPDATE, NOT BEFORE IT ONLY. The journal is
 * replayed from genesis, the dispatch view is the one the lead and the selector
 * read, the ticket's read is the one the console and the change stream render,
 * and the change log is asked for what the update appended.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresProjectChangeLog } from "../../src/adapters/postgres/projectChangeLog.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { ledgerAt } from "../../src/domain/ledger.ts";
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";
import { artifactOf } from "../../src/domain/ticket.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import type {
  OperationId,
  Submission,
} from "../../src/interpreter/operationInbox.ts";
import {
  projectWriterLoad,
  projectWriterReplay,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  digestFoldHexChars,
  digestFoldPrefix,
} from "../../src/interpreter/resultManifest.ts";
import { plainAuthoring } from "../actor/harness.ts";
import {
  finalizerAccept,
  finalizerBriefLandsNothing,
  finalizerClaim,
  finalizerDigest,
  finalizerIdentity,
  finalizerPassedWork,
  finalizerRigOpen,
  finalizerTaskDone,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  postgresHarnessBinding,
  postgresHarnessBriefIn,
  postgresHarnessDrain,
  postgresHarnessHeld,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessSubmission,
  postgresHarnessWriter,
} from "./harness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** One case's project and the writer's memory of it, which every decision here carries forward. */
interface Project {
  readonly partition: Partition;
  memory: ProjectMemory;
  /** Each released ticket's draft: the configuration it was released at and the version it is at. */
  readonly drafts: Map<number, { configuration: string; version: number }>;
}

async function opened(label: string): Promise<Project> {
  const partition = await postgresHarnessProject(rig.harness.store, label);
  const memory = await projectWriterLoad(
    postgresHarnessWriter(rig.harness),
    await postgresHarnessHeld(rig.harness.store, partition, label),
  );
  return { partition, memory, drafts: new Map() };
}

/** Accepts `command` and decides everything it enqueues, answering what each decision was and the operation it was. */
async function decided(
  at: Project,
  label: string,
  command: Submission["command"],
): Promise<{ decided: readonly string[]; operation: OperationId }> {
  const submission = {
    ...postgresHarnessSubmission(at.partition, label),
    command,
  };
  assert.equal(
    (await rig.harness.inbox.accept(submission)).accepted,
    "Accepted",
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    at.partition,
    at.memory,
  );
  at.memory = drained.memory;
  return { decided: drained.decided, operation: submission.operation };
}

/** Releases a ticket waiting on `deps`, answering its number. */
async function released(
  at: Project,
  label: string,
  deps: readonly number[],
): Promise<number> {
  const release = await postgresHarnessReleaseSubmission(
    rig.harness,
    at.partition,
    label,
    { ...plainAuthoring, deps: new Set(deps) },
  );
  if (release.command.command !== "ReleaseDraft")
    assert.fail("that submission releases no draft");
  const { ticket, configurationRevision, authoringVersion } = release.command;
  assert.deepEqual(
    (await decided(at, `${label}-release`, release.command)).decided,
    ["Committed"],
  );
  at.drafts.set(ticket, {
    configuration: configurationRevision,
    version: authoringVersion,
  });
  return ticket;
}

/** Revokes `ticket`, refusing anything but a commit. */
async function revoked(
  at: Project,
  label: string,
  ticket: number,
): Promise<void> {
  const command = {
    version: 1,
    command: "Decide",
    ticketCommand: { type: "RevokeTicket", value: asTicketId(ticket) },
  } as const;
  assert.deepEqual((await decided(at, label, command)).decided, ["Committed"]);
}

/** Revises a released ticket's draft to wait on `deps` and submits the update at the revision the ticket is at. */
async function updated(
  at: Project,
  label: string,
  ticket: number,
  deps: readonly number[],
): Promise<{ decided: readonly string[]; operation: OperationId }> {
  const draft = at.drafts.get(ticket);
  assert.ok(draft !== undefined, "only a released ticket is updated");
  const revised = await rig.harness.authoring.reviseDraft({
    partition: at.partition,
    authority: postgresHarnessSubmission(at.partition, label).authority,
    ticket: asTicketId(ticket),
    expectedVersion: draft.version,
    configurationRevision: asConfigurationRevisionId(draft.configuration),
    authoring: { ...plainAuthoring, deps: new Set(deps) },
    brief: postgresHarnessBriefIn(
      await postgresHarnessBinding(rig.harness, at.partition),
    ),
  });
  assert.equal(revised.revised, "Revised", JSON.stringify(revised));
  if (revised.revised !== "Revised") assert.fail("the draft was not revised");
  draft.version = revised.draft.authoringVersion;
  return decided(at, label, {
    version: 1,
    command: "UpdateTicket",
    ticket: asTicketId(ticket),
    expectedRevision: ticketAt(at.memory.graph, asTicketId(ticket)).revision,
    authoringVersion: draft.version,
    configurationRevision: draft.configuration,
  });
}

/** The manual dispatch of `ticket` at the version the writer holds it at. */
function dispatchOf(at: Project, ticket: number): Submission["command"] {
  const version = at.memory.ticketVersions.get(ticket);
  assert.ok(version !== undefined);
  return {
    version: 1,
    command: "ManualDispatch",
    ticket: asTicketId(ticket),
    expectedTicketVersion: version,
  };
}

/** What a ticket's own read says of its dependencies: all of them, the revoked ones and the open ones. */
async function waits(at: Project, ticket: number) {
  const read = await postgresNativeReads(rig.harness.pool).ticket(
    at.partition,
    asTicketId(ticket),
  );
  return {
    named: read?.dependencies,
    revoked: read?.revokedDependencies,
    open: read?.openDependencies,
  };
}

/** The dispatch view the lead and the selector read, as each candidate and the dependencies it pins. */
async function candidates(at: Project) {
  const page = await postgresDispatchViews(rig.harness.pool).read(
    at.partition,
    { limit: 8 },
  );
  assert.ok(page.result === "Page");
  return page.candidates.map((each) => [each.ticket, each.dependencies]);
}

/** The dependencies the journal replayed from genesis holds `ticket` to, beside what the live writer holds. */
async function replayedDependencies(at: Project, ticket: number) {
  const loaded = await rig.harness.store.load(at.memory.lease);
  assert.ok(loaded.parsed === "Ok");
  const replayed = projectWriterReplay(loaded.value);
  const id = asTicketId(ticket);
  return {
    replayed: [...ticketAt(replayed.graph, id).definition.dependencies],
    live: [...ticketAt(at.memory.graph, id).definition.dependencies],
    version: replayed.ticketVersions.get(ticket),
  };
}

/** Every ticket's phase as the projection holds it, ascending. */
async function phases(at: Project) {
  const found = await rig.harness.query(
    `SELECT ticket::int AS ticket, phase FROM ticket_projection
      WHERE tenant=$1 AND project=$2 ORDER BY ticket`,
    [at.partition.tenant, at.partition.project],
  );
  return found.map((row) => [row["ticket"], row["phase"]]);
}

/** The finalization request a ticket's passing evaluation opened, as a claim is taken on it. */
async function finalizing(
  at: Project,
  ticket: number,
): Promise<FinalizerProject> {
  const draft = at.drafts.get(ticket);
  assert.ok(draft !== undefined);
  const [request] = await rig.harness.query(
    `SELECT request, authorizing_seq::text AS seq,
            request_generation::text AS generation
       FROM finalization_request WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [at.partition.tenant, at.partition.project, ticket],
  );
  const [pinned] = await rig.harness.query(
    `SELECT digest FROM configuration_revision
      WHERE tenant=$1 AND project=$2 AND revision=$3`,
    [at.partition.tenant, at.partition.project, draft.configuration],
  );
  assert.ok(request !== undefined && pinned !== undefined);
  return {
    partition: at.partition,
    request: String(request["request"]),
    ticket,
    authorizingSeq: Number(request["seq"]),
    requestGeneration: Number(request["generation"]),
    epoch: await rig.harness.store.currentRecoveryEpoch(),
    repository: await postgresHarnessBinding(rig.harness, at.partition),
    configurationRevision: draft.configuration,
    configurationDigest: String(pinned["digest"]),
    memory: at.memory,
  };
}

/**
 * Dispatches `ticket`, passes its work and its evaluation, and concludes a
 * landing that lands nothing through the finalizer's door. The passing work
 * result its journal accepted is then written as the scheduler would have.
 */
async function finished(
  at: Project,
  label: string,
  ticket: number,
): Promise<void> {
  assert.deepEqual(
    (await decided(at, `${label}-dispatch`, dispatchOf(at, ticket))).decided,
    ["Committed"],
  );
  for (const task of [
    workTaskIdentity(ticket, 1),
    evaluationTaskOf(ticket, 1, 1, 1, 1),
  ]) {
    assert.equal(
      await finalizerAccept(
        rig.harness,
        at.partition,
        `${label}-${task.type}`,
        finalizerTaskDone(at.memory.graph, task),
      ),
      "Accepted",
    );
    const drained = await postgresHarnessDrain(
      rig.harness,
      at.partition,
      at.memory,
    );
    assert.ok(drained.decided.every((each) => each === "Committed"));
    at.memory = drained.memory;
  }
  const request = await finalizing(at, ticket);
  await finalizerBriefLandsNothing(rig, at.partition, ticket);
  const submitted = await postgresFinalizer(rig.pool).submitResult({
    claim: await finalizerClaim(rig, request, finalizerIdentity("owner")),
    conclusion: { outcome: "FinalizationSucceeded" },
  });
  assert.equal(submitted.submitted, "Submitted");
  const drained = await postgresHarnessDrain(
    rig.harness,
    at.partition,
    at.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  at.memory = drained.memory;
  const done = ticketAt(at.memory.graph, asTicketId(ticket));
  assert.equal(done.state, "Done");
  const mark = artifactOf(done, ledgerAt(at.memory.ledgers, ticket));
  assert.ok(mark !== "NoArtifact");
  await finalizerPassedWork(
    rig,
    request,
    label,
    [],
    `${digestFoldPrefix(mark.value)}${finalizerDigest().slice(digestFoldHexChars)}`,
  );
}

test("an update dropping a revoked dependency is what replay, the ticket's read, the change log and the dispatch view read", async () => {
  const at = await opened("dependency-change-readers");
  const a = await released(at, "readers-a", []);
  const b = await released(at, "readers-b", [a]);
  await revoked(at, "readers-revoke", a);
  assert.deepEqual(await waits(at, b), { named: [a], revoked: [a], open: [] });
  assert.deepEqual(
    await candidates(at),
    [],
    "a stranded ticket is no candidate",
  );
  const log = postgresProjectChangeLog(rig.harness.pool);
  const cursor = await log.latest();
  assert.deepEqual((await updated(at, "readers-drop", b, [])).decided, [
    "Committed",
  ]);
  assert.deepEqual(await replayedDependencies(at, b), {
    replayed: [],
    live: [],
    version: at.memory.ticketVersions.get(b),
  });
  assert.deepEqual(await waits(at, b), { named: [], revoked: [], open: [] });
  assert.deepEqual(
    await candidates(at),
    [[b, []]],
    "the ticket is ready once the update drops what it could never have",
  );
  assert.deepEqual(
    (await log.after(at.partition, cursor, 16))
      .filter((change) => change.kind === "Ticket")
      .map((change) => change.resource),
    [String(b)],
    "the update rings the stream for the ticket it changed and no other",
  );
});

test("an update adding a revoked or a cyclic dependency is refused and stored under its own code, and changes nothing", async () => {
  const at = await opened("dependency-change-refused");
  const a = await released(at, "refused-a", []);
  const b = await released(at, "refused-b", []);
  await revoked(at, "refused-revoke", a);
  const c = await released(at, "refused-c", [b]);
  const reads = postgresNativeReads(rig.harness.pool);
  for (const [label, deps, refusal] of [
    [
      "refused-revoked",
      [a],
      {
        type: "DependenciesRevoked",
        value: { ticket: b, dependencies: new Set([a]) },
      },
    ],
    [
      "refused-cycle",
      [c],
      {
        type: "DependencyCycle",
        value: { ticket: b, dependencies: new Set([c]) },
      },
    ],
  ] as const) {
    const refused = await updated(at, label, b, deps);
    assert.deepEqual(refused.decided, ["Refused"]);
    const read = await reads.operation(at.partition, refused.operation);
    assert.deepEqual(
      read?.state === "Refused" ? read.refusal : read,
      refusal,
      `${label} reads back as the refusal the decider made`,
    );
  }
  assert.deepEqual(await replayedDependencies(at, b), {
    replayed: [],
    live: [],
    version: at.memory.ticketVersions.get(b),
  });
  assert.deepEqual(
    await waits(at, b),
    { named: [], revoked: [], open: [] },
    "the ticket's read names what its release did, not what its draft was revised to",
  );
  assert.deepEqual(await candidates(at), [[b, []]]);
});

test("a ticket stranded behind a revoked dependency is re-pointed at a replacement and dispatched once that is done", async () => {
  const at = await opened("dependency-change-replacement");
  const a = await released(at, "replacement-a", []);
  const b = await released(at, "replacement-b", [a]);
  await revoked(at, "replacement-revoke", a);
  const c = await released(at, "replacement-c", []);
  assert.deepEqual((await updated(at, "replacement-onto-c", b, [c])).decided, [
    "Committed",
  ]);
  assert.deepEqual(await waits(at, b), {
    named: [c],
    revoked: [],
    open: [{ ticket: c, phase: "Pending" }],
  });
  assert.deepEqual(
    await candidates(at),
    [[c, []]],
    "the replacement is ready and the re-pointed ticket waits on it",
  );
  await finished(at, "replacement-c", c);
  assert.deepEqual(await waits(at, b), { named: [c], revoked: [], open: [] });
  assert.deepEqual(await candidates(at), [[b, [c]]]);
  assert.deepEqual(
    (await decided(at, "replacement-dispatch-b", dispatchOf(at, b))).decided,
    ["Committed"],
  );
  assert.deepEqual(await phases(at), [
    [a, "Revoked"],
    [b, "Work"],
    [c, "Done"],
  ]);
});
