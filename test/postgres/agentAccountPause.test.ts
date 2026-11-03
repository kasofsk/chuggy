/**
 * The rule an account's agent is paused by, asked of `agent_account_pause` at
 * its edges against a real server and under the pool plane's role, which is
 * the role every claim asks it as.
 *
 * EACH CASE PLANTS AND ASKS IN ONE TRANSACTION, so `now()` is one instant
 * across both and an edge stated as an offset from it is the edge asked.
 * Nothing a case plants is kept.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { poolPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  agentAccountHarnessPlanted,
  type AgentAccountHarnessAgent,
  type AgentAccountHarnessReading,
  type AgentAccountHarnessState,
} from "./agentAccountHarness.ts";
import { postgresHarnessOpen } from "./harness.ts";

const harness = await postgresHarnessOpen();

after(() => harness.close());

/** What the rule answers: how long from now the pause lasts, or none, each reason, and whether a press lets a claim through. */
interface Paused {
  readonly untilSecs: number | null;
  readonly reasons: readonly string[];
  readonly admittedByPress: boolean;
}

const unpaused: Paused = {
  untilSecs: null,
  reasons: [],
  admittedByPress: false,
};

/** The rule's answer for `asked` of `agent` once `state` is planted for a fresh account's Claude, the account asked being that one unless named. */
async function pausedFor(
  state: AgentAccountHarnessState,
  agent: AgentAccountHarnessAgent | null = "Claude",
  asked: (principal: string) => string | null = (principal) => principal,
): Promise<Paused> {
  const principal = `https://issuer.invalid#member-${randomUUID()}`;
  const transaction = await harness.begin();
  try {
    await agentAccountHarnessPlanted(transaction, principal, "Claude", state);
    await transaction.query(`SET LOCAL ROLE ${poolPlaneRole}`);
    const [row] = await transaction.query(
      `SELECT extract(epoch FROM paused_until-now())::int AS until_secs,
              reasons,admitted_by_press
         FROM agent_account_pause($1,$2)`,
      [asked(principal), agent],
    );
    return {
      untilSecs: row?.["until_secs"] as number | null,
      reasons: row?.["reasons"] as string[],
      admittedByPress: row?.["admitted_by_press"] as boolean,
    };
  } finally {
    await transaction.rollback();
  }
}

function reading(
  window: AgentAccountHarnessReading["window"],
  utilization: number,
  resetsSecs = 600,
  observedSecs = -60,
): AgentAccountHarnessReading {
  return { window, utilization, resetsSecs, observedSecs };
}

test("with no setting a reading pauses at the default threshold of its window and not below it", async () => {
  assert.deepEqual(await pausedFor({ readings: [reading("five_hour", 0.8)] }), {
    untilSecs: 600,
    reasons: ["five_hour"],
    admittedByPress: false,
  });
  assert.deepEqual(
    await pausedFor({ readings: [reading("five_hour", 0.79)] }),
    unpaused,
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("seven_day", 0.9, 3000)] }),
    { untilSecs: 3000, reasons: ["seven_day"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("seven_day", 0.89, 3000)] }),
    unpaused,
  );
});

test("a reading exactly at a threshold the person set pauses, and one a hair under does not", async () => {
  const setting = {
    fiveHourPercent: 29,
    sevenDayPercent: 57,
    pausesThreads: false,
    pausesLead: true,
  };
  assert.deepEqual(
    await pausedFor({ readings: [reading("five_hour", 0.29)], setting }),
    { untilSecs: 600, reasons: ["five_hour"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("seven_day", 0.57)], setting }),
    { untilSecs: 600, reasons: ["seven_day"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("five_hour", 0.2899)], setting }),
    unpaused,
  );
});

test("a reading whose reset is now or past counts for nothing", async () => {
  assert.deepEqual(
    await pausedFor({ readings: [reading("five_hour", 1, 0)] }),
    unpaused,
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("seven_day", 1, -1)] }),
    unpaused,
  );
  assert.deepEqual(
    await pausedFor({ readings: [reading("five_hour", 1, 1)] }),
    { untilSecs: 1, reasons: ["five_hour"], admittedByPress: false },
  );
});

test("a limit pauses until its reset, or an hour from when it was received where its reset is unknown", async () => {
  assert.deepEqual(
    await pausedFor({ limit: { observedSecs: -60, resetsSecs: 300 } }),
    { untilSecs: 300, reasons: ["limit"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({ limit: { observedSecs: -60, resetsSecs: 0 } }),
    unpaused,
  );
  assert.deepEqual(await pausedFor({ limit: { observedSecs: -3599 } }), {
    untilSecs: 1,
    reasons: ["limit"],
    admittedByPress: false,
  });
  assert.deepEqual(
    await pausedFor({ limit: { observedSecs: -3600 } }),
    unpaused,
  );
  assert.deepEqual(
    await pausedFor({ limit: { observedSecs: -3601 } }),
    unpaused,
  );
});

test("a reading observed after a limit clears it, and one observed before it does not", async () => {
  const limit = { observedSecs: -60, resetsSecs: 300 };
  assert.deepEqual(
    await pausedFor({ limit, readings: [reading("five_hour", 0.1, 600, -30)] }),
    unpaused,
  );
  assert.deepEqual(
    await pausedFor({ limit, readings: [reading("five_hour", 0.1, 600, -90)] }),
    { untilSecs: 300, reasons: ["limit"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({
      limit,
      readings: [reading("five_hour", 0.95, 600, -30)],
    }),
    { untilSecs: 600, reasons: ["five_hour"], admittedByPress: false },
    "the reading that cleared the limit still pauses by its own threshold",
  );
});

test("a press lets a claim through a limit only where it came after the limit and is unspent", async () => {
  const limit = { observedSecs: -60, resetsSecs: 300 };
  const held = { untilSecs: 300, reasons: ["limit"] };
  assert.deepEqual(await pausedFor({ limit, press: { pressedSecs: -30 } }), {
    ...held,
    admittedByPress: true,
  });
  assert.deepEqual(
    await pausedFor({ limit, press: { pressedSecs: -120 } }),
    { ...held, admittedByPress: false },
    "a press before the limit",
  );
  assert.deepEqual(
    await pausedFor({ limit, press: { pressedSecs: -30, spentSecs: -10 } }),
    { ...held, admittedByPress: false },
    "a press a claim already spent",
  );
  assert.deepEqual(await pausedFor({ press: { pressedSecs: -30 } }), unpaused);
});

test("a press never lets a claim through a reading over its threshold", async () => {
  assert.deepEqual(
    await pausedFor({
      readings: [reading("five_hour", 0.9, 600, -90)],
      limit: { observedSecs: -60, resetsSecs: 300 },
      press: { pressedSecs: -30 },
    }),
    { untilSecs: 600, reasons: ["five_hour", "limit"], admittedByPress: false },
  );
});

test("where both windows and a limit hold, the pause lasts until the latest ends and names each", async () => {
  assert.deepEqual(
    await pausedFor({
      readings: [
        reading("five_hour", 0.95, 600, -90),
        reading("seven_day", 0.95, 3000, -90),
      ],
    }),
    {
      untilSecs: 3000,
      reasons: ["five_hour", "seven_day"],
      admittedByPress: false,
    },
  );
  assert.deepEqual(
    await pausedFor({
      readings: [
        reading("five_hour", 0.95, 600, -90),
        reading("seven_day", 0.95, 3000, -90),
      ],
      limit: { observedSecs: -60, resetsSecs: 4000 },
    }),
    {
      untilSecs: 4000,
      reasons: ["five_hour", "limit", "seven_day"],
      admittedByPress: false,
    },
  );
});

test("a changed setting changes the answer, since nothing about a pause is stored", async () => {
  const readings = [reading("five_hour", 0.85)];
  assert.deepEqual(await pausedFor({ readings }), {
    untilSecs: 600,
    reasons: ["five_hour"],
    admittedByPress: false,
  });
  assert.deepEqual(
    await pausedFor({
      readings,
      setting: {
        fiveHourPercent: 90,
        sevenDayPercent: 90,
        pausesThreads: false,
        pausesLead: true,
      },
    }),
    unpaused,
  );
});

test("an account's other agent, an attempt spending no agent and an account no person holds are never paused by it", async () => {
  const state = {
    readings: [reading("five_hour", 1)],
    limit: { observedSecs: -60 },
  };
  assert.deepEqual(await pausedFor(state, "Codex"), unpaused);
  assert.deepEqual(await pausedFor(state, "Claude", () => null), unpaused);
  assert.deepEqual(await pausedFor(state, null), unpaused, "no agent");
});

test("the defaults are the person's settings while they wrote none", async () => {
  const [row] = await harness.query(
    `SELECT * FROM agent_account_settings($1,'Claude')`,
    [`https://issuer.invalid#member-${randomUUID()}`],
  );
  assert.deepEqual(row, {
    five_hour_percent: 80,
    seven_day_percent: 90,
    pauses_threads: false,
    pauses_lead: true,
  });
});
