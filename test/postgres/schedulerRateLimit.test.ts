/**
 * A job a usage limit stopped on the runner that claimed it, against a real
 * PostgreSQL and the real writer: the scheduler resumes the ticket's
 * escalation as a person would once a runner of the account the run spent
 * would claim it, the agent as a whole or the credentials that runner names
 * being free, until the job has been stopped so at its place as many times as
 * its bound allows.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows, and counts only the answers the scheduler
 * submitted there. Each pool is registered by a member of its own, and each
 * personal runner is of a pool's member or of one of its own, so no two cases
 * share an account.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresWorkerRunEnded } from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRoster,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  asAttemptCapabilitySecret,
  type ExecutionId,
  type PhysicalAttempt,
  type WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import { executionSchedulerLaunch } from "../../src/interpreter/executionSchedulerRun.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { RunEndedEvidence } from "../../src/interpreter/runEvidence.ts";
import type {
  PersonalRunnerIdentity,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
import type { WorkerRunnerCredentials } from "../../src/contract/workerPool.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  agentAccountHarnessCommitted,
  agentAccountHarnessPressed,
} from "./agentAccountHarness.ts";
import { postgresHarnessDrain } from "./harness.ts";
import { schedulerInvocation } from "./schedulerHarness.ts";
import {
  schedulerResumeAdmitted,
  schedulerResumeInvoked,
  schedulerResumeRigOpen,
  schedulerResumeSteps,
  type SchedulerResumeRouted,
} from "./schedulerResumeHarness.ts";

const resume = await schedulerResumeRigOpen();
const { rig, service } = resume;
const steps = schedulerResumeSteps(resume);

after(() => resume.close());

/** How many tasks at one place a limit stops before a person answers. */
const rateLimitsMax = service.config.attemptRateLimitsMax;

/** An invocation whose run spends Claude, so its attempt names the agent its account is paused on. */
const claudeInvocation: WorkTaskInvocation = {
  ...schedulerInvocation,
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
};

type Routed = SchedulerResumeRouted;

/** A pool of a ticket's project, and the member whose account its runs spend where one registered it. */
interface Runner {
  readonly pool: WorkerPoolIdentity;
  readonly account: Principal | undefined;
}

/** Registers a pool in the ticket's project, by a member of its own unless `registered` is false, and grants it `Execute`. */
async function runnerOf(routed: Routed, registered = true): Promise<Runner> {
  const { partition } = routed.project;
  const principal = asPrincipal(`https://issuer.invalid#pool-${randomUUID()}`);
  const account = registered
    ? asPrincipal(`https://issuer.invalid#member-${randomUUID()}`)
    : undefined;
  assert.equal(
    await postgresWorkerPoolRegistry(resume.apiPool).register({
      partition,
      pool: "runner-a",
      capabilities: ["Platform:Linux:Amd64"],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
      ...(account === undefined ? {} : { registeredBy: account }),
    }),
    true,
  );
  resume.access.grant({ partition, principal, access: new Set(["Execute"]) });
  const [pool] = (
    await postgresWorkerPoolRoster(rig.pool).registered(partition)
  ).pools;
  assert.ok(pool !== undefined);
  return { pool, account };
}

/** Registers the ticket's newest spawn on the pool route and admits `tasks` of its tasks. */
const newestAdmitted = (routed: Routed, tasks?: number) =>
  schedulerResumeAdmitted(resume, routed, tasks);

/** The one task of the ticket's newest spawn, registered and admitted. */
async function newestOne(routed: Routed): Promise<ExecutionId> {
  const [execution] = await newestAdmitted(routed);
  assert.ok(execution !== undefined);
  return execution;
}

/** Has the pool claim the execution's attempt, opened and invoked to spend Claude, answering the attempt and its bearer. */
async function claimed(
  routed: Routed,
  execution: ExecutionId,
  runner: Runner,
): Promise<{ attempt: PhysicalAttempt; bearer: string }> {
  const attempt = await schedulerResumeInvoked(
    resume,
    routed,
    execution,
    claudeInvocation,
  );
  return { attempt, bearer: await claimedWaiting(runner) };
}

/** Has the pool claim the attempt waiting for it, answering the bearer it was claimed under. */
async function claimedWaiting(runner: Runner): Promise<string> {
  const bearer = `bearer-${randomUUID()}`;
  assert.notEqual(
    await resume.assignments.claim(
      runner.pool,
      {
        leaseSecs: service.config.attemptLeaseSecs,
        heldMax: 1,
        memoryMibDefault: service.poolMemoryMib,
      },
      `assignment-${randomUUID()}`,
      bearer,
      [],
    ),
    undefined,
  );
  return bearer;
}

/** The run under `bearer` ends itself as `evidence`, naming a limit of `credential` that resets `resetsSecs` from now where it is rate-limited, and a pass concludes it. */
async function ended(
  routed: Routed,
  bearer: string,
  evidence: RunEndedEvidence,
  resetsSecs?: number,
  credential?: string,
): Promise<void> {
  await endedUndecided(routed, bearer, evidence, resetsSecs, credential);
  await steps.drained(routed);
}

/** `ended`, short of the writer deciding the completion the pass submitted. */
async function endedUndecided(
  routed: Routed,
  bearer: string,
  evidence: RunEndedEvidence,
  resetsSecs?: number,
  credential?: string,
): Promise<void> {
  assert.equal(
    await postgresWorkerRunEnded(resume.workerPool).end({
      secret: asAttemptCapabilitySecret(bearer),
      generation: 1,
      evidence,
      ...(resetsSecs === undefined
        ? {}
        : {
            limit: {
              window: "five_hour",
              resetsAt: Math.floor(Date.now() / 1_000) + resetsSecs,
              ...(credential === undefined ? {} : { credential }),
            },
          }),
    }),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
}

/** The usage limit stops the run under `bearer`, resetting an hour from now unless `resetsSecs` says otherwise, on `credential` where one is named. */
function rateLimited(
  routed: Routed,
  bearer: string,
  resetsSecs = 3_600,
  credential?: string,
): Promise<void> {
  return ended(routed, bearer, "RunRateLimited", resetsSecs, credential);
}

/** The run under `bearer` fails on its runner, which is a loss there. */
function lostOnRunner(routed: Routed, bearer: string): Promise<void> {
  return ended(routed, bearer, "RunFailed");
}

/** The limit the account was stopped at reaches its reset. */
async function limitReset(runner: Runner): Promise<void> {
  assert.ok(runner.account !== undefined);
  await rig.harness.query(
    `UPDATE agent_account_limit SET resets_at=now()-interval '1 second'
      WHERE principal=$1 AND agent='Claude'`,
    [runner.account],
  );
}

/**
 * What the ticket's read says of the scheduler resuming its escalation once its
 * usage pauses end, read as the API under the scheduler's own bounds: absent
 * where it will not, and how many seconds from now the latest pause ends where
 * one still holds, rounded to the minute.
 */
async function usageResumeRead(
  routed: Routed,
): Promise<{ readonly untilMins?: number } | undefined> {
  const { partition, ticket } = routed.project;
  const read = await postgresNativeReads(resume.apiPool, {
    lossesMax: service.config.attemptRetriesMax,
    rateLimitsMax,
  }).ticket(partition, asTicketId(ticket));
  const usageResume = read?.escalation?.usageResume;
  if (usageResume === undefined) return undefined;
  return usageResume.until === undefined
    ? {}
    : {
        untilMins: Math.round(
          (Date.parse(usageResume.until) - Date.now()) / 60_000,
        ),
      };
}

/** What the rate-limit door answers for the ticket, past whatever a pass would have chosen. */
function resumedAtDoor(routed: Routed) {
  const { partition, ticket } = routed.project;
  return rig.store.resumeRateLimit({
    ticket: { partition, ticket: asTicketId(ticket) },
    lossesMax: service.config.attemptRetriesMax,
    rateLimitsMax,
    mailbox: service.ticketService,
  });
}

/** Moves every attempt of the ticket's project that ended back by `secs`, as though that much time had passed. */
async function endedEarlier(routed: Routed, secs: number): Promise<void> {
  const { partition } = routed.project;
  const moving = await rig.harness.begin();
  try {
    await moving.query("SET LOCAL session_replication_role=replica");
    await moving.query(
      `UPDATE execution_attempt SET ended_at=ended_at-make_interval(secs=>$3)
        WHERE tenant=$1 AND project=$2 AND ended_at IS NOT NULL`,
      [partition.tenant, partition.project, secs],
    );
  } catch (error) {
    await moving.rollback();
    throw error;
  }
  await moving.commit();
}

const workEscalated = {
  phase: "Escalated",
  escalation: "WorkFailureEscalated",
};
const evaluationEscalated = {
  phase: "Escalated",
  escalation: "EvaluationBlockedEscalated",
};

test("work a usage limit stopped is resumed once its account's limit resets, and not before", async () => {
  const { routed, execution } = await steps.routedTicket("limit-work");
  const runner = await runnerOf(routed);
  const { bearer } = await claimed(routed, execution, runner);
  await rateLimited(routed, bearer);
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.deepEqual(await steps.standing(routed), workEscalated);
  await limitReset(runner);
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
  const again = await claimed(routed, await newestOne(routed), runner);
  await steps.reported(routed, again.attempt, "Pass");
  assert.equal((await steps.standing(routed))?.["phase"], "Evaluation");
  assert.equal(await steps.schedulerAnswers(routed), 1);
});

test("an evaluation a usage limit stopped is resumed once its account's limit resets, and not before", async () => {
  const { routed, execution } = await steps.routedTicket("limit-evaluation");
  const runner = await runnerOf(routed);
  const work = await claimed(routed, execution, runner);
  await steps.reported(routed, work.attempt, "Pass");
  const evaluation = await claimed(routed, await newestOne(routed), runner);
  await rateLimited(routed, evaluation.bearer);
  assert.deepEqual(await steps.standing(routed), evaluationEscalated);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await limitReset(runner);
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Evaluation");
  const again = await claimed(routed, await newestOne(routed), runner);
  await steps.reported(routed, again.attempt, "Pass");
  assert.deepEqual(await steps.standing(routed), {
    phase: "Finalization",
    escalation: "NoEscalation",
  });
});

test("a threshold raised over the reading that pauses the account makes the ticket resumable at the next pass", async () => {
  const { routed, execution } = await steps.routedTicket("limit-threshold");
  const runner = await runnerOf(routed);
  assert.ok(runner.account !== undefined);
  const { bearer } = await claimed(routed, execution, runner);
  await rateLimited(routed, bearer);
  const reading = {
    window: "five_hour",
    utilization: 0.85,
    resetsSecs: 3_600,
    observedSecs: 0,
  } as const;
  await agentAccountHarnessCommitted(rig.harness, runner.account, "Claude", {
    readings: [reading],
  });
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await agentAccountHarnessCommitted(rig.harness, runner.account, "Claude", {
    readings: [reading],
    setting: {
      fiveHourPercent: 90,
      sevenDayPercent: 90,
      pausesThreads: false,
    },
  });
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

test("a try-again press makes the ticket resumable at the next pass, and lets its next run be claimed", async () => {
  const { routed, execution } = await steps.routedTicket("limit-press");
  const runner = await runnerOf(routed);
  assert.ok(runner.account !== undefined);
  const { bearer } = await claimed(routed, execution, runner);
  await rateLimited(routed, bearer);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await agentAccountHarnessPressed(rig.harness, runner.account, "Claude");
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
  await claimed(routed, await newestOne(routed), runner);
});

test("a run that spent no account waits an hour from its end, as an unknown reset does", async () => {
  const { routed, execution } = await steps.routedTicket("limit-no-account");
  const runner = await runnerOf(routed, false);
  const { bearer } = await claimed(routed, execution, runner);
  await ended(routed, bearer, "RunRateLimited");
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await endedEarlier(routed, 3_540);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 1 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await endedEarlier(routed, 120);
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

test("the third task a usage limit stops at one place stays with a person", async () => {
  const { routed, execution } = await steps.routedTicket("limit-bound");
  const runner = await runnerOf(routed);
  let next = execution;
  for (let limit = 1; limit < rateLimitsMax; limit++) {
    const { bearer } = await claimed(routed, next, runner);
    await rateLimited(routed, bearer, -1);
    assert.equal(await steps.resumedByScheduler(routed), 1);
    next = await newestOne(routed);
  }
  const { bearer } = await claimed(routed, next, runner);
  await rateLimited(routed, bearer, -1);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  await steps.resumedByPerson(routed, "limit-bound-member");
  const after = await claimed(routed, await newestOne(routed), runner);
  await rateLimited(routed, after.bearer, -1);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.equal(await steps.schedulerAnswers(routed), rateLimitsMax - 1);
});

test("work that alternates between runner losses and usage limits at one place reaches a person", async () => {
  const { routed, execution } = await steps.routedTicket("limit-alternating");
  const runner = await runnerOf(routed);
  let next = execution;
  for (let limit = 1; limit <= rateLimitsMax; limit++) {
    const lost = await claimed(routed, next, runner);
    await lostOnRunner(routed, lost.bearer);
    assert.equal(await steps.resumedByScheduler(routed), 1);
    const limited = await claimed(routed, await newestOne(routed), runner);
    await rateLimited(routed, limited.bearer, -1);
    if (limit < rateLimitsMax) {
      assert.equal(await steps.resumedByScheduler(routed), 1);
      next = await newestOne(routed);
    }
  }
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.equal(await steps.schedulerAnswers(routed), 2 * rateLimitsMax - 1);
});

test("a Fail at the place starts the count again", async () => {
  const { routed, execution } = await steps.routedTicket("limit-count-failed");
  const runner = await runnerOf(routed);
  let next = execution;
  for (let limit = 1; limit < rateLimitsMax; limit++) {
    const { bearer } = await claimed(routed, next, runner);
    await rateLimited(routed, bearer, -1);
    assert.equal(await steps.resumedByScheduler(routed), 1);
    next = await newestOne(routed);
  }
  const failed = await claimed(routed, next, runner);
  await steps.reported(routed, failed.attempt, "Fail");
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await steps.resumedByPerson(routed, "limit-count-failed-member");
  const limited = await claimed(routed, await newestOne(routed), runner);
  await rateLimited(routed, limited.bearer, -1);
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

test("a pass at the place starts the count again", async () => {
  const { routed, execution } = await steps.routedTicket("limit-count-passed");
  const runner = await runnerOf(routed);
  let next = execution;
  for (let limit = 1; limit < rateLimitsMax; limit++) {
    const { bearer } = await claimed(routed, next, runner);
    await rateLimited(routed, bearer, -1);
    assert.equal(await steps.resumedByScheduler(routed), 1);
    next = await newestOne(routed);
  }
  const passed = await claimed(routed, next, runner);
  await steps.reported(routed, passed.attempt, "Pass");
  const evaluation = await claimed(routed, await newestOne(routed), runner);
  await steps.reported(routed, evaluation.attempt, "Fail");
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
  const limited = await claimed(routed, await newestOne(routed), runner);
  await rateLimited(routed, limited.bearer, -1);
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

/**
 * Declares a second evaluator in the ticket's newest spawn, which no release
 * here can ask since the harness's domain runs one a stage, admits both, and
 * answers the one the writer asked. The writer refuses the completion of the
 * one it never asked, so the second's rows are all the rule reads of it.
 */
async function secondEvaluator(routed: Routed): Promise<ExecutionId> {
  const { partition, ticket } = routed.project;
  await rig.harness.query(
    `INSERT INTO execution_request_task
       (tenant,project,request,task,kind,cycle,stage,generation,evaluator)
     SELECT t.tenant,t.project,t.request,
            (SELECT max(m.task)+1 FROM execution_request_task m
              WHERE m.tenant=t.tenant AND m.project=t.project),
            t.kind,t.cycle,t.stage,t.generation,t.evaluator+1
       FROM execution_request_task t
       JOIN execution_request q
         ON q.tenant=t.tenant AND q.project=t.project AND q.request=t.request
      WHERE q.tenant=$1 AND q.project=$2 AND q.ticket=$3 AND q.state='Open'
        AND q.kind='SpawnEvaluation'`,
    [partition.tenant, partition.project, ticket],
  );
  await newestAdmitted(routed, 2);
  const [asked] = (await rig.harness.query(
    `SELECT e.execution
       FROM execution e
       JOIN execution_request_task t
         ON t.tenant=e.tenant AND t.project=e.project
        AND t.request=e.source_request AND t.task=e.task
      WHERE e.tenant=$1 AND e.project=$2 AND t.kind='Evaluation'
        AND t.evaluator=1`,
    [partition.tenant, partition.project],
  )) as readonly { execution: ExecutionId }[];
  assert.ok(asked !== undefined);
  return asked.execution;
}

test("an escalation waiting on one task lost on its runner and one a usage limit stopped is resumed only when both rules allow it", async () => {
  const { routed, execution } = await steps.routedTicket("limit-mixed");
  const runner = await runnerOf(routed);
  const work = await claimed(routed, execution, runner);
  await steps.reported(routed, work.attempt, "Pass");
  const lost = await claimed(routed, await secondEvaluator(routed), runner);
  await lostOnRunner(routed, lost.bearer);
  assert.deepEqual(await steps.standing(routed), evaluationEscalated);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  const limited = await claimedWaiting(runner);
  await endedUndecided(routed, limited, "RunRateLimited", 3_600);
  const refused = await postgresHarnessDrain(
    rig.harness,
    routed.project.partition,
    routed.memory,
  );
  assert.deepEqual(refused.decided, ["Refused"]);
  assert.deepEqual(await steps.standing(routed), evaluationEscalated);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  const { partition, ticket } = routed.project;
  const escalated = { partition, ticket: asTicketId(ticket) };
  assert.deepEqual(
    await rig.store.resumeRunnerLoss({
      ticket: escalated,
      lossesMax: service.config.attemptRetriesMax,
      mailbox: service.ticketService,
    }),
    { resumed: "NotResumable" },
  );
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await limitReset(runner);
  assert.deepEqual(
    await rig.store.resumeRateLimit({
      ticket: escalated,
      lossesMax: 1,
      rateLimitsMax,
      mailbox: service.ticketService,
    }),
    { resumed: "NotResumable" },
  );
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Evaluation");
});

test("work whose run failed or that a person must answer is never resumed as rate-limited", async () => {
  const { routed, execution } = await steps.routedTicket("limit-reported-fail");
  const runner = await runnerOf(routed);
  const { attempt } = await claimed(routed, execution, runner);
  await steps.reported(routed, attempt, "Fail");
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.equal(await steps.resumedByScheduler(routed), 0);
});

test("work lost on its runner alone is resumed by the runner-loss door, never this one", async () => {
  const { routed, execution } = await steps.routedTicket("limit-loss-alone");
  const runner = await runnerOf(routed);
  const { bearer } = await claimed(routed, execution, runner);
  await lostOnRunner(routed, bearer);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

test("work a usage limit stopped in a project that is not Active is never said to resume, and is not resumed", async () => {
  const { routed, execution } = await steps.routedTicket("limit-suspended");
  const runner = await runnerOf(routed);
  const { bearer } = await claimed(routed, execution, runner);
  await rateLimited(routed, bearer);
  const { partition } = routed.project;
  await rig.harness.query(
    `UPDATE project SET lifecycle='Suspended' WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.equal(await usageResumeRead(routed), undefined);
  await limitReset(runner);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await rig.harness.query(
    `UPDATE project SET lifecycle='Active', lifecycle_generation=lifecycle_generation+1
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

/** A runner of a member's account that names credentials: its account, how it claims the job waiting for it, and how its poll names credentials. */
interface Claimant {
  readonly account: Principal;
  readonly claimed: (routed: Routed, execution: ExecutionId) => Promise<string>;
  readonly named: (credentials: WorkerRunnerCredentials) => Promise<void>;
}

/** The claimant a pool `runnerOf` registered is. */
function poolClaimant(runner: Runner): Claimant {
  const { account } = runner;
  assert.ok(account !== undefined);
  return {
    account,
    claimed: async (routed, execution) =>
      (await claimed(routed, execution, runner)).bearer,
    named: (credentials) =>
      postgresWorkerPoolRunners(resume.planePool).named(
        { ...runner.pool, kind: "Dedicated" },
        undefined,
        undefined,
        undefined,
        false,
        credentials,
      ),
  };
}

/** Registers a personal runner of `owner`, listing the ticket's project unless `listed` is false. */
async function personalOf(
  routed: Routed,
  owner: Principal,
  listed = true,
): Promise<Claimant> {
  const { partition } = routed.project;
  const identity: PersonalRunnerIdentity = {
    tenant: partition.tenant,
    owner,
    principal: asPrincipal(`https://issuer.invalid#personal-${randomUUID()}`),
  };
  const personal = postgresPersonalRunnerRegistry(resume.apiPool);
  assert.equal(
    await personal.register({
      tenant: identity.tenant,
      owner,
      capabilities: ["Platform:Linux:Amd64"],
      clientId: `chuggy-personal-${randomUUID()}`,
      principal: identity.principal,
    }),
    "Registered",
  );
  if (listed)
    assert.equal(
      await personal.allow(
        { tenant: identity.tenant, owner },
        partition.project,
      ),
      "Allowed",
    );
  return {
    account: owner,
    claimed: async (claiming, execution) => {
      await ownedBy(claiming, execution, owner);
      await schedulerResumeInvoked(
        resume,
        claiming,
        execution,
        claudeInvocation,
      );
      const bearer = `bearer-${randomUUID()}`;
      assert.notEqual(
        await resume.assignments.claimPersonal(
          identity,
          {
            leaseSecs: service.config.attemptLeaseSecs,
            heldMax: 1,
            memoryMibDefault: service.poolMemoryMib,
          },
          `assignment-${randomUUID()}`,
          bearer,
          [partition.project],
        ),
        undefined,
      );
      return bearer;
    },
    named: (credentials) =>
      postgresWorkerPoolRunners(resume.planePool).named(
        { ...identity, kind: "Personal" },
        undefined,
        undefined,
        undefined,
        false,
        credentials,
      ),
  };
}

/** Makes `owner` the execution's owner, naming an owner fallback, as a member's own ticket is. */
async function ownedBy(
  routed: Routed,
  execution: ExecutionId,
  owner: Principal,
): Promise<void> {
  const { partition } = routed.project;
  await rig.harness.query(
    `UPDATE execution SET owner=$4, owner_fallback='Strict'
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [partition.tenant, partition.project, execution, owner],
  );
}

/** Each of `credentials` of the account's Claude at its five-hour threshold until its reset, `resetsSecs` from now, replacing whatever the account held. */
function overThreshold(
  account: Principal,
  credentials: readonly (readonly [string, number])[],
): Promise<void> {
  return agentAccountHarnessCommitted(rig.harness, account, "Claude", {
    readings: credentials.map(([credential, resetsSecs]) => ({
      window: "five_hour",
      utilization: 0.95,
      resetsSecs,
      observedSecs: 0,
      credential,
    })),
  });
}

/**
 * A runner naming two credentials has a job limited on one, which is then
 * over its threshold: resumed at the next pass while the other is free; its
 * next job limited on the other, both paused, waits for the earlier end and is
 * resumed once that ends.
 */
async function namedCredentialResumes(
  routed: Routed,
  execution: ExecutionId,
  claimant: Claimant,
): Promise<void> {
  await claimant.named({ Claude: ["first", "second"] });
  await rateLimited(
    routed,
    await claimant.claimed(routed, execution),
    3_600,
    "first",
  );
  await overThreshold(claimant.account, [["first", 3_600]]);
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  const next = await claimant.claimed(routed, await newestOne(routed));
  await rateLimited(routed, next, 3_600, "second");
  await overThreshold(claimant.account, [
    ["first", 3_600],
    ["second", 1_800],
  ]);
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 30 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await overThreshold(claimant.account, [["first", 3_600]]);
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
}

test("a personal runner naming two credentials frees a ticket limited on one while the other is free, and waits for the earlier end while both are paused", async () => {
  const { routed, execution } = await steps.routedTicket(
    "limit-named-personal",
  );
  const owner = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  await namedCredentialResumes(
    routed,
    execution,
    await personalOf(routed, owner),
  );
});

test("a pool naming two credentials frees a ticket limited on one while the other is free, and waits for the earlier end while both are paused", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-pool");
  await namedCredentialResumes(
    routed,
    execution,
    poolClaimant(await runnerOf(routed)),
  );
});

test("a press after the limits holding every credential a runner names frees the ticket, though a credential it does not name is at its threshold", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-press");
  const claimant = poolClaimant(await runnerOf(routed));
  await claimant.named({ Claude: ["first", "second"] });
  await rateLimited(
    routed,
    await claimant.claimed(routed, execution),
    3_600,
    "first",
  );
  await agentAccountHarnessCommitted(rig.harness, claimant.account, "Claude", {
    readings: [
      {
        window: "five_hour",
        utilization: 0.95,
        resetsSecs: 3_600,
        observedSecs: 0,
        credential: "third",
      },
    ],
    limits: [
      { observedSecs: -10, resetsSecs: 3_600, credential: "first" },
      { observedSecs: -10, resetsSecs: 3_600, credential: "second" },
    ],
  });
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await agentAccountHarnessPressed(rig.harness, claimant.account, "Claude");
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

/** A pool naming one credential has a job limited on it, which is then over its threshold, so that runner alone would leave the ticket waiting; the job is its account's own unless `ownedByAnother`. */
async function limitedOnNamedPool(label: string, ownedByAnother = false) {
  const { routed, execution } = await steps.routedTicket(label);
  const claimant = poolClaimant(await runnerOf(routed));
  const { account } = claimant;
  await ownedBy(
    routed,
    execution,
    ownedByAnother
      ? asPrincipal(`https://issuer.invalid#member-${randomUUID()}`)
      : account,
  );
  await claimant.named({ Claude: ["first"] });
  await rateLimited(
    routed,
    await claimant.claimed(routed, execution),
    3_600,
    "first",
  );
  await overThreshold(account, [["first", 3_600]]);
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  return { routed, account };
}

test("a second runner of the member naming a free credential frees a ticket the first runner's task was limited on", async () => {
  const { routed, account } = await limitedOnNamedPool("limit-named-second");
  await (await personalOf(routed, account)).named({ Claude: ["second"] });
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

test("a personal runner frees nothing until it lists the project", async () => {
  const { routed, account } = await limitedOnNamedPool("limit-named-unlisted");
  await (
    await personalOf(routed, account, false)
  ).named({
    Claude: ["second"],
  });
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  const { partition } = routed.project;
  assert.equal(
    await postgresPersonalRunnerRegistry(resume.apiPool).allow(
      { tenant: partition.tenant, owner: account },
      partition.project,
    ),
    "Allowed",
  );
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

test("a personal runner frees nothing of a task whose execution is another member's", async () => {
  const { routed, account } = await limitedOnNamedPool(
    "limit-named-another",
    true,
  );
  await (await personalOf(routed, account)).named({ Claude: ["second"] });
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
});

test("a runner naming no credential of the agent leaves the ticket waiting for the whole agent", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-other");
  const runner = await runnerOf(routed);
  const claimant = poolClaimant(runner);
  await claimant.named({ Codex: ["first"] });
  await rateLimited(routed, await claimant.claimed(routed, execution));
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await limitReset(runner);
  assert.equal(await steps.resumedByScheduler(routed), 1);
});
