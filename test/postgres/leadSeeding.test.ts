/**
 * What a lead with no transcript is told before its first turn, against a real
 * server: the handoff note, the tail of the decision log, the standing refusals
 * and the cursor — and what a lead that has bound a runtime session is not.
 *
 * A SEEDING TURN IS THE ONE A SESSION HAS BOUND NO AGENT REFERENCE FOR. The
 * reference is bound by the pod's first answer, so the two cases here differ
 * only in whether a turn has been answered before the one under test.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresAgenticRefusalStanding } from "../../src/adapters/postgres/agenticRefusal.ts";
import { postgresLeadDecisionTail } from "../../src/adapters/postgres/leadReads.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  leadSelectorPolicy,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import { parseLeadObservation } from "../../src/interpreter/leadTurn.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type {
  SelectorObservation,
  SelectorPolicyRequest,
} from "../../src/interpreter/selector.ts";
import { postgresHarnessSelectorContext } from "./harness.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import {
  leadRigOpen,
  leadRigPod,
  leadRigPodAttempt,
  leadRigPodTurn,
  leadRigProject,
  type LeadRig,
} from "./leadHarness.ts";
import { sessionRigSession } from "./sessionHarness.ts";

let rig: LeadRig;

before(async () => {
  rig = await leadRigOpen();
});

after(async () => {
  await rig.close();
});

const clock: LeadPolicyClock = {
  now: () => {
    const epochMs = Date.now();
    return Promise.resolve({
      instant: new Date(epochMs).toISOString(),
      epochMs,
    });
  },
  wait: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function seedingPolicy() {
  return leadSelectorPolicy(
    rig.mailbox,
    postgresAgenticRefusalStanding(rig.selectorPool),
    postgresLeadDecisionTail(rig.selectorPool),
    clock,
    { pollIntervalMs: 5, implementationRevision: "selector-build" },
  );
}

function requestFor(
  partition: Partition,
  decision: string,
): SelectorPolicyRequest {
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 1,
    digest: "a".repeat(64),
  };
  const observation: SelectorObservation = {
    token,
    candidates: [],
    notificationCursor: 1_204,
    changes: [],
    operationalContext: postgresHarnessSelectorContext,
    handoffNote: { watching: "41" },
    nextCandidateScan: { state: "Exhausted", token },
  };
  return {
    attempt: decision,
    observation,
    instructions: { revision: "1.0", content: "choose one", northStar: "ship" },
    constraints: {
      models: ["*"],
      tools: ["*"],
      limits: {
        tokensPerDecision: 200_000,
        millisecondsPerDecision: 900_000,
        toolCallsPerDecision: 20,
        dispatchesPerDecision: 1,
        inputBytesPerDecision: 1_048_576,
        candidatePagesPerDecision: 1,
        concurrentDecisions: 4,
        selectionsPerMinute: 600,
      },
    },
  };
}

/**
 * One decision the tail can carry. `leadRigDecision` records the smallest
 * interaction the store accepts, and the smallest carries no attention — which
 * is exactly what the seeding summary drops, a failed cycle having decided
 * nothing.
 */
async function seedingDecision(
  partition: Partition,
  label: string,
  cursor: number,
): Promise<string> {
  const decision = `selector-decision-${label}-${String(Date.now())}-${label}`;
  const store = postgresSelectorState(rig.selectorPool);
  await store.recordInteraction(
    {
      decision,
      partition,
      instructionsVersion: "1.0",
      instructions: "choose one",
      observedView: [],
      context: {
        operationalContext: postgresHarnessSelectorContext,
        handoffNote: {},
      },
      toolActivity: [],
      result: {
        dispatches: [{ ticket: 41, expectedTicketVersion: 1 }],
        refusals: [],
        lifts: [],
        attention: "Monitoring",
        handoffNote: {},
      },
      implementationRevision: "implementation-1",
      modelRevision: "model-1",
      policyRevision: "policy-1",
      accounting: { tokens: 1, durationMs: 1 },
      startedAt: "2026-09-02T12:00:00.000Z",
      completedAt: "2026-09-02T12:00:01.000Z",
    },
    {
      partition,
      notificationCursor: cursor,
      revision: (await store.project(partition))?.revision ?? 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    { settingsRevision: 1, projectSettingsRevision: 0 },
  );
  return decision;
}

/** A decision that chooses nothing, which every case here is indifferent to. */
const aDecision = {
  version: 1,
  dispatches: [],
  attention: "Monitoring",
  handoffNote: {},
};

/** The text one turn was actually offered, read back from the mailbox row. */
async function turnInput(turn: string): Promise<string> {
  const rows = await rig.sessions.harness.query(
    `SELECT input FROM session_turn WHERE turn=$1`,
    [turn],
  );
  const input = rows[0]?.["input"];
  if (typeof input !== "string")
    throw new Error(`no turn was offered for ${turn}`);
  return input;
}

test("a session with no agent reference is seeded from the record", async () => {
  const partition = await leadRigProject(rig, "seeded");
  const session = await sessionRigSession(rig.sessions, partition, "seeded", {
    kind: "Lead",
  });
  const first = await seedingDecision(partition, "seeded-old", 100);
  const second = await seedingDecision(partition, "seeded-new", 200);
  await rig.writes.record({
    partition,
    decision: first,
    refusals: [
      {
        ticket: asTicketId(42),
        ticketVersion: 2,
        reason: "its brief is empty",
      },
    ],
    lifts: [],
  });

  const decision = `selector-decision-seeded-${String(Date.now())}`;
  const answering = leadRigPod(
    rig,
    partition,
    session,
    "seeded",
    () => aDecision,
  );
  await seedingPolicy().execute(
    requestFor(partition, decision),
    new AbortController().signal,
  );
  await answering;

  const observed = parseLeadObservation(await turnInput(decision));
  assert.deepEqual(observed.seeding?.handoffNote, { watching: "41" });
  assert.equal(observed.seeding?.notificationCursor, 1_204);
  assert.equal(
    observed.seeding?.decisions.length,
    2,
    "both recorded decisions are in the tail",
  );
  assert.equal(
    observed.seeding?.decisions[0]?.decision,
    first,
    "the tail is newest last, so the older decision is first in it",
  );
  assert.equal(observed.seeding?.decisions.at(-1)?.decision, second);
  assert.deepEqual(
    observed.seeding?.refusals.map((refusal) => refusal.ticket),
    [42],
    "the standing refusals are what a successor must not re-decide blind",
  );
});

test("a session that has bound a runtime session is not seeded again", async () => {
  const partition = await leadRigProject(rig, "bound");
  const session = await sessionRigSession(rig.sessions, partition, "bound", {
    kind: "Lead",
  });
  const first = `selector-decision-bound-first-${String(Date.now())}`;
  const seeding = seedingPolicy().execute(
    requestFor(partition, first),
    new AbortController().signal,
  );
  const pod = await leadRigPodAttempt(rig, partition, session, "bound");
  await leadRigPodTurn(rig, pod, "bound", () => aDecision);
  await seeding;
  assert.notEqual(
    (await rig.mailbox.lead(partition))?.agentReference,
    undefined,
    "the pod's answer binds the runtime session the next turn resumes",
  );

  const second = `selector-decision-bound-second-${String(Date.now())}`;
  const resumed = seedingPolicy().execute(
    requestFor(partition, second),
    new AbortController().signal,
  );
  await leadRigPodTurn(rig, pod, "bound", () => aDecision);
  await resumed;
  assert.equal(
    parseLeadObservation(await turnInput(second)).seeding,
    undefined,
    "a lead that holds its own transcript is not told the record again",
  );
});
