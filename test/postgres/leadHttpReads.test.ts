/**
 * The five lead-side routes over a real database: the API's own role, the
 * definer functions 059 declares, and the HTTP boundary above them.
 *
 * WHAT A DOUBLE CANNOT ANSWER. `test/adapters/httpLeadReads.test.ts` proves the
 * assembly against a fake port; what it cannot prove is that the port's contract
 * is the server's — that the ledger reads answer one row past the page a caller
 * asks for, that the decision log's direction flag means what the newest arm
 * needs, and that the store read honours the limit the held walk pages by. Each
 * of those is a claim about a function body, and each is asserted here.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalsAnsweredMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
} from "../../src/contract/http.ts";
import {
  agenticRefusalsResponseSchema,
  leadNoneResponseSchema,
  leadResponseSchema,
  leadTranscriptResponseSchema,
  selectorHistoryResponseSchema,
  ticketAgenticRefusalsResponseSchema,
} from "../../src/contract/responses.ts";
import { postgresAgenticRefusalReads } from "../../src/adapters/postgres/agenticRefusal.ts";
import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import {
  postgresSelectorProjectSettings,
  postgresSelectorResolvedSettings,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import { selectorControlRole } from "../../src/adapters/postgres/schema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { leadAdmissionRefusals } from "../../src/contract/rosters.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import {
  asSessionStoreStream,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { postgresHarnessKeying, postgresHarnessRolePool } from "./harness.ts";
import { sessionStoreDouble, sessionStoreEntryLine } from "./storeDouble.ts";
import {
  leadRigDecision,
  leadRigOpen,
  leadRigProject,
  type LeadRig,
} from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurnId,
} from "./sessionHarness.ts";

let rig: LeadRig;

before(async () => {
  rig = await leadRigOpen();
});

after(async () => {
  await rig.close();
});

const issuer = "https://issuer.test";
/** The volume the batch rows point at, filled by the cases that record one. */
const storeReads = sessionStoreDouble();

const authorized = { authorization: "Bearer token" };

/** One lead with a claimed attempt, which is what a pod holds while it writes. */
async function claimedLead(label: string) {
  const partition = await readableProject(label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  const turn = sessionRigTurnId(label);
  await rig.mailbox.offer({
    partition,
    turn,
    input: '{"version":1}',
    route: "InCluster",
  });
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    label,
  );
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  return { partition, session, turn, attempt };
}

/** One batch of one entry, recorded through the plane the pod actually uses. */
async function recordBatch(
  partition: Partition,
  session: SessionId,
  attempt: Awaited<ReturnType<typeof claimedLead>>["attempt"],
  stream: string,
  batch: number,
): Promise<void> {
  storeReads.put(
    {
      partition,
      session,
      stream: asSessionStoreStream(stream),
      batch,
    },
    sessionStoreEntryLine(batch),
  );
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream: asSessionStoreStream(stream),
      batch,
      digest: "b".repeat(64),
      bytes: 12,
      events: 1,
    }),
    "Stored",
  );
}

/** The app the routes are driven through, over the API role and the real ports. */
function leadApp(subject: string) {
  const pool = rig.apiPool;
  const leads = postgresLeadReads(pool);
  const web = composeNativeWeb(
    pool,
    postgresHarnessKeying(),
    rig.sessions.harness.access,
    postgresExecutionBacklogGuard(pool),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      leads,
      store: storeReads,
      refusals: postgresAgenticRefusalReads(pool),
      history: leads,
      settings: postgresSelectorResolvedSettings(pool),
    },
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal: oidcPrincipal(issuer, subject) },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
}

/** A project the reader may read, which is what the routes are gated on. */
async function readableProject(label: string): Promise<Partition> {
  const partition = await leadRigProject(rig, label);
  rig.sessions.harness.access.grant({
    partition,
    principal: oidcPrincipal(issuer, label),
    access: new Set(["Read"]),
  });
  return partition;
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
}

test("the lead route reads a real lead, its mailbox tail and its streams", async () => {
  const { partition, session, turn, attempt } = await claimedLead("http-lead");
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  await recordBatch(partition, session, attempt, stream, 1);
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
    batchFirst: 1,
    batchLast: 1,
    measured: {
      model: "claude-model",
      tokens: 10,
      costMicros: 20,
      durationMs: 30,
      tools: [],
    },
  });

  await using app = leadApp("http-lead");
  const found = await app.inject({
    url: `${pathOf(partition)}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  const body = leadResponseSchema.parse(found.json());
  assert.equal(body.session, session);
  assert.equal(body.state, "Open");
  assert.deepEqual(body.handoffNote, {
    bytes: 2,
    preview: "{}",
    truncated: false,
  });
  assert.equal(body.turns[0]?.turn, turn);
  assert.equal(body.turns[0]?.tokens, 10);
  assert.deepEqual(body.streams, [{ stream, batches: 1 }]);

  const transcript = await app.inject({
    url: `${pathOf(partition)}/lead/transcript?stream=${stream}`,
    headers: authorized,
  });
  assert.equal(transcript.statusCode, 200);
  const page = leadTranscriptResponseSchema.parse(transcript.json());
  assert.deepEqual(
    page.entries.map((entry) => entry.uuid),
    ["entry-1"],
  );
  assert.deepEqual(
    page.held,
    ["entry-1"],
    "an uncompacted stream holds it all",
  );
  assert.equal(page.cut, undefined);
  assert.equal(page.truncated, false);
});

/** A lead whose store holds more batches than one page of it answers. */
async function pagedStream(label: string) {
  const opened = await claimedLead(label);
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  for (let batch = 1; batch <= sessionStorePageBatchesMax + 2; batch += 1)
    await recordBatch(
      opened.partition,
      opened.session,
      opened.attempt,
      stream,
      batch,
    );
  return {
    partition: opened.partition,
    session: opened.session,
    stream,
  };
}

test("the row read answers the limit it is given, never its own ceiling", async () => {
  const { partition, session, stream } = await pagedStream("http-store");
  const leads = postgresLeadReads(rig.apiPool);
  const asked = await leads.batches({
    partition,
    session,
    stream,
    after: 0,
    limit: 2,
  });
  assert.deepEqual(
    asked.map((row) => row.batch),
    [1, 2],
    "the function answers the limit it was given, not its own ceiling",
  );
  const capped = await leads.batches({
    partition,
    session,
    stream,
    after: 0,
    limit: sessionStorePageBatchesMax + 5,
  });
  assert.equal(
    capped.length,
    sessionStorePageBatchesMax,
    "and never more than a page, whatever it is asked for",
  );
});

test("the held walk pages the store past the page a reader asked for", async () => {
  const { partition, stream } = await pagedStream("http-walk");
  await using app = leadApp("http-walk");
  const page = leadTranscriptResponseSchema.parse(
    (
      await app.inject({
        url: `${pathOf(partition)}/lead/transcript?stream=${stream}&limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(page.entries.length, 2, "the page is the two batches asked for");
  assert.equal(page.nextAfter, 2);
  assert.deepEqual(
    page.held,
    ["entry-1", "entry-2"],
    "and the walk read past the page to decide what is held",
  );
});

test("the refusal routes page a real ledger and say when it is short", async () => {
  const partition = await readableProject("http-refusals");
  const ticket = asTicketId(42);
  const entries = agenticRefusalLedgerAnsweredMax + 2;
  for (let index = 0; index < entries; index += 1) {
    const decision = await leadRigDecision(
      rig,
      partition,
      `http-refusals-${String(index)}`,
    );
    await rig.writes.record({
      partition,
      decision,
      ...(index % 2 === 0
        ? {
            refusals: [
              { ticket, ticketVersion: 2, reason: "the dependency fails" },
            ],
            lifts: [],
          }
        : { refusals: [], lifts: [{ ticket }] }),
    });
  }

  await using app = leadApp("http-refusals");
  const ledger = ticketAgenticRefusalsResponseSchema.parse(
    (
      await app.inject({
        url: `${pathOf(partition)}/tickets/42/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(ledger.entries.length, agenticRefusalLedgerAnsweredMax);
  assert.equal(
    ledger.more,
    true,
    "read_agentic_refusals answers one past the page, so more is a fact",
  );
  assert.equal(
    ledger.standing,
    undefined,
    "and a page that stops short claims no standing",
  );

  const standing = agenticRefusalsResponseSchema.parse(
    (
      await app.inject({
        url: `${pathOf(partition)}/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.deepEqual(
    standing.refusals.map((each) => each.ticket),
    [],
    "the ledger's latest entry lifted it, so nothing stands",
  );
  assert.equal(standing.more, false);
});

test("standing_agentic_refusals answers one past its page, so more is a fact", async () => {
  const partition = await readableProject("http-standing");
  const decision = await leadRigDecision(rig, partition, "http-standing");
  const tickets = Array.from(
    { length: agenticRefusalsAnsweredMax + 1 },
    (_unused, index) => asTicketId(index + 1),
  );
  await rig.writes.record({
    partition,
    decision,
    refusals: tickets.map((ticket) => ({
      ticket,
      ticketVersion: 2,
      reason: "the dependency fails",
    })),
    lifts: [],
  });

  const reads = postgresAgenticRefusalReads(rig.apiPool);
  assert.equal(
    (await reads.standing(partition, 1)).length,
    1,
    "the function answers the limit it was given",
  );
  assert.equal(
    (await reads.standing(partition, agenticRefusalsAnsweredMax + 1)).length,
    agenticRefusalsAnsweredMax + 1,
    "and one past the page it answers, which is what makes more a fact",
  );

  await using app = leadApp("http-standing");
  const page = agenticRefusalsResponseSchema.parse(
    (
      await app.inject({
        url: `${pathOf(partition)}/agentic-refusals`,
        headers: authorized,
      })
    ).json(),
  );
  assert.equal(page.refusals.length, agenticRefusalsAnsweredMax);
  assert.equal(
    page.more,
    true,
    "a project standing on more refusals than a page says so",
  );
});

test("the decision log pages forward and answers its far end", async () => {
  const partition = await readableProject("http-history");
  const decisions: string[] = [];
  for (const label of ["one", "two", "three"])
    decisions.push(
      await leadRigDecision(rig, partition, `http-history-${label}`),
    );

  await using app = leadApp("http-history");
  const root = `${pathOf(partition)}/selector-history`;
  const first = selectorHistoryResponseSchema.parse(
    (await app.inject({ url: `${root}?limit=2`, headers: authorized })).json(),
  );
  assert.deepEqual(
    first.decisions.map((each) => each.decision),
    decisions.slice(0, 2),
    "forward from the beginning, oldest first",
  );
  assert.ok(first.nextAfter !== undefined);
  const second = selectorHistoryResponseSchema.parse(
    (
      await app.inject({
        url: `${root}?limit=2&after=${String(first.nextAfter)}`,
        headers: authorized,
      })
    ).json(),
  );
  assert.deepEqual(
    second.decisions.map((each) => each.decision),
    decisions.slice(2),
    "and the cursor continues where the page ended",
  );

  const newest = selectorHistoryResponseSchema.parse(
    (
      await app.inject({
        url: `${root}?order=newest&limit=2`,
        headers: authorized,
      })
    ).json(),
  );
  assert.deepEqual(
    newest.decisions.map((each) => each.decision),
    [...decisions].reverse().slice(0, 2),
    "the newest arm answers the far end, newest first",
  );
  assert.equal(newest.nextAfter, undefined);
  assert.ok(
    newest.decisions.every((each) => each.ordinal > 0),
    "and the ordinals are the log's own",
  );

  const refused = await app.inject({
    url: `${root}?order=newest&after=1`,
    headers: authorized,
  });
  assert.equal(refused.statusCode, 400);

  const unbounded = selectorHistoryResponseSchema.parse(
    (
      await app.inject({ url: `${root}?order=newest`, headers: authorized })
    ).json(),
  );
  assert.ok(
    unbounded.decisions.length <= selectorHistoryLimitMax,
    "asking for no limit answers at most the bound the route defaults to",
  );
  assert.equal(unbounded.decisions.length, decisions.length);
});

/**
 * The standing definer keys on a lead session, so a project holding only a
 * member's thread holds no lead, and a reader is told so rather than refused.
 */
test("a readable project whose only session is a thread answers that it has no lead", async () => {
  const partition = await readableProject("http-leadless");
  await sessionRigSession(rig.sessions, partition, "http-leadless", {
    kind: "Thread",
  });
  await using app = leadApp("http-leadless");
  const found = await app.inject({
    url: `${pathOf(partition)}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(leadNoneResponseSchema.parse(found.json()), {
    lead: "None",
    absence: { reason: "NotNeeded" },
  });
});

/** The no-lead answer the lead route gives one project, parsed as a console parses it. */
async function leadAbsence(label: string, partition: Partition) {
  await using app = leadApp(label);
  const found = await app.inject({
    url: `${pathOf(partition)}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  return leadNoneResponseSchema.parse(found.json()).absence;
}

/**
 * The refusal is written by the selector's own credential and read through the
 * API's, so a grant either side lacks is a red here rather than on the rig.
 * Its instant is when the refusal standing began: the same refusal again keeps
 * it, another starts it again, and a forgotten one leaves nothing to answer.
 */
test("a project whose lead was refused admission answers which refusal and since when, until it is forgotten", async () => {
  const partition = await readableProject("http-refused");
  const selector = postgresSelectorState(rig.selectorPool);
  await selector.recordLeadRefusal(partition, "RunnerOffline");
  const began = "2026-01-02T03:04:05.678Z";
  await rig.sessions.harness.pool.query(
    `UPDATE selector_lead_refusal SET refused_since=$3
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project, began],
  );
  assert.deepEqual(await leadAbsence("http-refused", partition), {
    reason: "RunnerOffline",
    since: began,
  });
  await selector.recordLeadRefusal(partition, "RunnerOffline");
  assert.deepEqual(await leadAbsence("http-refused", partition), {
    reason: "RunnerOffline",
    since: began,
  });
  await selector.recordLeadRefusal(partition, "HostedRunsNotGranted");
  const again = await leadAbsence("http-refused", partition);
  assert.equal(again?.reason, "HostedRunsNotGranted");
  assert.ok(again !== undefined && "since" in again);
  assert.ok(Date.parse(again.since) > Date.parse(began));
  await selector.clearLeadRefusal(partition);
  await selector.clearLeadRefusal(partition);
  assert.deepEqual(await leadAbsence("http-refused", partition), {
    reason: "NotNeeded",
  });
});

/**
 * A paused selector asks no admission, so the refusal it keeps is outranked
 * while it stays paused, by the project's own override as by the installation's
 * kill switch, each read over the API's own credential as the selector resolves it.
 */
test("a project whose selector is paused answers Paused over the refusal it keeps, until it runs again", async () => {
  const partition = await readableProject("http-paused");
  await postgresSelectorState(rig.selectorPool).recordLeadRefusal(
    partition,
    "RunnerOffline",
  );
  const administrator = {
    kind: asAuthorityKind("User"),
    subject: asAuthoritySubject("selector-admin"),
  };
  const project = postgresSelectorProjectSettings(rig.apiPool);
  const paused = await project.write(
    partition,
    0,
    { mode: "Paused" },
    administrator,
  );
  assert.equal(paused.written, "Settings");
  assert.deepEqual(await leadAbsence("http-paused", partition), {
    reason: "Paused",
  });
  assert.equal(
    (await project.write(partition, 1, {}, administrator)).written,
    "Settings",
  );
  assert.equal(
    (await leadAbsence("http-paused", partition))?.reason,
    "RunnerOffline",
  );
  const controlPool = postgresHarnessRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(controlPool);
  try {
    const stopped = await control.pause(
      (await control.settings()).revision,
      administrator,
    );
    assert.equal(stopped.updated, true);
    try {
      assert.deepEqual(await leadAbsence("http-paused", partition), {
        reason: "Paused",
      });
    } finally {
      await control.unpause((await control.settings()).revision, administrator);
    }
  } finally {
    await controlPool.end();
  }
  assert.equal(
    (await leadAbsence("http-paused", partition))?.reason,
    "RunnerOffline",
  );
});

/** A lead that exists is the answer, whatever refusal a later cycle met. */
test("a project holding a lead answers it over the refusal kept beside it", async () => {
  const partition = await readableProject("http-refused-lead");
  await sessionRigSession(rig.sessions, partition, "http-refused-lead", {
    kind: "Lead",
  });
  await postgresSelectorState(rig.selectorPool).recordLeadRefusal(
    partition,
    "HostedRunsNotGranted",
  );
  await using app = leadApp("http-refused-lead");
  const found = await app.inject({
    url: `${pathOf(partition)}/lead`,
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  assert.equal(Object.hasOwn(found.json(), "absence"), false);
  assert.equal(leadResponseSchema.safeParse(found.json()).success, true);
});

test("the refusals the wire names are the refusals the selector may keep", async () => {
  const constraint = await rig.sessions.harness.pool.query<{
    definition: string;
  }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
      WHERE c.conrelid = 'selector_lead_refusal'::regclass
        AND c.conname = 'selector_lead_refusal_is_known'`,
  );
  const definition = constraint.rows[0]?.definition;
  assert.ok(definition !== undefined, "the refusal constraint was not found");
  const admitted = [...definition.matchAll(/'([A-Za-z]+)'/gu)].map(
    ([, name]) => name,
  );
  assert.deepEqual([...admitted].sort(), [...leadAdmissionRefusals].sort());
});

/** The API reads the refusal through its door alone, and neither credential may name one the roster does not hold. */
test("the API cannot read or write the kept refusal directly, and no credential keeps an unknown one", async () => {
  const partition = await readableProject("http-refused-direct");
  await assert.rejects(
    rig.apiPool.query(`SELECT refusal FROM selector_lead_refusal`),
    /permission denied/u,
  );
  await assert.rejects(
    rig.apiPool.query(
      `INSERT INTO selector_lead_refusal (tenant,project,refusal) VALUES ($1,$2,'RunnerOffline')`,
      [partition.tenant, partition.project],
    ),
    /permission denied/u,
  );
  await assert.rejects(
    rig.selectorPool.query(
      `INSERT INTO selector_lead_refusal (tenant,project,refusal) VALUES ($1,$2,'Unknown')`,
      [partition.tenant, partition.project],
    ),
    /selector_lead_refusal_is_known/u,
  );
});

test("a project the reader has no membership in answers not found", async () => {
  const partition = await readableProject("http-denied");
  await sessionRigSession(rig.sessions, partition, "http-denied", {
    kind: "Lead",
  });
  await using app = leadApp("http-stranger");
  for (const path of [
    "/lead",
    "/lead/transcript",
    "/agentic-refusals",
    "/tickets/42/agentic-refusals",
    "/selector-history",
  ]) {
    const found = await app.inject({
      url: `${pathOf(partition)}${path}`,
      headers: authorized,
    });
    assert.equal(found.statusCode, 404, path);
  }
});
