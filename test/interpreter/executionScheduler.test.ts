/**
 * The scheduler vocabulary's own refusals: the bounds a configuration must
 * satisfy before a pass runs on it, and the account lookup that has no answer
 * for an account the current policy revision does not cover.
 *
 * `./capacity.test.ts` holds the arithmetic to `model/capacity.qnt`. What is
 * left here is what the model has no opinion about, which is every operational
 * bound a deployment chooses.
 *
 * ONE OF THOSE BOUNDS IS NOT THE SCHEDULER'S ALONE. A project backlog ceiling
 * is a promise about the mailbox the completions it authorizes will land in, so
 * the cases below drive it against the ticket-service configuration it has to
 * reserve room within rather than against itself.
 *
 * NOR IS IT THE ONLY CLAIM ON THAT ROOM. The finalizer's claimed requests submit
 * completions into the same room, so a case that varies the finalizer's claim
 * ceiling alone must move the same verdict a case varying the backlog does.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allAttemptEvidence,
  checkedExecutionSchedulerConfig,
  executionCapacitySafe,
  executionEntitlementOf,
  executionMayAdmit,
  executionReservationDeficit,
  executionSchedulerDefaults,
  schedulerEvidenceCharsMax,
  type AttemptEvidenceRecord,
  type CapacityExecution,
  type Entitlement,
  type ExecutionSchedulerConfig,
} from "../../src/interpreter/executionScheduler.ts";
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { allBriefingFaults } from "../../src/interpreter/taskBriefing.ts";
import { allTaskConfigurationReadFaults } from "../../src/interpreter/taskConfiguration.ts";
import {
  mailboxCompletionRoom,
  ticketServiceDefaults,
} from "../../src/interpreter/ticketService.ts";
import { assertBoundsAreRefused } from "./configBounds.ts";

/** Every bound a deployment names, read from the defaults so a field added later is covered. */
const bounds = Object.keys(
  executionSchedulerDefaults,
) as readonly (keyof ExecutionSchedulerConfig)[];

/** The defaults with one bound replaced, which is how a case varies one thing. */
function configWith(
  name: keyof ExecutionSchedulerConfig,
  value: number,
): ExecutionSchedulerConfig {
  return { ...executionSchedulerDefaults, [name]: value };
}

/** The checker under the ticket-service and finalizer configurations a case holds still. */
function checkedAgainstDefaults(
  config: ExecutionSchedulerConfig,
): ExecutionSchedulerConfig {
  return checkedExecutionSchedulerConfig(
    config,
    ticketServiceDefaults,
    finalizerDefaults,
  );
}

const entitlements: ReadonlyMap<string, Entitlement> = new Map([
  ["known", { reserved: 1, maximum: 2 }],
]);

/** One registration drawing on the named account. */
function registration(account: string): CapacityExecution {
  return {
    project: "project",
    ticket: 1,
    task: 1,
    account,
    sourceSeq: 1,
    sourceEffect: 0,
    status: "Queued",
  };
}

test("the defaults are a configuration a pass may run on", () => {
  assert.equal(
    checkedAgainstDefaults(executionSchedulerDefaults),
    executionSchedulerDefaults,
  );
  assert.ok(
    bounds.length > 0,
    "the defaults name no bound, so this proves nothing",
  );
});

test("no bound may be zero, negative, fractional or left unnamed", () => {
  assertBoundsAreRefused(executionSchedulerDefaults, checkedAgainstDefaults);
});

test("a bound past the safe integers is refused rather than silently rounded", () => {
  assert.throws(
    () =>
      checkedAgainstDefaults(
        configWith("attemptLeaseSecs", Number.MAX_SAFE_INTEGER + 2),
      ),
    RangeError,
  );
});

test("the two ceilings together leave the mailbox room for the completions they admit", () => {
  const room = mailboxCompletionRoom(ticketServiceDefaults);
  const widest = room - finalizerDefaults.requestsPerPassMax - 1;
  assert.ok(
    executionSchedulerDefaults.projectBacklogMax <= widest,
    "the default ceilings already outgrow the room, so this proves nothing",
  );
  for (const ceiling of [widest + 1, room - 1, room]) {
    assert.throws(
      () => checkedAgainstDefaults(configWith("projectBacklogMax", ceiling)),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /reserve no mailbox room/u);
        return true;
      },
      `a ceiling of ${String(ceiling)} was accepted against a room of ${String(room)}`,
    );
  }
  assert.equal(
    checkedAgainstDefaults(configWith("projectBacklogMax", widest))
      .projectBacklogMax,
    widest,
  );
});

test("the finalizer's claim ceiling draws on the same room as the backlog", () => {
  const ceiling = configWith(
    "projectBacklogMax",
    mailboxCompletionRoom(ticketServiceDefaults) - 2,
  );
  assert.equal(
    checkedExecutionSchedulerConfig(ceiling, ticketServiceDefaults, {
      ...finalizerDefaults,
      requestsPerPassMax: 1,
    }),
    ceiling,
  );
  assert.throws(
    () =>
      checkedExecutionSchedulerConfig(ceiling, ticketServiceDefaults, {
        ...finalizerDefaults,
        requestsPerPassMax: 2,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, /requestsPerPassMax/u);
      return true;
    },
    "a claim ceiling that overruns the room was accepted",
  );
});

test("a finalizer claim ceiling that is no count is refused rather than summed", () => {
  assert.throws(
    () =>
      checkedExecutionSchedulerConfig(
        executionSchedulerDefaults,
        ticketServiceDefaults,
        { ...finalizerDefaults, requestsPerPassMax: Number.NaN },
      ),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, /finalizer configuration/u);
      return true;
    },
    "a claim ceiling that is not a number reached the sum",
  );
});

test("a wider mailbox is what widens the ceiling, rather than the ceiling itself", () => {
  const wider = {
    ...ticketServiceDefaults,
    mailboxHardLimit: ticketServiceDefaults.mailboxHardLimit * 4,
  };
  const ceiling = configWith(
    "projectBacklogMax",
    mailboxCompletionRoom(ticketServiceDefaults),
  );
  assert.throws(() => checkedAgainstDefaults(ceiling), RangeError);
  assert.equal(
    checkedExecutionSchedulerConfig(ceiling, wider, finalizerDefaults),
    ceiling,
  );
});

test("an account the policy revision does not cover has no entitlement to assume", () => {
  assert.deepEqual(executionEntitlementOf(entitlements, "known"), {
    reserved: 1,
    maximum: 2,
  });
  assert.throws(
    () => executionEntitlementOf(entitlements, "absent"),
    /account absent has no entitlement in the current policy revision/u,
  );
});

test("every arithmetic that reads an entitlement refuses an uncovered account", () => {
  const ledger = [registration("absent")];
  assert.throws(
    () => executionReservationDeficit(entitlements, ledger, "absent"),
    /no entitlement/u,
  );
  assert.throws(
    () => executionMayAdmit(4, entitlements, ledger, registration("absent")),
    /no entitlement/u,
  );
  assert.throws(
    () => executionCapacitySafe(4, entitlements, ledger),
    /no entitlement/u,
  );
});

test("every evidence a refusal can record fits the column that keeps it", () => {
  const faults = [...allBriefingFaults, ...allTaskConfigurationReadFaults];
  const recorded: AttemptEvidenceRecord[] = allAttemptEvidence.flatMap(
    (evidence) =>
      faults.map((fault): AttemptEvidenceRecord => `${evidence}: ${fault}`),
  );
  assert.equal(recorded.length, allAttemptEvidence.length * faults.length);
  for (const evidence of recorded) {
    assert.ok(
      evidence.length <= schedulerEvidenceCharsMax,
      `${evidence} is longer than the evidence column admits`,
    );
  }
});
