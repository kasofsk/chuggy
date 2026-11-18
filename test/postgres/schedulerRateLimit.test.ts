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
 * submitted there. Each runner is of a member of its own or of one its case
 * names, so no two cases share an account.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresWorkerRunEnded } from "../../src/adapters/postgres/workerPlane.ts";
import { postgresWorkerPoolRunners } from "../../src/adapters/postgres/workerPool.ts";
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
import type { PersonalRunnerIdentity } from "../../src/interpreter/workerPool.ts";
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

/** A runner of a ticket's jobs: the member whose account its runs spend where one does, and how it claims the attempt waiting for it, answering the bearer it was claimed under. */
interface Runner {
  readonly account: Principal | undefined;
  readonly claimedWaiting: (routed: Routed) => Promise<string>;
}

/** A personal runner of a member of its own, listing the ticket's project. */
function ownRunnerOf(routed: Routed): Promise<Claimant> {
  return personalOf(
    routed,
    asPrincipal(`https://issuer.invalid#member-${randomUUID()}`),
  );
}

/** What every claim here is held to. */
const claimTerms = {
  leaseSecs: service.config.attemptLeaseSecs,
  heldMax: 1,
  memoryMibDefault: service.poolMemoryMib,
};

/** Registers the ticket's newest spawn on the pool route and admits `tasks` of its tasks. */
const newestAdmitted = (routed: Routed, tasks?: number) =>
  schedulerResumeAdmitted(resume, routed, tasks);

/** The one task of the ticket's newest spawn, registered and admitted. */
async function newestOne(routed: Routed): Promise<ExecutionId> {
  const [execution] = await newestAdmitted(routed);
  assert.ok(execution !== undefined);
  return execution;
}

/** Has the runner claim the execution's attempt, opened and invoked to spend Claude, answering the attempt and its bearer. */
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
  return { attempt, bearer: await runner.claimedWaiting(routed) };
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
 * where it will not, how many seconds from now the latest pause ends where one
 * still holds, rounded to the minute, and `off` where a task waits only on
 * credentials turned off.
 */
async function usageResumeRead(
  routed: Routed,
): Promise<{ readonly untilMins?: number; readonly off?: true } | undefined> {
  const { partition, ticket } = routed.project;
  const read = await postgresNativeReads(resume.apiPool, {
    lossesMax: service.config.attemptRetriesMax,
    rateLimitsMax,
  }).ticket(partition, asTicketId(ticket));
  const usageResume = read?.escalation?.usageResume;
  if (usageResume === undefined) return undefined;
  if (usageResume.off === true) {
    assert.equal(usageResume.until, undefined);
    return { off: true };
  }
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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

test("the third task a usage limit stops at one place stays with a person", async () => {
  const { routed, execution } = await steps.routedTicket("limit-bound");
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
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
  const runner = await ownRunnerOf(routed);
  const work = await claimed(routed, execution, runner);
  await steps.reported(routed, work.attempt, "Pass");
  const lost = await claimed(routed, await secondEvaluator(routed), runner);
  await lostOnRunner(routed, lost.bearer);
  assert.deepEqual(await steps.standing(routed), evaluationEscalated);
  assert.equal(await steps.resumedByScheduler(routed), 0);
  const limited = await runner.claimedWaiting(routed);
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
  const runner = await ownRunnerOf(routed);
  const { attempt } = await claimed(routed, execution, runner);
  await steps.reported(routed, attempt, "Fail");
  assert.deepEqual(await steps.standing(routed), workEscalated);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.equal(await steps.resumedByScheduler(routed), 0);
});

test("work lost on its runner alone is resumed by the runner-loss door, never this one", async () => {
  const { routed, execution } = await steps.routedTicket("limit-loss-alone");
  const runner = await ownRunnerOf(routed);
  const { bearer } = await claimed(routed, execution, runner);
  await lostOnRunner(routed, bearer);
  assert.equal(await usageResumeRead(routed), undefined);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

test("work a usage limit stopped in a project that is not Active is never said to resume, and is not resumed", async () => {
  const { routed, execution } = await steps.routedTicket("limit-suspended");
  const runner = await ownRunnerOf(routed);
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

/** A runner of a member's account that names credentials: its account, how it claims a job, and how its poll names credentials. */
interface Claimant extends Runner {
  readonly account: Principal;
  readonly claimed: (routed: Routed, execution: ExecutionId) => Promise<string>;
  readonly named: (credentials: WorkerRunnerCredentials) => Promise<void>;
}

/** Registers a personal runner of `owner`, who may read the ticket's project and register runners, listing the project unless `listed` is false. */
async function personalRegistered(
  routed: Routed,
  owner: Principal,
  listed: boolean,
): Promise<PersonalRunnerIdentity> {
  const { partition } = routed.project;
  const identity: PersonalRunnerIdentity = {
    tenant: partition.tenant,
    owner,
    principal: asPrincipal(`https://issuer.invalid#personal-${randomUUID()}`),
  };
  resume.access.grantTenant({
    tenant: partition.tenant,
    principal: owner,
    access: new Set(["RegisterPersonalRunner"]),
  });
  resume.access.grant({
    partition,
    principal: owner,
    access: new Set(["Read"]),
  });
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
  return identity;
}

/** The claimant a personal runner of `owner` is, registered as `personalRegistered` says, claiming its owner's jobs in the ticket's project. */
async function personalOf(
  routed: Routed,
  owner: Principal,
  listed = true,
): Promise<Claimant> {
  const identity = await personalRegistered(routed, owner, listed);
  const runner: Runner = {
    account: owner,
    claimedWaiting: async (claiming) => {
      await ownedWaiting(claiming, owner);
      const bearer = `bearer-${randomUUID()}`;
      assert.notEqual(
        await resume.assignments.claimPersonal(
          identity,
          claimTerms,
          `assignment-${randomUUID()}`,
          bearer,
          [routed.project.partition.project],
        ),
        undefined,
      );
      return bearer;
    },
  };
  return {
    ...runner,
    account: owner,
    claimed: async (claiming, execution) =>
      (await claimed(claiming, execution, runner)).bearer,
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

/** Makes `owner` the owner of each execution of the ticket's project that has none or whose attempt waits to be claimed, as a member's own ticket is. */
async function ownedWaiting(routed: Routed, owner: Principal): Promise<void> {
  const { partition } = routed.project;
  await rig.harness.query(
    `UPDATE execution x SET owner=$3
      WHERE x.tenant=$1 AND x.project=$2
        AND (x.owner IS NULL
             OR EXISTS(SELECT 1 FROM execution_attempt q
                  WHERE q.tenant=x.tenant AND q.project=x.project
                    AND q.execution=x.execution AND q.state='Placing'
                    AND q.pool IS NULL AND q.invoked))`,
    [partition.tenant, partition.project, owner],
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

test("a press after the limits holding every credential a runner names frees the ticket, though a credential it does not name is at its threshold", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-press");
  const claimant = await ownRunnerOf(routed);
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

/** A personal runner of a member of its own naming one credential has a job of theirs limited on it, which is then over its threshold, so that runner alone would leave the ticket waiting. */
async function limitedOnNamed(label: string) {
  const { routed, execution } = await steps.routedTicket(label);
  const claimant = await ownRunnerOf(routed);
  const { account } = claimant;
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
  const { routed, account } = await limitedOnNamed("limit-named-second");
  await (await personalOf(routed, account)).named({ Claude: ["second"] });
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

test("a personal runner frees nothing until it lists the project", async () => {
  const { routed, account } = await limitedOnNamed("limit-named-unlisted");
  const { partition } = routed.project;
  const key = { tenant: partition.tenant, owner: account };
  const personal = postgresPersonalRunnerRegistry(resume.apiPool);
  assert.equal(await personal.disallow(key, partition.project), true);
  await (
    await personalOf(routed, account, false)
  ).named({
    Claude: ["second"],
  });
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.equal(await personal.allow(key, partition.project), "Allowed");
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

test("a runner naming no credential of the agent leaves the ticket waiting for the whole agent", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-other");
  const claimant = await ownRunnerOf(routed);
  await claimant.named({ Codex: ["first"] });
  await rateLimited(routed, await claimant.claimed(routed, execution));
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  await limitReset(claimant);
  assert.equal(await steps.resumedByScheduler(routed), 1);
});

/** Turns each of `credentials` of the account's Claude off, beside whatever else it holds, its runners polling now so their names count toward its pause. */
async function turnedOff(
  account: Principal,
  credentials: readonly string[],
): Promise<void> {
  await rig.harness.query(
    "UPDATE personal_runner SET last_polled_at=now() WHERE owner=$1",
    [account],
  );
  await rig.harness.query(
    `DELETE FROM agent_account_credential_off WHERE principal=$1 AND agent='Claude'`,
    [account],
  );
  for (const credential of credentials)
    await rig.harness.query(
      `INSERT INTO agent_account_credential_off(principal,agent,credential)
       VALUES($1,'Claude',$2)`,
      [account, credential],
    );
}

test("a ticket whose limited task waits only on credentials turned off reads off with no end and is not resumed until one is on", async () => {
  const { routed, execution } = await steps.routedTicket("limit-named-off");
  const claimant = await ownRunnerOf(routed);
  await claimant.named({ Claude: ["first", "second"] });
  await rateLimited(
    routed,
    await claimant.claimed(routed, execution),
    3_600,
    "first",
  );
  await limitReset(claimant);
  await turnedOff(claimant.account, ["first", "second"]);
  assert.deepEqual(await usageResumeRead(routed), { off: true });
  assert.equal(await steps.resumedByScheduler(routed), 0);
  assert.deepEqual(await resumedAtDoor(routed), { resumed: "NotResumable" });
  await turnedOff(claimant.account, ["first"]);
  assert.deepEqual(await usageResumeRead(routed), {});
  assert.equal(await steps.resumedByScheduler(routed), 1);
  assert.equal((await steps.standing(routed))?.["phase"], "Work");
});

test("one task waiting only on credentials turned off, beside one a limit holds until an end, reads off", async () => {
  const { routed, execution } = await steps.routedTicket("limit-mixed-off");
  const named = await ownRunnerOf(routed);
  const unnamed = await ownRunnerOf(routed);
  await named.named({ Claude: ["first"] });
  const work = await claimed(routed, execution, named);
  await steps.reported(routed, work.attempt, "Pass");
  const first = await claimed(routed, await secondEvaluator(routed), unnamed);
  await rateLimited(routed, first.bearer);
  assert.deepEqual(await steps.standing(routed), evaluationEscalated);
  const limited = await named.claimedWaiting(routed);
  await endedUndecided(routed, limited, "RunRateLimited", 1_800, "first");
  await postgresHarnessDrain(
    rig.harness,
    routed.project.partition,
    routed.memory,
  );
  assert.deepEqual(await usageResumeRead(routed), { untilMins: 60 });
  await turnedOff(named.account, ["first"]);
  assert.deepEqual(await usageResumeRead(routed), { off: true });
  assert.equal(await steps.resumedByScheduler(routed), 0);
});
