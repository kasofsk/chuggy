/**
 * A lead routed to its project's runners is offered a turn only where a live
 * runner's owner has their Claude account unpaused, against a real server: the
 * selector's admission and the pool plane's claim read one rule over the same
 * rows, a refused pass keeps `UsagePaused` and offers nothing, and the next
 * pass after the pause lifts offers the turn the changes were waiting for.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { leadSessionMint } from "../../src/adapters/crypto/leadSessionMint.ts";
import { selectorServiceRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import { composeSelectorRuntime } from "../../src/compose.ts";
import type { LeadPolicyClock } from "../../src/interpreter/leadPolicyHost.ts";
import { leadSystemPrompt } from "../../src/interpreter/leadTools.ts";
import type { DispatchViewPage } from "../../src/interpreter/dispatchView.ts";
import type { ProjectNotification } from "../../src/interpreter/notifications.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  selectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeSource,
} from "../../src/interpreter/selectorRuntime.ts";
import { agentAccountHarnessCommitted } from "./agentAccountHarness.ts";
import {
  postgresHarnessRolePool,
  postgresHarnessSelectorContext,
} from "./harness.ts";
import {
  leadRigHostedAccess,
  leadRigObservation,
  leadRigOpen,
  leadRigPooled,
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

/** The cursor every project here has moved to, and the one change that moved it. */
const movedTo = 12;

/** A source over one project with a change waiting at `movedTo`, whose decision deadline never fires. */
function usagePauseSource(partition: Partition): SelectorRuntimeSource {
  const change: ProjectNotification = {
    ordinal: movedTo,
    kind: "Ticket",
    resource: "41",
  };
  const events = (after: number) =>
    ({
      result: "Events",
      cursor: Math.max(after, movedTo),
      events: after < movedTo ? [change] : [],
    }) as const;
  const observed = leadRigObservation(partition, movedTo);
  const page: DispatchViewPage = {
    result: "Page",
    token: observed.token,
    candidates: observed.candidates,
    notificationCursor: movedTo,
  };
  return {
    projects: () => Promise.resolve({ projects: [partition] }),
    moved: (_scope, after) => Promise.resolve(events(after)),
    notifications: (_scope, cursor) => Promise.resolve(events(cursor.after)),
    dispatchView: () => Promise.resolve(page),
    operationalContext: () =>
      Promise.resolve({
        ...postgresHarnessSelectorContext,
        observedAtEpochMs: Date.now(),
        observedAt: new Date().toISOString(),
      }),
    currentTimeEpochMs: () => Promise.resolve(Date.now()),
    currentInstant: () => Promise.resolve(new Date().toISOString()),
    decisionDeadline: () => new Promise<never>(() => undefined),
    submit: () => Promise.reject(new Error("no delivery is approved here")),
    operation: () => Promise.resolve(undefined),
  };
}

/**
 * One pass of a selector process over `partition`, on a pool of its own: a
 * pass that offers a turn waits on an answer that never comes, so `ended`
 * settles `Offered` at the lead host's first wait, and `passed` only where the
 * pass offered none. Closing it ends the decision it left running, which the
 * next case's pass would otherwise resume first.
 */
function usagePausePass(partition: Partition) {
  const pool = postgresHarnessRolePool(selectorServiceRole);
  const waited = Promise.withResolvers<"Offered">();
  const clock: LeadPolicyClock = {
    now: () => {
      const epochMs = Date.now();
      return Promise.resolve({
        instant: new Date(epochMs).toISOString(),
        epochMs,
      });
    },
    wait: () => {
      waited.resolve("Offered");
      return new Promise(() => undefined);
    },
  };
  const runtime = composeSelectorRuntime(
    pool,
    usagePauseSource(partition),
    {
      sessions: leadSessionMint(),
      clock,
      deadline: { after: () => new Promise<never>(() => undefined) },
      policy: {
        pollIntervalMs: 5,
        implementationRevision: "usage-pause",
        principal: "principal-usage-pause",
        credentialSlot: "claude-code",
      },
      controlDeadlineMs: 5_000,
    },
    leadRigHostedAccess,
    selectorIdentityFactory(() => `usage-pause-${randomUUID()}`),
  );
  const passed: Promise<SelectorRunResult> = runtime.runOnce();
  return {
    passed,
    ended: Promise.race([passed, waited.promise]),
    close: async () => {
      const store = postgresSelectorState(rig.selectorPool);
      for (const left of await store.unfinishedAttempts(8))
        await store.terminateAttempt(left.attempt, "the case is over");
      await pool.end();
    },
  };
}

/** A project holding a lead whose prompt the selector's settings compose, so no pass replaces it. */
async function usagePauseProject(label: string): Promise<Partition> {
  const partition = await leadRigProject(rig, label);
  const settings = await postgresSelectorRuntimeControl(
    rig.selectorPool,
  ).projectSettings(partition);
  await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
    systemPrompt: leadSystemPrompt({ basePrompt: settings.basePrompt }),
    autoCompactWindow: settings.limits.autoCompactWindow,
  });
  return partition;
}

function usagePauseOwner(label: string) {
  return asPrincipal(`https://issuer.invalid#owner-${label}-${randomUUID()}`);
}

/** A weekly reading at `utilization` whose window resets an hour from now. */
function usagePauseWeekly(utilization: number) {
  return {
    readings: [
      {
        window: "seven_day" as const,
        utilization,
        resetsSecs: 3600,
        observedSecs: -60,
      },
    ],
  };
}

async function usagePauseTurns(partition: Partition) {
  return rig.sessions.harness.query(
    `SELECT route FROM session_turn WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
}

async function usagePauseRefusal(partition: Partition) {
  return rig.sessions.harness.query(
    `SELECT refusal FROM selector_lead_refusal WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
}

test("a lead whose only live runner's owner is paused for usage is refused UsagePaused, offered no turn, and keeps the refusal", async () => {
  const partition = await usagePauseProject("usage-paused");
  const owner = usagePauseOwner("paused");
  await leadRigPooled(rig, partition, owner);
  await agentAccountHarnessCommitted(
    rig.sessions.harness,
    owner,
    "Claude",
    usagePauseWeekly(0.9),
  );
  const pass = usagePausePass(partition);
  try {
    assert.notEqual(await pass.ended, "Offered", "no turn was offered");
    const result = await pass.passed;
    assert.deepEqual(result.failures, [{ phase: "UsagePaused", partition }]);
    assert.equal(result.observed, 0, "a refused project takes no permit");
  } finally {
    await pass.close();
  }
  assert.deepEqual(await usagePauseTurns(partition), []);
  assert.deepEqual(await usagePauseRefusal(partition), [
    { refusal: "UsagePaused" },
  ]);
});

/** What lifts the weekly pause `usagePauseWeekly(0.9)` holds: a threshold raised above it, or its reset passed. */
const usagePauseLifts = [
  [
    "raised",
    {
      ...usagePauseWeekly(0.9),
      setting: {
        fiveHourPercent: 80,
        sevenDayPercent: 95,
        pausesThreads: false,
      },
    },
  ],
  [
    "reset",
    {
      readings: [
        {
          window: "seven_day" as const,
          utilization: 0.9,
          resetsSecs: -1,
          observedSecs: -60,
        },
      ],
    },
  ],
] as const;

/**
 * A project whose only live runner's owner held the weekly pause and lifted it
 * by `lifted`, after one pass met the pause where `refusedFirst` says so; the
 * next pass is asserted to offer the one turn its changes waited for.
 */
async function usagePauseLiftedOffers(
  label: string,
  lifted: (typeof usagePauseLifts)[number][1],
  refusedFirst: boolean,
): Promise<void> {
  const partition = await usagePauseProject(label);
  const owner = usagePauseOwner(label);
  await leadRigPooled(rig, partition, owner);
  await agentAccountHarnessCommitted(
    rig.sessions.harness,
    owner,
    "Claude",
    usagePauseWeekly(0.9),
  );
  if (refusedFirst) {
    const refused = usagePausePass(partition);
    try {
      assert.deepEqual((await refused.passed).failures, [
        { phase: "UsagePaused", partition },
      ]);
    } finally {
      await refused.close();
    }
  }
  await agentAccountHarnessCommitted(
    rig.sessions.harness,
    owner,
    "Claude",
    lifted,
  );
  const admitted = usagePausePass(partition);
  try {
    assert.equal(await admitted.ended, "Offered", label);
  } finally {
    await admitted.close();
  }
  assert.deepEqual(await usagePauseTurns(partition), [{ route: "Pool" }]);
  assert.deepEqual(await usagePauseRefusal(partition), [], label);
}

test("a pause lifted by a raised threshold or a reset that passed lets the next pass offer the lead its turn", async () => {
  for (const [label, lifted] of usagePauseLifts)
    await usagePauseLiftedOffers(`usage-lifted-${label}`, lifted, false);
});

test("a pass refused for usage moves no cursor, so the first pass once the pause lifts offers the turn its changes waited for", async () => {
  for (const [label, lifted] of usagePauseLifts)
    await usagePauseLiftedOffers(`usage-refused-${label}`, lifted, true);
});

/** Which of the project's sessions one pool is handed, as the pool plane asks. */
async function usagePauseAwaiting(partition: Partition, pool: string) {
  return rig.sessions.harness.query(
    `SELECT s.session FROM worker_pool w
       CROSS JOIN LATERAL pool_sessions_awaiting_claim(
         w.tenant,w.project,w.pool,w.principal,0,8) s
      WHERE w.tenant=$1 AND w.project=$2 AND w.pool=$3`,
    [partition.tenant, partition.project, pool],
  );
}

test("a lead with one paused and one unpaused owner's live runner is admitted, and the pool plane hands it to the unpaused owner's pool alone", async () => {
  const partition = await usagePauseProject("usage-split");
  const paused = usagePauseOwner("split-paused");
  const running = usagePauseOwner("split-running");
  const pausedPool = await leadRigPooled(rig, partition, paused);
  const runningPool = await leadRigPooled(rig, partition, running);
  await agentAccountHarnessCommitted(
    rig.sessions.harness,
    paused,
    "Claude",
    usagePauseWeekly(0.95),
  );
  await agentAccountHarnessCommitted(
    rig.sessions.harness,
    running,
    "Claude",
    usagePauseWeekly(0.2),
  );
  const pass = usagePausePass(partition);
  try {
    assert.equal(await pass.ended, "Offered");
  } finally {
    await pass.close();
  }
  assert.deepEqual(await usagePauseTurns(partition), [{ route: "Pool" }]);
  assert.deepEqual(await usagePauseAwaiting(partition, pausedPool), []);
  assert.equal((await usagePauseAwaiting(partition, runningPool)).length, 1);
});
