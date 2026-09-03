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
  leadResponseSchema,
  leadTranscriptResponseSchema,
  selectorHistoryResponseSchema,
  ticketAgenticRefusalsResponseSchema,
} from "../../src/contract/responses.ts";
import { postgresAgenticRefusalReads } from "../../src/adapters/postgres/agenticRefusal.ts";
import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresProjectAccess } from "../../src/adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import { checkedProjectMembership } from "../../src/interpreter/projectMembership.ts";
import { asSessionStoreStream } from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { SessionStoreReadPort } from "../../src/interpreter/sessionStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { postgresHarnessKeying } from "./harness.ts";
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
const authorized = { authorization: "Bearer token" };

/** The bytes each recorded batch is answered with, keyed as the port addresses one. */
const stored = new Map<string, string>();

function storedKey(
  partition: Partition,
  stream: string,
  batch: number,
): string {
  return [partition.tenant, partition.project, stream, batch].join("\u0000");
}

/** A store the batch rows point at, standing in for the artifact volume. */
const storeReads: SessionStoreReadPort = {
  readBatch: (object) => {
    const content = stored.get(
      storedKey(object.partition, object.stream, object.batch),
    );
    return Promise.resolve(
      content === undefined
        ? ({ read: "NotFound" } as const)
        : ({ read: "Content", content } as const),
    );
  },
};

/** One entry per batch, chained, so a stream's batch count is its entry count. */
function entryLine(index: number): string {
  return JSON.stringify({
    type: "user",
    uuid: `entry-${String(index)}`,
    ...(index === 1 ? {} : { parentUuid: `entry-${String(index - 1)}` }),
    message: { role: "user", content: "one" },
  });
}

/** One lead with a claimed attempt, which is what a pod holds while it writes. */
async function claimedLead(label: string) {
  const partition = await readableProject(label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  const turn = sessionRigTurnId(label);
  await rig.mailbox.offer({ partition, turn, input: '{"version":1}' });
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
  attempt: Awaited<ReturnType<typeof claimedLead>>["attempt"],
  stream: string,
  batch: number,
): Promise<void> {
  stored.set(storedKey(partition, stream, batch), entryLine(batch));
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
    postgresProjectAccess(pool),
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
  await rig.sessions.harness.membership.grant(
    checkedProjectMembership({
      issuer,
      subject: label,
      tenant: partition.tenant,
      project: partition.project,
      authorityKind: "OidcUser",
      authoritySubject: `internal-${label}`,
      access: ["Read"],
    }),
  );
  return partition;
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
}

test("the lead route reads a real lead, its mailbox tail and its streams", async () => {
  const { partition, session, turn, attempt } = await claimedLead("http-lead");
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  await recordBatch(partition, attempt, stream, 1);
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
    await recordBatch(opened.partition, opened.attempt, stream, batch);
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
