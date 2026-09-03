/**
 * What every lead case needs of a real PostgreSQL: the session rig 058's
 * suites already stand on, the two further role pools 059's doors are granted
 * to, and a recorded decision for a refusal to hang off.
 *
 * EACH DOOR STANDS ON THE ROLE IT IS GRANTED TO. The selector's mailbox and
 * write door run as `chuggy_selector_service` and the reads as `chuggy_api`,
 * because a suite that drove both as the migration owner would be green over a
 * grant that had never been made — which is a defect only the deployed
 * credential meets.
 *
 * A REFUSAL HANGS OFF AN INTERACTION. `selector_agentic_refusal` keys its
 * decision to `selector_interaction`, so a case that wants a refusal wants a
 * recorded decision first, and this is where one is made.
 */

import { randomUUID } from "node:crypto";

import type pg from "pg";

import { postgresAgenticRefusalReads } from "../../src/adapters/postgres/agenticRefusal.ts";
import {
  postgresAgenticRefusalStanding,
  postgresAgenticRefusalWrites,
} from "../../src/adapters/postgres/agenticRefusal.ts";
import {
  postgresLeadMailbox,
  postgresLeadSystemPrompt,
} from "../../src/adapters/postgres/leadMailbox.ts";
import {
  postgresLeadReads,
  type PostgresLeadReads,
} from "../../src/adapters/postgres/leadReads.ts";
import {
  apiRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import { sessionRigAttempt, type SessionRigAttempt } from "./sessionHarness.ts";
import type {
  AgenticRefusalRead,
  AgenticRefusalWrite,
} from "../../src/interpreter/agenticRefusal.ts";
import type {
  LeadSystemPromptPort,
  SessionId,
  SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { LeadMailbox } from "../../src/interpreter/leadMailbox.ts";
import type { JsonValue } from "../../src/interpreter/selector.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import { postgresHarnessSelectorContext } from "./harness.ts";
import { sessionRigOpen, type SessionRig } from "./sessionHarness.ts";

/** One opened subject: the session rig, the two role pools and every door over them. */
export interface LeadRig {
  readonly sessions: SessionRig;
  readonly selectorPool: pg.Pool;
  readonly apiPool: pg.Pool;
  readonly mailbox: LeadMailbox;
  readonly prompts: LeadSystemPromptPort;
  readonly writes: AgenticRefusalWrite;
  readonly selectorStanding: Pick<AgenticRefusalRead, "standing">;
  readonly apiRefusals: AgenticRefusalRead;
  readonly apiLead: PostgresLeadReads;
  readonly close: () => Promise<void>;
}

export async function leadRigOpen(): Promise<LeadRig> {
  const sessions = await sessionRigOpen();
  const selectorPool = postgresHarnessRolePool(selectorServiceRole);
  const apiPool = postgresHarnessRolePool(apiRole);
  return {
    sessions,
    selectorPool,
    apiPool,
    mailbox: postgresLeadMailbox(selectorPool),
    prompts: postgresLeadSystemPrompt(selectorPool),
    writes: postgresAgenticRefusalWrites(selectorPool),
    selectorStanding: postgresAgenticRefusalStanding(selectorPool),
    apiRefusals: postgresAgenticRefusalReads(apiPool),
    apiLead: postgresLeadReads(apiPool),
    close: async () => {
      await apiPool.end();
      await selectorPool.end();
      await sessions.close();
    },
  };
}

/** A provisioned project no other case is holding. */
export function leadRigProject(
  rig: LeadRig,
  label: string,
): Promise<Partition> {
  return postgresHarnessProject(rig.sessions.harness.store, `lead-${label}`);
}

/** The revisions a case's decision ran under, which no case here is about. */
const leadRigFence = {
  settingsRevision: 1,
  projectSettingsRevision: 0,
} as const;

/** What a case varies about the decision it records, and nothing else. */
export interface LeadRigDecision {
  readonly notificationCursor?: number;
  readonly handoffNote?: JsonValue;
  readonly toolActivity?: readonly JsonValue[];
  readonly planningIntent?: JsonValue;
}

/**
 * One recorded decision, which is what a refusal names. The interaction is the
 * smallest one the store accepts: a case here is about the ledger beside it.
 */
export async function leadRigDecision(
  rig: LeadRig,
  partition: Partition,
  label: string,
  varying: LeadRigDecision = {},
): Promise<string> {
  const decision = `selector-decision-${label}-${randomUUID()}`;
  const state = postgresSelectorState(rig.selectorPool);
  const recorded = await state.recordInteraction(
    {
      decision,
      partition,
      instructionsVersion: "1.0",
      instructions: "choose a dispatchable ticket",
      observedView: [],
      context: {
        operationalContext: postgresHarnessSelectorContext,
        handoffNote: varying.handoffNote ?? {},
      },
      toolActivity: varying.toolActivity ?? [],
      result: { dispatches: [] },
      implementationRevision: "implementation-1",
      modelRevision: "model-1",
      policyRevision: "policy-1",
      accounting: { tokens: 1, durationMs: 1 },
      startedAt: "2026-09-02T12:00:00.000Z",
      completedAt: "2026-09-02T12:00:01.000Z",
    },
    {
      partition,
      notificationCursor: varying.notificationCursor ?? 0,
      revision: (await state.project(partition))?.revision ?? 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    leadRigFence,
    varying.planningIntent,
  );
  if (!recorded)
    throw new Error(`lead rig: recording ${label} answered nothing new`);
  return decision;
}

/** How long one wait in this harness may poll, and how often. */
const leadRigPollMs = 5;
const leadRigPollsMax = 2_000;

/**
 * Waits for something the runtime does from another connection, and gives up
 * rather than hanging: an unbounded wait in a suite is a gate that stalls
 * instead of failing, which is a red nobody can read.
 */
async function leadRigWaited<T>(
  attempt: () => Promise<T>,
  gaveUp: string,
): Promise<T> {
  for (let poll = 0; poll < leadRigPollsMax; poll += 1) {
    try {
      return await attempt();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, leadRigPollMs));
    }
  }
  throw new Error(gaveUp);
}

/**
 * The lead a project holds once the runtime has opened one, waited for because
 * the successor's identity is minted in the pass rather than by the case.
 */
export function leadRigSuccessor(
  rig: LeadRig,
  partition: Partition,
  replacing: SessionId,
): Promise<SessionId> {
  return leadRigWaited(async () => {
    const standing = await rig.mailbox.lead(partition);
    if (standing === undefined || standing.session === replacing)
      throw new Error("no successor yet");
    return standing.session;
  }, `${replacing}: no successor was ever opened`);
}

/** One live pod attempt, waited for because the runtime enqueues from elsewhere. */
export function leadRigPodAttempt(
  rig: LeadRig,
  partition: Partition,
  session: SessionId,
  label: string,
): Promise<SessionRigAttempt> {
  return leadRigWaited(
    () => sessionRigAttempt(rig.sessions, partition, session, label),
    `${label}: no turn ever became launchable`,
  );
}

/**
 * One turn taken by a pod that already holds an attempt: it claims, binds the
 * runtime session the way a real pod does — which is what makes the next turn a
 * resumed one rather than a seeded one — and answers what the case decides.
 * A session holds one live attempt, so a case wanting two turns takes them both
 * on one of these.
 */
export async function leadRigPodTurn(
  rig: LeadRig,
  attempt: SessionRigAttempt,
  label: string,
  decide: (input: string) => unknown,
): Promise<SessionTurnId> {
  for (let poll = 0; poll < leadRigPollsMax; poll += 1) {
    const claimed = await rig.sessions.plane.claim({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
    });
    if (claimed === undefined) {
      await new Promise((resolve) => setTimeout(resolve, leadRigPollMs));
      continue;
    }
    const bound = await rig.sessions.plane.bind({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      reference: `agent-session-${label}`,
    });
    if (bound !== "Bound" && bound !== "AlreadyBound")
      throw new Error(
        `${label}: the pod's own runtime session was ${bound}; a row already holding another's is what answers Conflict`,
      );
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn: claimed.turn,
      result: JSON.stringify(decide(claimed.input)),
      measured: {
        model: "claude-model",
        tokens: 4_096,
        costMicros: 12_345,
        durationMs: 61_000,
        tools: ["Read"],
      },
    });
    return claimed.turn;
  }
  throw new Error(`${label}: no turn ever became claimable`);
}

/** A pod that takes exactly one turn, which is what most cases here need. */
export async function leadRigPod(
  rig: LeadRig,
  partition: Partition,
  session: SessionId,
  label: string,
  decide: (input: string) => unknown,
): Promise<SessionTurnId> {
  return leadRigPodTurn(
    rig,
    await leadRigPodAttempt(rig, partition, session, label),
    label,
    decide,
  );
}
