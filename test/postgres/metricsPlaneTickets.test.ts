/**
 * The metrics plane's ticket families against a real server, read as the
 * plane's own role: every journal entry counted by its event and the stage its
 * report names, a landed ticket's lead and run times, its reworks, its time in
 * each phase and its work cycles, every ended work and evaluation cycle, an
 * ended ticket's settled cost, each ended escalation by who ended it, each
 * claimed attempt's wait, and the tickets where they stand, each under the
 * member who first wrote the ticket's draft and the repository its brief names.
 *
 * THE ROWS ARE WRITTEN DIRECTLY, AS THE OWNER, WITH REFERENTIAL CHECKS AND
 * TRIGGERS SET ASIDE FOR THE SEEDING TRANSACTION, as the plane's other suite
 * writes them. An entry carries its event's arm and the parts of its value
 * the plane reads, in the shape the model's types give them.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { createMetricsPlaneApp } from "../../src/adapters/http/metricsPlaneServer.ts";
import {
  postgresMetricsPlaneReads,
  postgresMetricsPlaneReady,
} from "../../src/adapters/postgres/metricsPlane.ts";
import { metricsPlaneRole } from "../../src/adapters/postgres/schema/shared.ts";
import {
  metricsPlane,
  metricsPlaneOwner,
} from "../../src/interpreter/metricsPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessOpen,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

const issuer = "https://issuer.tickets.test";
const alice = oidcPrincipal(issuer, "alice-id");
const bob = oidcPrincipal(issuer, "bob-id");
const dana = oidcPrincipal(issuer, "dana-id");

/** A catalog whose plan lints, then judges. */
const plan = {
  version: 2,
  image: "worker:v2",
  workloads: {
    make: {
      runner: "Agent",
      prompt: { text: "Make what the ticket asks." },
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
        setup: [],
        files: [],
      },
    },
    lint: { runner: "Commands", commands: ["npm run lint"] },
    judge: { runner: "Commands", commands: ["npm run judge"] },
  },
  plans: {
    gated: [
      { name: "lint", evaluators: ["lint"] },
      { name: "judge", evaluators: ["judge"] },
    ],
  },
  defaults: { work: "make", evaluation: "gated" },
};

interface TicketsPartition {
  readonly tenant: string;
  readonly project: string;
  readonly revision: string;
}

const one: TicketsPartition = {
  tenant: "tickets-one",
  project: "web",
  revision: "revision-plan",
};
const two: TicketsPartition = {
  tenant: "tickets-two",
  project: "api",
  revision: "revision-authored",
};

/** The repositories project one's first two tickets' released briefs name; its third's names none, and project two's tickets have no brief. */
const webRepository = "https://github.com/tickets/web.git";
const docsRepository = "https://github.com/tickets/docs.git";
/** The repository project one's first ticket's draft was revised to name after its release, and that it never ran in. */
const revisedRepository = "https://github.com/tickets/revised.git";

/** Seconds since the epoch at the start of the first of January, when every dated entry is committed from. */
const baseSecs = 1_767_225_600;

/** When an entry was committed: that many seconds past the base, or that many before the scrape. */
type TicketsAt =
  { readonly past: number } | { readonly beforeScrapeSecs: number };

/** One entry: its partition, ticket, event, what caused it, and when. */
interface TicketsEntry {
  readonly partition: TicketsPartition;
  readonly ticket: number;
  readonly event: unknown;
  readonly at: TicketsAt;
  readonly operation?: string;
}

/** An evaluation task of `ticket` at a 1-based `stage`, as a report names it. */
function ticketsEvaluationTask(ticket: number, stage: number) {
  return {
    type: "EvaluationTask",
    value: { ticket, workCycle: 1, stage, generation: 1, evaluator: 1 },
  };
}

/** A report-carrying evaluation event of `type` at `stage`, its report a result. */
function ticketsEvaluated(type: string, ticket: number, stage: number) {
  return {
    type,
    value: {
      ticket,
      report: {
        type: "EvaluationResultReport",
        value: {
          ticket,
          result: {
            obligation: { task: ticketsEvaluationTask(ticket, stage) },
            resultRef: 1,
          },
          verdict:
            type === "TicketEvaluationReworkStarted"
              ? "EvaluatorFail"
              : "EvaluatorPass",
        },
      },
      evidence: [],
    },
  };
}

/** An event whose value is its ticket alone, or whose value names it. */
function ticketsEvent(type: string, ticket: number) {
  switch (type) {
    case "TicketCreated":
      return { type, value: { id: ticket } };
    case "TicketRevoked":
    case "TicketWorkResumed":
      return { type, value: ticket };
    default:
      return { type, value: { ticket } };
  }
}

/** The first ticket of project one: sent back by lint, failed and resumed by the scheduler, escalated by judge and resumed by a member, sent back by landing, landed. */
const landedEntries: readonly TicketsEntry[] = [
  ["TicketCreated", 0],
  ["TicketDispatched", 60],
  ["TicketWorkResultAccepted", 120],
  [ticketsEvaluated("TicketEvaluationReworkStarted", 1, 1), 180],
  ["TicketWorkProcessFailed", 300],
  ["TicketWorkResumed", 301, "operation-scheduler"],
  ["TicketWorkResultAccepted", 400],
  [ticketsEvaluated("TicketEvaluationProgressed", 1, 1), 420],
  [ticketsEvaluated("TicketEvaluationFailureEscalated", 1, 2), 500],
  ["TicketWorkResumed", 545, "operation-member"],
  ["TicketWorkResultAccepted", 600],
  [ticketsEvaluated("TicketEvaluationProgressed", 1, 1), 620],
  [ticketsEvaluated("TicketEvaluationPassed", 1, 2), 650],
  ["TicketFinalizationNeedsWork", 700],
  ["TicketWorkResultAccepted", 800],
  [ticketsEvaluated("TicketEvaluationProgressed", 1, 1), 820],
  [ticketsEvaluated("TicketEvaluationPassed", 1, 2), 850],
  ["TicketFinalizationSucceeded", 7_230],
].map(([event, past, operation]) => ({
  partition: one,
  ticket: 1,
  event:
    typeof event === "string" ? ticketsEvent(event, 1) : (event as unknown),
  at: { past: past as number },
  ...(operation === undefined ? {} : { operation: operation as string }),
}));

/** The rest: project one's ticket still escalated and its ticket whose creator owns no execution, project two's revoked tickets, one revoked moments before the scrape, and its ticket landed without escalating. */
const otherEntries: readonly TicketsEntry[] = [
  {
    partition: one,
    ticket: 2,
    event: ticketsEvent("TicketCreated", 2),
    at: { past: 1_000 },
  },
  {
    partition: one,
    ticket: 2,
    event: ticketsEvent("TicketDispatched", 2),
    at: { past: 1_060 },
  },
  {
    partition: one,
    ticket: 2,
    event: ticketsEvent("TicketWorkResultAccepted", 2),
    at: { past: 1_100 },
  },
  {
    partition: one,
    ticket: 2,
    event: {
      type: "TicketEvaluationBlocked",
      value: {
        ticket: 2,
        report: {
          type: "TerminalFailureReport",
          value: {
            ticket: 2,
            failure: { task: ticketsEvaluationTask(2, 1), evidence: 1 },
            kind: "ExecutionUnavailableFailure",
          },
        },
      },
    },
    at: { past: 1_200 },
  },
  {
    partition: one,
    ticket: 3,
    event: ticketsEvent("TicketCreated", 3),
    at: { past: 2_000 },
  },
  {
    partition: one,
    ticket: 3,
    event: ticketsEvent("TicketDispatched", 3),
    at: { past: 2_060 },
  },
  {
    partition: two,
    ticket: 1,
    event: ticketsEvent("TicketCreated", 1),
    at: { past: 0 },
  },
  {
    partition: two,
    ticket: 1,
    event: ticketsEvent("TicketDispatched", 1),
    at: { past: 60 },
  },
  {
    partition: two,
    ticket: 1,
    event: ticketsEvent("TicketWorkResultAccepted", 1),
    at: { past: 120 },
  },
  {
    partition: two,
    ticket: 1,
    event: ticketsEvaluated("TicketEvaluationProgressed", 1, 1),
    at: { past: 200 },
  },
  {
    partition: two,
    ticket: 1,
    event: ticketsEvent("TicketRevoked", 1),
    at: { past: 5_000 },
  },
  ...[
    ["TicketCreated", 10_000],
    ["TicketDispatched", 10_060],
    ["TicketWorkResultAccepted", 10_200],
    [ticketsEvaluated("TicketEvaluationPassed", 3, 1), 10_300],
    ["TicketFinalizationSucceeded", 10_400],
  ].map(([event, past]) => ({
    partition: two,
    ticket: 3,
    event:
      typeof event === "string" ? ticketsEvent(event, 3) : (event as unknown),
    at: { past: past as number },
  })),
  {
    partition: two,
    ticket: 2,
    event: ticketsEvent("TicketCreated", 2),
    at: { beforeScrapeSecs: 60 },
  },
  {
    partition: two,
    ticket: 2,
    event: ticketsEvent("TicketRevoked", 2),
    at: { beforeScrapeSecs: 1 },
  },
];

let harness: PostgresHarness;
let plane: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  plane = postgresHarnessRolePool(metricsPlaneRole);
  const seeding = await harness.begin();
  try {
    await ticketsSeeded(seeding.query);
  } catch (failure) {
    await seeding.rollback();
    throw failure;
  }
  await seeding.commit();
});
after(async () => {
  await plane.end();
  await harness.close();
});

type TicketsQuery = (
  sql: string,
  values?: readonly unknown[],
) => Promise<unknown>;

/** Every entry, in the order they were committed, each partition's sequence counting from one. */
async function ticketsJournalled(query: TicketsQuery): Promise<void> {
  const nowSecs = Date.now() / 1_000;
  const atSecs = (at: TicketsAt) =>
    "past" in at ? baseSecs + at.past : nowSecs - at.beforeScrapeSecs;
  const entries = [...landedEntries, ...otherEntries].sort(
    (left, right) => atSecs(left.at) - atSecs(right.at),
  );
  const heads = new Map<TicketsPartition, number>();
  for (const [index, entry] of entries.entries()) {
    const seq = (heads.get(entry.partition) ?? 0) + 1;
    heads.set(entry.partition, seq);
    await query(
      `INSERT INTO journal_entry (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
         recovery_epoch,committed_at,cause_kind,cause_id,integrity_version,configuration_revision,
         configuration_digest)
       VALUES ($1,$2,$3,$4,'digest','digest','owner',1,'epoch',to_timestamp($5),$6,$7,2,$8,'digest')`,
      [
        entry.partition.tenant,
        entry.partition.project,
        seq,
        JSON.stringify({ seq, event: entry.event }),
        atSecs(entry.at),
        entry.operation === undefined ? "Ticket" : "Operation",
        entry.operation ?? `cause-${String(index)}`,
        entry.partition.revision,
      ],
    );
  }
}

/** One execution of `ticket`'s `task` and its one attempt, ended `endedSecs` past the base and costing `costMicros`, claimed as it ended after waiting `waitSecs` or claimed by nothing. */
async function ticketsRun(
  query: TicketsQuery,
  partition: TicketsPartition,
  [ticket, task]: readonly [number, number],
  execution: string,
  [endedSecs, waitSecs]: readonly [number, number | undefined],
  costMicros: number,
): Promise<void> {
  const keys = [partition.tenant, partition.project, execution];
  await query(
    `INSERT INTO execution_request_task (tenant,project,request,task,kind,stage,cycle,generation,evaluator)
     VALUES ($1,$2,$3,$4,'Work',NULL,1,NULL,NULL)`,
    [...keys, task],
  );
  await query(
    `INSERT INTO execution (tenant,project,execution,ticket,task,source_request,account,cluster,
       configuration_revision,configuration_digest,requirement_identity,requirement_value,
       requirement_digest,requirement_source,platform_default_version,owner,placement)
     VALUES ($1,$2,$3,$4,$7,$3,'account','cluster',$5,'digest',$3,'{}','digest','TicketDefault',1,$6,
       'InCluster')`,
    [
      ...keys,
      ticket,
      partition.revision,
      partition === one ? alice : bob,
      task,
    ],
  );
  await query(
    `INSERT INTO execution_attempt (tenant,project,execution,attempt,attempt_number,recovery_epoch,
       state,opened_at,claimed_at,ended_at,capability,manifest,personal)
     VALUES ($1,$2,$3,$3,1,'epoch','Reported',to_timestamp($4::float8-coalesce($5::float8,0)),
       CASE WHEN $5::float8 IS NOT NULL THEN to_timestamp($4) END,to_timestamp($4),$3,$3,false)`,
    [...keys, baseSecs + endedSecs, waitSecs ?? null],
  );
  await query(
    `INSERT INTO execution_run_model_usage (tenant,project,execution,attempt,model,tokens_input,
       tokens_output,tokens_cache_creation,tokens_cache_read,cost_usd_micros)
     VALUES ($1,$2,$3,$3,'model',0,0,0,0,$4)`,
    [...keys, costMicros],
  );
}

/**
 * Project one's released briefs: its first two tickets each in a repository of
 * their own, its third in none. The first's draft has since been revised to
 * name another, which no update followed, so the brief it runs still names its
 * own.
 */
async function ticketsBriefed(query: TicketsQuery): Promise<void> {
  for (const [ticket, repository] of [
    [1, webRepository],
    [2, docsRepository],
    [3, null],
  ] as const)
    await query(
      `INSERT INTO ticket_definition (tenant,project,ticket,definition,digest,brief)
       VALUES ($1,$2,$3,'{}'::jsonb,'digest',
               jsonb_strip_nulls(jsonb_build_object('intent','An intent the plane never reads.','repository',$4::text)))`,
      [one.tenant, one.project, ticket, repository],
    );
  await query(
    `INSERT INTO draft_brief (tenant,project,ticket,intent,repository,finalization_kind)
     VALUES ($1,$2,1,'An intent the plane never reads.',$3,'None')`,
    [one.tenant, one.project, revisedRepository],
  );
}

async function ticketsSeeded(query: TicketsQuery): Promise<void> {
  await query("SET LOCAL session_replication_role = replica");
  await query(
    `INSERT INTO configuration_revision (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
     VALUES ($1,$2,$3,$4,'digest','Member','author'),($5,$6,$7,$8,'digest','Member','author')`,
    [
      ...[one.tenant, one.project, one.revision, JSON.stringify(plan)],
      ...[two.tenant, two.project, two.revision, postgresHarnessConfiguration],
    ],
  );
  for (const [partition, ticket, version, principal] of [
    [one, 1, 1, alice],
    [one, 1, 2, bob],
    [one, 2, 1, alice],
    [one, 3, 1, dana],
    [two, 1, 1, bob],
    [two, 2, 1, bob],
    [two, 3, 1, bob],
  ] as const)
    await query(
      `INSERT INTO draft_revision (tenant,project,ticket,authoring_version,configuration_revision,
         authoring,authority_kind,authority_subject)
       VALUES ($1,$2,$3,$4,$5,'{}','Member',$6)`,
      [
        partition.tenant,
        partition.project,
        ticket,
        version,
        partition.revision,
        principal,
      ],
    );
  for (const [operation, kind, subject] of [
    ["operation-scheduler", "ExecutionScheduler", "scheduler"],
    ["operation-member", "Member", alice],
  ])
    await query(
      `INSERT INTO operation (tenant,project,operation,authority_kind,authority_subject,admission,
         key_version,key_digest,payload_digest,command,command_tag)
       VALUES ($1,$2,$3,$4,$5,'Ordinary','v1',$3,'digest','{}','ResumeWork')`,
      [one.tenant, one.project, operation, kind, subject],
    );
  await ticketsJournalled(query);
  await ticketsRun(query, one, [1, 1], "execution-make", [100, 45], 1_500_000);
  await ticketsRun(query, one, [1, 2], "execution-lint", [200, 200], 250_000);
  await ticketsRun(
    query,
    two,
    [1, 1],
    "execution-early",
    [3_000, undefined],
    400_000,
  );
  await ticketsRun(query, two, [1, 2], "execution-late", [9_000, 5], 7_000_000);
  await ticketsRun(query, one, [2, 1], "execution-docs", [1_150, 30], 100_000);
  await ticketsBriefed(query);
  await query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,escalation)
     VALUES ($1,$2,1,'Done',18,'NoEscalation'),($1,$2,2,'Escalated',22,'EvaluationBlockedEscalated'),
            ($1,$2,3,'Work',24,'NoEscalation'),($3,$4,1,'Revoked',5,'NoEscalation'),
            ($3,$4,2,'Revoked',7,'NoEscalation')`,
    [one.tenant, one.project, two.tenant, two.project],
  );
}

/** Every sample line of the page the plane serves, in the format `accept` asks for. */
async function ticketsSamples(accept?: string): Promise<readonly string[]> {
  const app = createMetricsPlaneApp({
    scrape: metricsPlane(postgresMetricsPlaneReads(plane, 10_000), {
      issuer,
      seriesMax: 10_000,
    }).scrape,
    ready: () => postgresMetricsPlaneReady(plane, metricsPlaneRole),
  });
  try {
    const answered = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: accept === undefined ? {} : { accept },
    });
    assert.equal(answered.statusCode, 200, answered.body);
    return answered.body
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"));
  } finally {
    await app.close();
  }
}

/** The sample lines of the family `name`, sorted. */
async function ticketsFamily(name: string): Promise<readonly string[]> {
  return (await ticketsSamples())
    .filter((line) =>
      new RegExp(`^${name}(?:_bucket|_sum|_count)?[{ ]`, "u").test(line),
    )
    .toSorted();
}

/** A histogram's lines under `labels`: the cumulative count at or below each of `bounds`, then its sum and count. */
function ticketsHistogram(
  name: string,
  labels: string,
  bounds: readonly number[],
  observed: readonly number[],
  sum: number,
): readonly string[] {
  return [
    ...[...bounds.map(String), "+Inf"].map(
      (le, index) =>
        `${name}_bucket{${labels},le="${le}"} ${String(observed.filter((value) => index === bounds.length || value <= (bounds[index] ?? 0)).length)}`,
    ),
    `${name}_sum{${labels}} ${String(sum)}`,
    `${name}_count{${labels}} ${String(observed.length)}`,
  ];
}

const aliceWeb = `tenant="tickets-one",project="web",repository="${webRepository}",owner="alice-id"`;
const aliceDocs = `tenant="tickets-one",project="web",repository="${docsRepository}",owner="alice-id"`;
const danaOne = `tenant="tickets-one",project="web",repository="",owner="dana-id"`;
const bobTwo = `tenant="tickets-two",project="api",repository="",owner="bob-id"`;
const timeBounds = [
  900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 345600, 604800, 1209600,
];

test("every journal entry is counted by its event, an evaluation report's under its stage's name or, where its configuration names none, its number", async () => {
  const counted = (
    labels: string,
    event: string,
    stage: string,
    entries: number,
  ) =>
    `chuggy_ticket_events_total{${labels},event="${event}",stage="${stage}"} ${String(entries)}`;
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_events_total"),
    [
      counted(aliceWeb, "TicketCreated", "", 1),
      counted(aliceWeb, "TicketDispatched", "", 1),
      counted(aliceWeb, "TicketWorkResultAccepted", "", 4),
      counted(aliceWeb, "TicketEvaluationReworkStarted", "lint", 1),
      counted(aliceWeb, "TicketWorkProcessFailed", "", 1),
      counted(aliceWeb, "TicketWorkResumed", "", 2),
      counted(aliceWeb, "TicketEvaluationProgressed", "lint", 3),
      counted(aliceWeb, "TicketEvaluationFailureEscalated", "judge", 1),
      counted(aliceWeb, "TicketEvaluationPassed", "judge", 2),
      counted(aliceWeb, "TicketFinalizationNeedsWork", "", 1),
      counted(aliceWeb, "TicketFinalizationSucceeded", "", 1),
      counted(aliceDocs, "TicketCreated", "", 1),
      counted(aliceDocs, "TicketDispatched", "", 1),
      counted(aliceDocs, "TicketWorkResultAccepted", "", 1),
      counted(aliceDocs, "TicketEvaluationBlocked", "lint", 1),
      counted(danaOne, "TicketCreated", "", 1),
      counted(danaOne, "TicketDispatched", "", 1),
      counted(bobTwo, "TicketCreated", "", 3),
      counted(bobTwo, "TicketDispatched", "", 2),
      counted(bobTwo, "TicketWorkResultAccepted", "", 2),
      counted(bobTwo, "TicketEvaluationProgressed", "1", 1),
      counted(bobTwo, "TicketEvaluationPassed", "1", 1),
      counted(bobTwo, "TicketFinalizationSucceeded", "", 1),
      counted(bobTwo, "TicketRevoked", "", 2),
    ].toSorted(),
  );
});

test("a landed ticket's lead time runs from its release and its run time from its first dispatch", async () => {
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_lead_time_seconds"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_lead_time_seconds",
        aliceWeb,
        timeBounds,
        [7_230],
        7_230,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_lead_time_seconds",
        bobTwo,
        timeBounds,
        [400],
        400,
      ),
    ].toSorted(),
  );
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_run_time_seconds"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_run_time_seconds",
        aliceWeb,
        timeBounds,
        [7_170],
        7_170,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_run_time_seconds",
        bobTwo,
        timeBounds,
        [340],
        340,
      ),
    ].toSorted(),
  );
});

test("a landed ticket's reworks are the results that sent it back, not the work cycles it entered", async () => {
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_reworks"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_reworks",
        aliceWeb,
        [0, 1, 2, 3, 4, 5, 7, 10],
        [3],
        3,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_reworks",
        bobTwo,
        [0, 1, 2, 3, 4, 5, 7, 10],
        [0],
        0,
      ),
    ].toSorted(),
  );
});

test("an ended ticket costs what its attempts ended by its end cost, once that end has settled", async () => {
  const bounds = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_cost_usd"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_cost_usd",
        `${aliceWeb},end="Done"`,
        bounds,
        [1.75],
        1.75,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_cost_usd",
        `${bobTwo},end="Revoked"`,
        bounds,
        [0.4],
        0.4,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_cost_usd",
        `${bobTwo},end="Done"`,
        bounds,
        [0],
        0,
      ),
    ].toSorted(),
    "the attempt ended after its ticket's revoke is not its cost, and the ticket revoked moments ago is not observed",
  );
});

test("each ended escalation is timed to the ticket's next entry and labelled by the authority that ended it, and an open one is not observed", async () => {
  const bounds = [
    60, 300, 900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 604800,
  ];
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_escalation_duration_seconds"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_escalation_duration_seconds",
        `${aliceWeb},event="TicketWorkProcessFailed",by="ExecutionScheduler"`,
        bounds,
        [1],
        1,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_escalation_duration_seconds",
        `${aliceWeb},event="TicketEvaluationFailureEscalated",by="Member"`,
        bounds,
        [45],
        45,
      ),
    ].toSorted(),
  );
});

const cycleBounds = [
  60, 120, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400,
  28800,
];

test("each ended work cycle runs from the entry that left its ticket in work to the ticket's next entry, and an open one is not observed", async () => {
  const cycle = (
    labels: string,
    began: string,
    ended: string,
    observed: readonly number[],
  ) =>
    ticketsHistogram(
      "chuggy_ticket_work_cycle_duration_seconds",
      `${labels},began="${began}",ended="${ended}"`,
      cycleBounds,
      observed,
      observed.reduce((total, value) => total + value, 0),
    );
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_work_cycle_duration_seconds"),
    [
      ...cycle(aliceWeb, "TicketDispatched", "TicketWorkResultAccepted", [60]),
      ...cycle(aliceDocs, "TicketDispatched", "TicketWorkResultAccepted", [40]),
      ...cycle(
        aliceWeb,
        "TicketEvaluationReworkStarted",
        "TicketWorkProcessFailed",
        [120],
      ),
      ...cycle(
        aliceWeb,
        "TicketWorkResumed",
        "TicketWorkResultAccepted",
        [99, 55],
      ),
      ...cycle(
        aliceWeb,
        "TicketFinalizationNeedsWork",
        "TicketWorkResultAccepted",
        [100],
      ),
      ...cycle(
        bobTwo,
        "TicketDispatched",
        "TicketWorkResultAccepted",
        [60, 140],
      ),
    ].toSorted(),
    "the dispatch of the ticket with no entry after it began a cycle still open",
  );
});

test("each ended evaluation cycle runs from the first of its consecutive entries leaving the ticket in evaluation to the next that does not", async () => {
  const cycle = (labels: string, ended: string, observed: readonly number[]) =>
    ticketsHistogram(
      "chuggy_ticket_evaluation_cycle_duration_seconds",
      `${labels},began="TicketWorkResultAccepted",ended="${ended}"`,
      cycleBounds,
      observed,
      observed.reduce((total, value) => total + value, 0),
    );
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_evaluation_cycle_duration_seconds"),
    [
      ...cycle(aliceWeb, "TicketEvaluationReworkStarted", [60]),
      ...cycle(aliceWeb, "TicketEvaluationFailureEscalated", [100]),
      ...cycle(aliceWeb, "TicketEvaluationPassed", [50, 50]),
      ...cycle(aliceDocs, "TicketEvaluationBlocked", [100]),
      ...cycle(bobTwo, "TicketRevoked", [4_880]),
      ...cycle(bobTwo, "TicketEvaluationPassed", [100]),
    ].toSorted(),
  );
});

const landedPhases = [
  "Pending",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
] as const;

test("a landed ticket is observed once in every phase, zero where it spent none, and its work cycles counted", async () => {
  const bounds = [
    60, 300, 900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 604800,
  ];
  const spent = (labels: string, secs: readonly number[]) =>
    landedPhases.flatMap((phase, index) =>
      ticketsHistogram(
        "chuggy_ticket_phase_time_seconds",
        `${labels},phase="${phase}"`,
        bounds,
        [secs[index] ?? 0],
        secs[index] ?? 0,
      ),
    );
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_phase_time_seconds"),
    [
      ...spent(aliceWeb, [60, 434, 260, 6_430, 46]),
      ...spent(bobTwo, [60, 140, 100, 100, 0]),
    ].toSorted(),
  );
  const cyclesBounds = [1, 2, 3, 4, 5, 7, 10];
  assert.deepEqual(
    await ticketsFamily("chuggy_ticket_work_cycles"),
    [
      ...ticketsHistogram(
        "chuggy_ticket_work_cycles",
        aliceWeb,
        cyclesBounds,
        [5],
        5,
      ),
      ...ticketsHistogram(
        "chuggy_ticket_work_cycles",
        bobTwo,
        cyclesBounds,
        [1],
        1,
      ),
    ].toSorted(),
  );
});

test("a landed ticket's phase times add up to its lead time", async () => {
  const samples = await ticketsSamples();
  const summed = (name: string, labels: string) =>
    Number(
      samples
        .find((line) => line.startsWith(`${name}_sum{${labels}} `))
        ?.split(" ")[1],
    );
  for (const labels of [aliceWeb, bobTwo])
    assert.equal(
      landedPhases
        .map((phase) =>
          summed(
            "chuggy_ticket_phase_time_seconds",
            `${labels},phase="${phase}"`,
          ),
        )
        .reduce((total, value) => total + value, 0),
      summed("chuggy_ticket_lead_time_seconds", labels),
      labels,
    );
});

test("each claimed attempt waited from its opening to its claim, and an attempt nothing claimed has no wait", async () => {
  const bounds = [10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400];
  const cluster = `phase="Work",placement="Cluster"`;
  assert.deepEqual(
    await ticketsFamily("chuggy_attempt_wait_seconds"),
    [
      ...ticketsHistogram(
        "chuggy_attempt_wait_seconds",
        `${aliceWeb},${cluster}`,
        bounds,
        [45, 200],
        245,
      ),
      ...ticketsHistogram(
        "chuggy_attempt_wait_seconds",
        `${aliceDocs},${cluster}`,
        bounds,
        [30],
        30,
      ),
      ...ticketsHistogram(
        "chuggy_attempt_wait_seconds",
        `${bobTwo},${cluster}`,
        bounds,
        [5],
        5,
      ),
    ].toSorted(),
  );
});

test("the tickets gauge counts each owner's tickets by phase and escalation, the owner the first draft's member however many revised it", async () => {
  assert.deepEqual(
    await ticketsFamily("chuggy_tickets"),
    [
      `chuggy_tickets{${aliceWeb},phase="Done",escalation="NoEscalation"} 1`,
      `chuggy_tickets{${aliceDocs},phase="Escalated",escalation="EvaluationBlockedEscalated"} 1`,
      `chuggy_tickets{${danaOne},phase="Work",escalation="NoEscalation"} 1`,
      `chuggy_tickets{${bobTwo},phase="Revoked",escalation="NoEscalation"} 2`,
    ].toSorted(),
  );
});

test("each ticket counter and histogram series began at the earliest entry it sums", async () => {
  const samples = await ticketsSamples(
    "application/openmetrics-text;version=1.0.0;escaping=allow-utf-8;q=0.6,*/*;q=0.2",
  );
  for (const expected of [
    `chuggy_ticket_events_created{${aliceWeb},event="TicketCreated",stage=""} ${String(baseSecs)}`,
    `chuggy_ticket_events_created{${aliceWeb},event="TicketEvaluationPassed",stage="judge"} ${String(baseSecs + 650)}`,
    `chuggy_ticket_lead_time_seconds_created{${aliceWeb}} ${String(baseSecs + 7_230)}`,
    `chuggy_ticket_cost_usd_created{${bobTwo},end="Revoked"} ${String(baseSecs + 5_000)}`,
    `chuggy_ticket_escalation_duration_seconds_created{${aliceWeb},event="TicketEvaluationFailureEscalated",by="Member"} ${String(baseSecs + 545)}`,
    `chuggy_ticket_work_cycle_duration_seconds_created{${aliceWeb},began="TicketWorkResumed",ended="TicketWorkResultAccepted"} ${String(baseSecs + 400)}`,
    `chuggy_ticket_evaluation_cycle_duration_seconds_created{${aliceWeb},began="TicketWorkResultAccepted",ended="TicketEvaluationPassed"} ${String(baseSecs + 650)}`,
    `chuggy_ticket_phase_time_seconds_created{${bobTwo},phase="Escalated"} ${String(baseSecs + 10_400)}`,
    `chuggy_ticket_work_cycles_created{${aliceWeb}} ${String(baseSecs + 7_230)}`,
    `chuggy_attempt_wait_seconds_created{${aliceWeb},phase="Work",placement="Cluster"} ${String(baseSecs + 100)}`,
  ])
    assert.ok(samples.includes(expected), expected);
});

test("a ticket family past the series a page may carry is refused whole", async () => {
  assert.deepEqual(
    await postgresMetricsPlaneReads(plane, 10_000).read({
      seriesMax: 4,
      owner: (principal) => metricsPlaneOwner(issuer, principal),
    }),
    {
      read: "Refused",
      why: "a family carries more than 4 series, the cap on the series one page carries",
    },
  );
});

test("a ticket's families and its executions' are labelled by the repository its released brief names, not its draft's, and by none where it names none or has no brief", async () => {
  const ran = `phase="Work",stage="",runner="Agent",placement="Cluster",workload="make",state="Reported"`;
  assert.deepEqual(
    await ticketsFamily("chuggy_attempts_ended_total"),
    [
      `chuggy_attempts_ended_total{${aliceWeb},${ran}} 2`,
      `chuggy_attempts_ended_total{${aliceDocs},${ran}} 1`,
      `chuggy_attempts_ended_total{${bobTwo},phase="Work",stage="",runner="Agent",placement="Cluster",workload="",state="Reported"} 2`,
    ].toSorted(),
  );
  assert.deepEqual(
    (await ticketsFamily("chuggy_tickets")).filter((line) =>
      line.includes('project="web"'),
    ),
    [
      `chuggy_tickets{${aliceWeb},phase="Done",escalation="NoEscalation"} 1`,
      `chuggy_tickets{${aliceDocs},phase="Escalated",escalation="EvaluationBlockedEscalated"} 1`,
      `chuggy_tickets{${danaOne},phase="Work",escalation="NoEscalation"} 1`,
    ].toSorted(),
    "one project's tickets in two repositories are told apart, and the one whose brief names none is labelled empty",
  );
  assert.ok(
    !(await ticketsSamples()).some((line) => line.includes(revisedRepository)),
    "a draft revised after its release labels nothing",
  );
});
