/**
 * What every lead case needs of a real PostgreSQL: the session rig the session
 * suites already stand on, the two further role pools the lead doors are
 * granted to, and a recorded decision for a refusal to hang off.
 *
 * EACH DOOR STANDS ON THE ROLE IT IS GRANTED TO. The lead turn door and the
 * selector's write door run as `chuggy_selector_service` and the reads as `chuggy_api`,
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
  postgresAgenticRefusalBinding,
  postgresAgenticRefusalStanding,
  postgresAgenticRefusalLedger,
} from "../../src/adapters/postgres/agenticRefusal.ts";
import {
  postgresLeadReads,
  type PostgresLeadReads,
} from "../../src/adapters/postgres/leadReads.ts";
import {
  apiRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import { postgresWorkerPoolRegistry } from "../../src/adapters/postgres/workerPool.ts";
import { sessionRigRouted } from "./sessionHarness.ts";
import type {
  AgenticRefusalBindingRead,
  AgenticRefusalRead,
  AgenticRefusalSelectorRead,
  AgenticRefusalWrite,
} from "../../src/interpreter/agenticRefusal.ts";
import type { SessionTurnId } from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { JsonValue } from "../../src/interpreter/selector.ts";
import type { PlacementRoute } from "../../src/contract/rosters.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { DispatchCandidate } from "../../src/interpreter/dispatchView.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import { postgresHarnessSelectorContext } from "./harness.ts";
import { sessionRigOpen, type SessionRig } from "./sessionHarness.ts";

/** One opened subject: the session rig, the two role pools and every door over them. */
export interface LeadRig {
  readonly sessions: SessionRig;
  readonly selectorPool: pg.Pool;
  readonly apiPool: pg.Pool;
  readonly writes: AgenticRefusalWrite;
  readonly selectorStanding: AgenticRefusalSelectorRead;
  readonly apiRefusals: AgenticRefusalRead;
  readonly apiRefusalsBinding: AgenticRefusalBindingRead;
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
    writes: postgresAgenticRefusalLedger(selectorPool),
    selectorStanding: postgresAgenticRefusalStanding(selectorPool),
    apiRefusals: postgresAgenticRefusalReads(apiPool),
    apiRefusalsBinding: postgresAgenticRefusalBinding(apiPool),
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
  readonly observedView?: readonly DispatchCandidate[];
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
      observedView: varying.observedView ?? [],
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

/** Offers the project's lead one turn through the selector's door, answering what the door answered. */
export async function leadRigTurnOffered(
  rig: LeadRig,
  partition: Partition,
  turn: SessionTurnId,
  input: string,
  route: PlacementRoute,
): Promise<string | undefined> {
  const offered = await rig.selectorPool.query<{ enqueued: string }>(
    "SELECT enqueued FROM enqueue_lead_turn($1,$2,$3,$4,$5)",
    [partition.tenant, partition.project, turn, input, route],
  );
  return offered.rows[0]?.enqueued;
}

/**
 * A pool of the project registered by `owner`, polled just now, with the
 * project's lead routed to its runners: a runner that would take the lead now
 * but for its owner's account.
 */
export async function leadRigPooled(
  rig: LeadRig,
  partition: Partition,
  owner: Principal,
): Promise<string> {
  const pool = `lead-pool-${randomUUID()}`;
  await sessionRigRouted(rig.sessions, partition, "InCluster", "Pool");
  const registered = await postgresWorkerPoolRegistry(rig.apiPool).register({
    partition,
    pool,
    capabilities: [],
    class: "Dedicated",
    clientId: `chuggy-pool-${randomUUID()}`,
    principal: asPrincipal(`https://issuer.invalid#pool-${randomUUID()}`),
    registeredBy: owner,
  });
  if (!registered) throw new Error(`lead rig: ${pool} was not registered`);
  await rig.sessions.harness.query(
    `UPDATE worker_pool SET last_polled_at=now()
      WHERE tenant=$1 AND project=$2 AND pool=$3`,
    [partition.tenant, partition.project, pool],
  );
  return pool;
}

/** Keeps `named` as the credentials `pool`'s newest poll named of Claude, or none where it is absent, as the pool plane's write does. */
export async function leadRigNamed(
  rig: LeadRig,
  partition: Partition,
  pool: string,
  named?: readonly string[],
): Promise<void> {
  await rig.sessions.harness.query(
    `UPDATE worker_pool SET credentials_named=$4::jsonb
      WHERE tenant=$1 AND project=$2 AND pool=$3`,
    [
      partition.tenant,
      partition.project,
      pool,
      named === undefined ? null : JSON.stringify({ Claude: named }),
    ],
  );
}
