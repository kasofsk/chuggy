/**
 * One whole decision, against a real server: the selector offers a turn on the
 * project's lead, a stub pod claims it through the session plane and answers a
 * decision document, and what the decision said lands in the record.
 *
 * THE POD IS A SECOND ROLE AND A SECOND CONNECTION. A loop that wrote the turn
 * row itself would prove the runtime against its own memory; the stub here
 * claims and answers at the plane's own door, so the observation it parses is
 * the one the mailbox actually holds.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { leadSessionMint } from "../../src/adapters/crypto/leadSessionMint.ts";
import { postgresLeadDecisionTail } from "../../src/adapters/postgres/leadReads.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  leadSelectorPolicy,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import { parseLeadObservation } from "../../src/interpreter/leadTurn.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  runObservedSelectorCycle,
  selectorProjectMoved,
  type SelectorObservation,
  type SelectorProjectState,
  type SelectorResolvedSettings,
} from "../../src/interpreter/selector.ts";
import { selectorPolicyHost } from "../../src/interpreter/selectorPolicyHost.ts";
import { postgresHarnessSelectorContext } from "./harness.ts";
import {
  leadRigOpen,
  leadRigPod,
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

function settingsFor(
  partition: Partition,
  dispatchesPerDecision = 1,
): SelectorResolvedSettings {
  return {
    partition,
    revision: 1,
    projectRevision: 0,
    mode: "Running",
    installationMode: "Running",
    dispatchMode: "ApprovalRequired",
    basePrompt: "choose a dispatchable ticket",
    modelAllowlist: ["*"],
    toolAllowlist: ["*"],
    operationalContextMaxAgeMs: 9_000_000_000_000_000,
    limits: {
      tokensPerDecision: 200_000,
      millisecondsPerDecision: 900_000,
      toolCallsPerDecision: 20,
      dispatchesPerDecision,
      inputBytesPerDecision: 1_048_576,
      candidatePagesPerDecision: 1,
      concurrentDecisions: 4,
      selectionsPerMinute: 600,
    },
  };
}

const clock: LeadPolicyClock = {
  now: () => {
    const epochMs = Date.now();
    return Promise.resolve({
      instant: new Date(epochMs).toISOString(),
      epochMs,
    });
  },
  wait: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      });
    }),
};

/** Who a lead this suite's host opens acts as, which is the selector's own principal. */
const leadDecisionPrincipal = "principal-lead-successor";

function leadPolicy() {
  return selectorPolicyHost(
    leadSelectorPolicy(
      rig.mailbox,
      postgresLeadDecisionTail(rig.selectorPool),
      leadSessionMint(),
      clock,
      {
        pollIntervalMs: 5,
        implementationRevision: "selector-build",
        principal: leadDecisionPrincipal,
        credentialSlot: "claude-code",
      },
    ),
    {
      after: (milliseconds) =>
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error("selector deadline exceeded"));
          }, milliseconds);
        }),
    },
    { controlDeadlineMs: 5_000 },
  );
}

function observationOf(
  partition: Partition,
  cursor: number,
): SelectorObservation {
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 1,
    digest: "a".repeat(64),
  };
  return {
    token,
    candidates: [
      {
        ticket: asTicketId(41),
        ticketVersion: 3,
        dependencies: [],
        workFanout: 1,
        program: [{ fanout: 1, combinator: "UnanimousPass" }],
        reworkPolicy: { type: "BudgetedRework", value: 1 },
        finalizationPricing: "DeadlineOnly",
        resumePricing: "RetryCharged",
        finalizer: "NoFinalizer",
        configurationRevision: "revision",
        configurationDigest: "d".repeat(64),
        configurationCanonical: "{}",
      },
      {
        ticket: asTicketId(43),
        ticketVersion: 1,
        dependencies: [],
        workFanout: 1,
        program: [{ fanout: 1, combinator: "UnanimousPass" }],
        reworkPolicy: { type: "BudgetedRework", value: 1 },
        finalizationPricing: "DeadlineOnly",
        resumePricing: "RetryCharged",
        finalizer: "NoFinalizer",
        configurationRevision: "revision",
        configurationDigest: "d".repeat(64),
        configurationCanonical: "{}",
      },
    ],
    refusals: [],
    notificationCursor: cursor,
    changes: [{ ordinal: cursor, kind: "Ticket", resource: "41" }],
    operationalContext: {
      ...postgresHarnessSelectorContext,
      observedAtEpochMs: Date.now(),
      observedAt: new Date().toISOString(),
    },
    handoffNote: { watching: "41" },
    nextCandidateScan: { state: "Exhausted", token },
  };
}

function initialState(partition: Partition): SelectorProjectState {
  return {
    partition,
    notificationCursor: 0,
    revision: 0,
    attention: "Monitoring",
    handoffNote: {},
    candidateScan: { state: "Unstarted" },
  };
}

async function leadProject(label: string) {
  const partition = await leadRigProject(rig, label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  return { partition, session };
}

/** Everything a cycle must not read again, the page having been read once. */
const readOnce = {
  currentTimeEpochMs: () => Promise.resolve(Date.now()),
  currentInstant: () => Promise.resolve(new Date().toISOString()),
  decisionDeadline: () => new Promise<never>(() => undefined),
  notifications: () => Promise.reject(new Error("the page was read again")),
  dispatchView: () => Promise.reject(new Error("the view was read again")),
  operationalContext: () =>
    Promise.reject(new Error("the context was read again")),
};

/** One permitted decision on the observation a case built, recorded for real. */
async function runOneDecision(
  partition: Partition,
  label: string,
  observation: SelectorObservation,
  dispatchesPerDecision = 1,
) {
  const store = postgresSelectorState(rig.selectorPool);
  const identity = {
    operation: asOperationId(
      `selector-operation-${label}-${String(Date.now())}`,
    ),
    selectorDecisionReference: `selector-decision-${label}-${String(Date.now())}`,
  };
  const settings = settingsFor(partition, dispatchesPerDecision);
  await store.allocateAttempt(
    identity.selectorDecisionReference,
    partition,
    settings.limits,
  );
  await store.runningAttempt(identity.selectorDecisionReference, observation, {
    settingsRevision: settings.revision,
    projectSettingsRevision: settings.projectRevision,
  });
  const proposal = await runObservedSelectorCycle(
    initialState(partition),
    observation,
    readOnce,
    rig.writes,
    store,
    leadPolicy(),
    identity,
    settings,
  );
  return { proposal, store, identity };
}

test("nothing new is no turn", async () => {
  const { partition } = await leadProject("unmoved");
  const state = initialState(partition);
  assert.equal(
    selectorProjectMoved(state, { result: "Events", cursor: 0, events: [] }),
    false,
    "an empty page at the standing cursor is the one shape that is nothing new",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT count(*)::text AS turns FROM session_turn
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ turns: "0" }],
    "a project nothing moved has no turn offered to its lead",
  );
});

test("a moved project takes one turn, and the decision lands whole", async () => {
  const { partition, session } = await leadProject("whole");
  const observation = observationOf(partition, 12);
  const pod = leadRigPod(rig, partition, session, "whole", (input: string) => {
    const observed = parseLeadObservation(input);
    assert.deepEqual(
      observed.changes,
      observation.changes,
      "the lead is shown the window that triggered its turn",
    );
    assert.deepEqual(observed.handoffNote, observation.handoffNote);
    assert.ok(
      observed.instructions?.content.includes("choose a dispatchable ticket"),
      "the composed objectives carry the project's own base prompt",
    );
    return {
      version: 1,
      dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
      refusals: [
        { ticket: 43, ticketVersion: 1, reason: "its brief is empty" },
      ],
      lifts: [],
      attention: "Attention",
      handoffNote: { next: "41" },
    };
  });
  const { proposal, store, identity } = await runOneDecision(
    partition,
    "whole",
    observation,
  );
  await pod;

  assert.deepEqual(
    proposal?.proposals.dispatches.map((dispatch) => dispatch.command.ticket),
    [41],
  );
  const interactions = await store.history(partition, undefined, 10);
  assert.equal(interactions.length, 1);
  assert.deepEqual(interactions[0]?.context.changes, observation.changes);
  assert.deepEqual(
    interactions[0]?.context.handoffNote,
    observation.handoffNote,
  );
  assert.equal(interactions[0]?.modelRevision, "claude-model");

  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT ticket::text AS ticket,event FROM selector_agentic_refusal
        WHERE tenant=$1 AND project=$2 ORDER BY ordinal`,
      [partition.tenant, partition.project],
    ),
    [{ ticket: "43", event: "Refused" }],
    "one ledger row per refusal, named by the decision that entered it",
  );
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT count(*)::text AS deliveries FROM selector_proposal_delivery
        WHERE selector_decision=$1`,
      [identity.selectorDecisionReference],
    ),
    [{ deliveries: "1" }],
  );
});

/**
 * One interaction, two deliveries, one transaction. The rows are keyed by the
 * decision and the ticket, so what the record answers is the tickets it took —
 * and each command is fenced on the version its own candidate stood at, which
 * the two differing versions here are what separate.
 */
test("one decision's dispatches are two rows under one interaction", async () => {
  const { partition, session } = await leadProject("several");
  const observation = observationOf(partition, 15);
  const pod = leadRigPod(rig, partition, session, "several", () => ({
    version: 1,
    dispatches: [
      { ticket: 41, expectedTicketVersion: 3 },
      { ticket: 43, expectedTicketVersion: 1 },
    ],
    refusals: [],
    lifts: [],
    attention: "Monitoring",
    handoffNote: {},
  }));
  const { proposal, store, identity } = await runOneDecision(
    partition,
    "several",
    observation,
    2,
  );
  await pod;

  assert.deepEqual(
    proposal?.dispatched.map(Number),
    [41, 43],
    "the record answers the tickets it wrote a row for",
  );
  assert.equal((await store.history(partition, undefined, 10)).length, 1);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT ticket::text AS ticket,operation,command::jsonb->>'expectedTicketVersion' AS fenced
         FROM selector_proposal_delivery
        WHERE selector_decision=$1 ORDER BY ticket`,
      [identity.selectorDecisionReference],
    ),
    [
      {
        ticket: "41",
        operation: `${identity.operation}-t41`,
        fenced: "3",
      },
      {
        ticket: "43",
        operation: `${identity.operation}-t43`,
        fenced: "1",
      },
    ],
  );
});

test("the refusal reaches the stream and the project's standing read", async () => {
  const partition = (await leadProject("stream")).partition;
  const session = (await rig.mailbox.lead(partition))?.session;
  assert.ok(session !== undefined);
  const observation = observationOf(partition, 9);
  const pod = leadRigPod(rig, partition, session, "stream", () => ({
    version: 1,
    dispatches: [],
    refusals: [{ ticket: 43, ticketVersion: 1, reason: "waiting on 41" }],
    lifts: [],
    attention: "Monitoring",
    handoffNote: {},
  }));
  await runOneDecision(partition, "stream", observation);
  await pod;

  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT kind,resource FROM project_change
        WHERE tenant=$1 AND project=$2 AND kind='AgenticRefusal'`,
      [partition.tenant, partition.project],
    ),
    [{ kind: "AgenticRefusal", resource: "43" }],
    "the console is live for free because the ledger publishes its own kind",
  );
  const standing = await rig.selectorStanding.standingAmong(partition, [
    asTicketId(41),
    asTicketId(43),
  ]);
  assert.deepEqual(
    standing.map((refusal) => [refusal.ticket, refusal.reason]),
    [[43, "waiting on 41"]],
  );
});

test("a withdrawn turn cannot be answered, and reconciles with a proof", async () => {
  const { partition, session } = await leadProject("withdrawn");
  const turn = sessionRigTurnId("withdrawn");
  await rig.mailbox.offer({ partition, turn, input: "{}" });
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    "withdrawn",
  );
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(await rig.mailbox.withdraw(turn), "Withdrawn");
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
    }),
    "Conflict",
    "a withdrawn turn can never be answered, which is what makes it a proof",
  );
  assert.deepEqual(await rig.mailbox.turn(turn), {
    state: "Abandoned",
    failure: "TurnWithdrawn",
  });
  const termination = await leadPolicy().reconcileQuarantined(turn);
  assert.equal(termination.status, "Terminated");
  assert.match(
    termination.status === "Terminated" ? termination.proof : "",
    /AlreadyEnded/u,
    "a process that never offered the turn still settles it from the row",
  );
});
