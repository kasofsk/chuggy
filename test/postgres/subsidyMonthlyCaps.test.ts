/**
 * A subsidized lead's monthly caps against a real server: what
 * `subsidized_lead_spend` sums of a tenant's sessions and of the deployment's,
 * the admission the selector asks of it, and the refusal it keeps until the
 * month turns.
 *
 * Each case publishes the profile on a credential slot of its own, so the
 * deployment's sum is the spend of that case's sessions alone.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import {
  postgresLeadRouteReads,
  postgresSessionRouteReads,
  postgresSubsidizedLeadPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import {
  apiRole,
  schedulerRole,
  selectorServiceRole,
  sessionPlacementSetFunction,
  subsidizedLeadSpendFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import type {
  SessionId,
  SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  leadAdmission,
  type SubsidizedLeadOffer,
  type SubsidizedLeadSpend,
} from "../../src/interpreter/sessionPlacement.ts";
import {
  postgresHarnessDenial,
  postgresHarnessPartition,
  postgresHarnessProject,
  postgresHarnessRolePool,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  sessionRigOpen,
  sessionRigSession,
  sessionRigTurn,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
let apiPool: pg.Pool;
let selectorPool: pg.Pool;
before(async () => {
  rig = await sessionRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
});
after(async () => {
  await Promise.all([apiPool.end(), selectorPool.end()]);
  await rig.close();
});

/** The profile a case publishes, on a slot no other case spends on. */
function capsOffer(
  label: string,
  caps: Partial<SubsidizedLeadOffer> = {},
): SubsidizedLeadOffer {
  return {
    credentialSlot: `subsidy-${label}-${randomUUID()}`,
    model: "claude-haiku-5-5",
    effort: "low",
    autoCompactWindow: 100_000,
    inputBytesPerDecision: 65_536,
    turnTokensMax: 200_000,
    tenantMonthlyMicros: 1_000,
    deploymentMonthlyMicros: 10_000,
    unmeasuredTurnMicros: 50,
    ...caps,
  };
}

/** Publishes `offer` as the selector does as it starts. */
async function capsPublished(offer: SubsidizedLeadOffer): Promise<void> {
  assert.deepEqual(
    await postgresSubsidizedLeadPrecondition(selectorPool, offer).check(
      new AbortController().signal,
    ),
    { met: "Met" },
  );
}

/** A project in `tenant`, or in a tenant of its own, whose lead runs in cluster as `offering`. */
async function capsProject(
  label: string,
  offering: "Own" | "Subsidized" = "Subsidized",
  tenant?: Partition["tenant"],
): Promise<Partition> {
  const named = postgresHarnessPartition(`caps-${label}`);
  const partition = await postgresHarnessProject(
    rig.harness.store,
    `caps-${label}`,
    tenant === undefined ? named : { ...named, tenant },
  );
  await rig.harness.query(
    `SELECT ${sessionPlacementSetFunction}($1,$2,'Pool','InCluster',$3,'Member','an-owner')`,
    [partition.tenant, partition.project, offering],
  );
  return partition;
}

/** A lead of `partition` on `slot`, and a fork of it where `kind` is `Inquiry`. */
async function capsSession(
  partition: Partition,
  label: string,
  slot: string,
  kind: "Lead" | "Inquiry" | "Thread" = "Lead",
): Promise<SessionId> {
  if (kind !== "Inquiry")
    return sessionRigSession(rig, partition, label, {
      kind,
      credentialSlot: slot,
    });
  const lead = await sessionRigSession(rig, partition, `${label}-parent`, {
    credentialSlot: slot,
  });
  return sessionRigSession(rig, partition, label, {
    kind: "Inquiry",
    parent: lead,
    capabilities: ["ProjectRead"],
    credentialSlot: slot,
  });
}

/** What one turn ended as, written as the plane records it. */
type CapsTurnEnd =
  | { readonly end: "Answered"; readonly costMicros: number }
  | { readonly end: "Failed"; readonly failure: string }
  | { readonly end: "Lost"; readonly times: number }
  | { readonly end: "Queued" };

/**
 * Enqueues one turn of `session` and ends it as `ended`. A lost turn is held by
 * an attempt that `release_session_attempt_turns` then ends, `times` over.
 */
async function capsTurn(
  partition: Partition,
  session: SessionId,
  label: string,
  ended: CapsTurnEnd,
): Promise<SessionTurnId> {
  const turn = await sessionRigTurn(rig, partition, session, label);
  const key = [partition.tenant, partition.project, session, turn];
  const where = `tenant=$1 AND project=$2 AND session=$3 AND turn=$4`;
  switch (ended.end) {
    case "Answered":
      await rig.harness.query(
        `UPDATE session_turn
            SET state='Answered',result='answered',ended_at=now(),
                model='claude-haiku-5-5',tokens=1,cost_micros=$5,
                duration_ms=1,tools='{}'
          WHERE ${where}`,
        [...key, ended.costMicros],
      );
      break;
    case "Failed":
      await rig.harness.query(
        `UPDATE session_turn SET state='Failed',failure=$5,ended_at=now()
          WHERE ${where}`,
        [...key, ended.failure],
      );
      break;
    case "Lost":
      for (let time = 1; time <= ended.times; time += 1) {
        const attempt = `attempt-${label}-${String(time)}`;
        await rig.harness.query(
          `UPDATE session_turn
              SET state='Claimed',attempt=$5,claim_generation=1,claimed_at=now()
            WHERE ${where}`,
          [...key, attempt],
        );
        await rig.harness.query(
          `SELECT release_session_attempt_turns($1,$2,$3,$4)`,
          [partition.tenant, partition.project, session, attempt],
        );
      }
      break;
    case "Queued":
      break;
  }
  return turn;
}

/** What `partition`'s tenant and the deployment spent this month, as the selector reads it. */
function capsSpend(
  partition: Partition,
): Promise<SubsidizedLeadSpend | undefined> {
  return postgresLeadRouteReads(selectorPool).subsidizedLeadSpend(partition);
}

/** The selector's admission of `partition`'s lead, which asks a subsidized one no grant. */
async function capsAdmission(partition: Partition): Promise<string> {
  return (
    await leadAdmission(
      memoryProjectAccess(),
      postgresLeadRouteReads(selectorPool),
      asPrincipal("principal-caps-selector"),
      partition,
    )
  ).admission;
}

/** Moves every turn of `partition` to the last instant of the month before this one in UTC. */
async function capsLastMonth(partition: Partition): Promise<void> {
  await rig.harness.query(
    `UPDATE session_turn
        SET enqueued_at=(date_trunc('month', now() AT TIME ZONE 'UTC')
                         AT TIME ZONE 'UTC') - interval '1 microsecond'
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
}

/** The first instant of next month in UTC, as the API renders an instant. */
function capsNextMonth(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
}

test("a tenant whose subsidized sessions spent the cap this month is refused SubsidyExhausted until the first of the next month, and admitted again once that spend is last month's", async () => {
  const offer = capsOffer("exhausted");
  await capsPublished(offer);
  const partition = await capsProject("exhausted");
  const lead = await capsSession(
    partition,
    "caps-exhausted",
    offer.credentialSlot,
  );
  await capsTurn(partition, lead, "under", {
    end: "Answered",
    costMicros: 999,
  });
  assert.equal(await capsAdmission(partition), "Admitted");
  await capsTurn(partition, lead, "at", { end: "Answered", costMicros: 1 });
  assert.deepEqual(await capsSpend(partition), {
    tenantMicros: 1_000,
    tenantMonthlyMicros: 1_000,
    deploymentMicros: 1_000,
    deploymentMonthlyMicros: 10_000,
  });
  assert.equal(await capsAdmission(partition), "SubsidyExhausted");

  await postgresSelectorState(selectorPool).recordLeadRefusal(
    partition,
    "SubsidyExhausted",
  );
  const refused = await postgresLeadReads(apiPool).leadRefusal(partition);
  assert.equal(refused?.reason, "SubsidyExhausted");
  assert.equal(refused.until, capsNextMonth());

  await capsLastMonth(partition);
  assert.equal((await capsSpend(partition))?.tenantMicros, 0);
  assert.equal(await capsAdmission(partition), "Admitted");
});

test("a failed turn and each time an ended attempt left a turn in flight are charged the unmeasured price, and a turn never run is not", async () => {
  const offer = capsOffer("unmeasured", { unmeasuredTurnMicros: 7 });
  await capsPublished(offer);
  const partition = await capsProject("unmeasured");
  const lead = await capsSession(
    partition,
    "caps-unmeasured",
    offer.credentialSlot,
  );
  const charged = async () => (await capsSpend(partition))?.tenantMicros;
  await capsTurn(partition, lead, "failed", {
    end: "Failed",
    failure: "AgentBudgetExhausted",
  });
  assert.equal(await charged(), 7);
  await capsTurn(partition, lead, "lost-once", { end: "Lost", times: 1 });
  assert.equal(await charged(), 14, "a turn requeued after its attempt ended");
  await capsTurn(partition, lead, "lost-out", { end: "Lost", times: 3 });
  assert.equal(await charged(), 35, "a turn AttemptLost after three");
  await capsTurn(partition, lead, "queued", { end: "Queued" });
  assert.equal(await charged(), 35);
});

test("spend on the deployment's own slot, by another tenant, or by a thread on the profile's slot does not count toward a tenant's sum", async () => {
  const offer = capsOffer("apart");
  await capsPublished(offer);
  const partition = await capsProject("apart");
  const other = await capsProject("apart-other");
  const own = await capsSession(partition, "caps-apart-own", "claude-code");
  await capsTurn(partition, own, "own", { end: "Answered", costMicros: 500 });
  await capsTurn(partition, own, "own-failed", {
    end: "Failed",
    failure: "AgentFailed",
  });
  const thread = await capsSession(
    partition,
    "caps-apart-thread",
    offer.credentialSlot,
    "Thread",
  );
  await capsTurn(partition, thread, "thread", {
    end: "Answered",
    costMicros: 500,
  });
  const theirs = await capsSession(
    other,
    "caps-apart-other",
    offer.credentialSlot,
  );
  await capsTurn(other, theirs, "theirs", { end: "Answered", costMicros: 300 });
  assert.deepEqual(await capsSpend(partition), {
    tenantMicros: 0,
    tenantMonthlyMicros: 1_000,
    deploymentMicros: 300,
    deploymentMonthlyMicros: 10_000,
  });
  assert.equal((await capsSpend(other))?.tenantMicros, 300);
});

test("a tenant's sum takes each of its subsidized projects, and an inquiry's spend counts as its lead's does", async () => {
  const offer = capsOffer("tenant");
  await capsPublished(offer);
  const first = await capsProject("tenant-first");
  const second = await capsProject("tenant-second", "Subsidized", first.tenant);
  const lead = await capsSession(
    first,
    "caps-tenant-lead",
    offer.credentialSlot,
  );
  await capsTurn(first, lead, "lead", { end: "Answered", costMicros: 200 });
  const inquiry = await capsSession(
    second,
    "caps-tenant-inquiry",
    offer.credentialSlot,
    "Inquiry",
  );
  await capsTurn(second, inquiry, "inquiry", {
    end: "Answered",
    costMicros: 30,
  });
  for (const partition of [first, second])
    assert.equal((await capsSpend(partition))?.tenantMicros, 230);
});

test("two tenants each under its cap whose sum reaches the deployment's cap are both refused", async () => {
  const offer = capsOffer("deployment", {
    tenantMonthlyMicros: 1_000,
    deploymentMonthlyMicros: 1_500,
  });
  await capsPublished(offer);
  const first = await capsProject("deployment-first");
  const second = await capsProject("deployment-second");
  for (const [partition, label] of [
    [first, "first"],
    [second, "second"],
  ] as const) {
    const lead = await capsSession(
      partition,
      `caps-deployment-${label}`,
      offer.credentialSlot,
    );
    await capsTurn(partition, lead, label, {
      end: "Answered",
      costMicros: 750,
    });
  }
  for (const partition of [first, second]) {
    const spend = await capsSpend(partition);
    assert.ok(spend !== undefined && spend.tenantMicros < 1_000);
    assert.equal(spend.deploymentMicros, 1_500);
    assert.equal(await capsAdmission(partition), "SubsidyExhausted");
  }
});

test("a lead run as its own answers no subsidy spend, however its tenant's subsidized projects spend", async () => {
  const offer = capsOffer("own");
  await capsPublished(offer);
  const subsidized = await capsProject("own-subsidized");
  const own = await capsProject("own-own", "Own", subsidized.tenant);
  const lead = await capsSession(subsidized, "caps-own", offer.credentialSlot);
  await capsTurn(subsidized, lead, "own", {
    end: "Answered",
    costMicros: 1_000,
  });
  assert.equal(await capsSpend(own), undefined);
  assert.equal(
    await postgresSessionRouteReads(apiPool).subsidizedLeadSpend(own),
    undefined,
  );
  assert.equal(await capsAdmission(subsidized), "SubsidyExhausted");
});

test("only the selector and the API may ask a project's subsidy spend", async () => {
  const offer = capsOffer("doors");
  await capsPublished(offer);
  const partition = await capsProject("doors");
  const asked = `SELECT * FROM ${subsidizedLeadSpendFunction}('${partition.tenant}','${partition.project}')`;
  for (const role of [apiRole, selectorServiceRole])
    assert.equal(await rig.harness.attemptAs(role, asked), undefined, role);
  for (const role of [schedulerRole, ticketServiceRole, workerPlaneRole])
    assert.match(
      (await rig.harness.attemptAs(role, asked)) ?? "",
      postgresHarnessDenial(subsidizedLeadSpendFunction),
      role,
    );
});
