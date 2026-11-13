/**
 * The rule an account's agent is paused by, asked of `agent_account_pause` at
 * its edges against a real server and under the pool plane's role, which is
 * the role every claim asks it as.
 *
 * EACH CASE PLANTS AND ASKS IN ONE TRANSACTION, so `now()` is one instant
 * across both and an edge stated as an offset from it is the edge asked.
 * Nothing a case plants is kept, but for the one asking the API and the
 * metrics plane too, which commits under an account of its own.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresAgentAccounts } from "../../src/adapters/postgres/agentAccount.ts";
import { postgresMetricsPlaneReads } from "../../src/adapters/postgres/metricsPlane.ts";
import {
  apiRole,
  metricsPlaneRole,
  poolPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { agentAccountRunnerPolledSecsMaxAt170 } from "../../src/adapters/postgres/schema/migrations/170-agent-account-pause-live-credentials.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import {
  agentAccountHarnessCommitted,
  agentAccountHarnessPlanted,
  type AgentAccountHarnessAgent,
  type AgentAccountHarnessReading,
  type AgentAccountHarnessRunner,
  type AgentAccountHarnessState,
} from "./agentAccountHarness.ts";
import { postgresHarnessOpen, postgresHarnessRolePool } from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const metricsPool = postgresHarnessRolePool(metricsPlaneRole);

after(async () => {
  await Promise.all([apiPool.end(), metricsPool.end()]);
  await harness.close();
});

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

test("a limit on one credential still pauses after a reading of another, and stops after a reading of its own", async () => {
  const limit = { observedSecs: -60, resetsSecs: 300, credential: "work" };
  assert.deepEqual(
    await pausedFor({
      limit,
      readings: [
        { ...reading("five_hour", 0.1, 600, -30), credential: "home" },
      ],
    }),
    { untilSecs: 300, reasons: ["limit"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({
      limit,
      readings: [
        { ...reading("five_hour", 0.1, 600, -30), credential: "work" },
      ],
    }),
    unpaused,
  );
});

test("the agent is paused while any of its credentials is, until the latest ends, naming each reason once", async () => {
  assert.deepEqual(
    await pausedFor({
      readings: [
        { ...reading("five_hour", 0.95, 600), credential: "work" },
        { ...reading("five_hour", 0.1, 600), credential: "home" },
      ],
    }),
    { untilSecs: 600, reasons: ["five_hour"], admittedByPress: false },
  );
  assert.deepEqual(
    await pausedFor({
      readings: [
        { ...reading("five_hour", 0.95, 600, -90), credential: "work" },
        { ...reading("five_hour", 0.95, 900, -90), credential: "home" },
      ],
      limits: [
        { observedSecs: -60, resetsSecs: 300, credential: "work" },
        { observedSecs: -60, resetsSecs: 1200, credential: "spare" },
      ],
    }),
    {
      untilSecs: 1200,
      reasons: ["five_hour", "limit"],
      admittedByPress: false,
    },
  );
});

test("a press lets a claim through limits of several credentials only where it came after the newest of them", async () => {
  const limits = [
    { observedSecs: -120, resetsSecs: 300, credential: "work" },
    { observedSecs: -60, resetsSecs: 600, credential: "home" },
  ];
  const held = { untilSecs: 600, reasons: ["limit"] };
  assert.deepEqual(await pausedFor({ limits, press: { pressedSecs: -30 } }), {
    ...held,
    admittedByPress: true,
  });
  assert.deepEqual(
    await pausedFor({ limits, press: { pressedSecs: -90 } }),
    { ...held, admittedByPress: false },
    "a press between the two limits",
  );
  assert.deepEqual(
    await pausedFor({
      limits: [
        ...limits,
        { observedSecs: -10, resetsSecs: 0, credential: "spare" },
      ],
      press: { pressedSecs: -30 },
    }),
    { ...held, admittedByPress: true },
    "a newer limit that no longer holds",
  );
});

test("each paused credential is answered on its own, with when its pause ends and its reasons", async () => {
  const principal = `https://issuer.invalid#member-${randomUUID()}`;
  const transaction = await harness.begin();
  try {
    await agentAccountHarnessPlanted(transaction, principal, "Claude", {
      readings: [
        { ...reading("seven_day", 0.95, 900, -90), credential: "work" },
        { ...reading("five_hour", 0.1, 600, -90), credential: "home" },
      ],
      limits: [
        { observedSecs: -60, resetsSecs: 300, credential: "work" },
        { observedSecs: -60, resetsSecs: 450, credential: "spare" },
      ],
    });
    assert.deepEqual(
      await transaction.query(
        `SELECT credential,extract(epoch FROM paused_until-now())::int AS until_secs,reasons
           FROM agent_account_credential_pause($1,'Claude')`,
        [principal],
      ),
      [
        { credential: "spare", until_secs: 450, reasons: ["limit"] },
        {
          credential: "work",
          until_secs: 900,
          reasons: ["limit", "seven_day"],
        },
      ],
    );
  } finally {
    await transaction.rollback();
  }
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
  });
});

/** A weekly reading of `credential` at `utilization`, resetting `resetsSecs` from now. */
function weekly(
  credential: string,
  utilization: number,
  resetsSecs = 600_000,
): AgentAccountHarnessReading {
  return { ...reading("seven_day", utilization, resetsSecs), credential };
}

/** A runner of `kind` naming `credentials` of Claude, last polling `polledSecs` from now. */
function runner(
  credentials: readonly string[],
  kind: AgentAccountHarnessRunner["kind"] = "Personal",
  polledSecs = -10,
): AgentAccountHarnessRunner {
  return { kind, polledSecs, named: { Claude: credentials } };
}

const runnerKinds: readonly AgentAccountHarnessRunner["kind"][] = [
  "Personal",
  "Pool",
  "ChatHost",
];

test("a runner counts toward its account's pause for as long as its plane reads it live", () => {
  assert.equal(
    agentAccountRunnerPolledSecsMaxAt170,
    sessionRunnerPolledSecsMax,
  );
});

test("a credential no live runner names pauses neither the agent, nor the account the API reads, nor the metrics plane's series", async () => {
  const owner = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  await agentAccountHarnessCommitted(harness, owner, "Claude", {
    readings: [
      weekly("claude", 0.05),
      weekly("max-1", 0.98),
      weekly("max-2", 0.12),
    ],
    runners: [runner(["claude", "max-2"]), runner(["max-2"], "Pool")],
  });
  const [row] = await harness.query(
    "SELECT paused_until,reasons,admitted_by_press FROM agent_account_pause($1,'Claude')",
    [owner],
  );
  assert.deepEqual(row, {
    paused_until: null,
    reasons: [],
    admitted_by_press: false,
  });
  const claude = (await postgresAgentAccounts(apiPool).accounts(owner)).find(
    (account) => account.agent === "Claude",
  );
  assert.equal(claude?.pause, undefined);
  assert.deepEqual(
    claude?.credentials?.map((credential) => [
      credential.name,
      credential.pause?.reasons,
    ]),
    [
      ["claude", undefined],
      ["max-1", ["seven_day"]],
      ["max-2", undefined],
    ],
    "the unnamed credential's own pause is still read",
  );
  const read = await postgresMetricsPlaneReads(metricsPool, 10_000).read({
    seriesMax: 1_000,
    owner: (principal) => principal,
  });
  assert.equal(read.read, "Read");
  assert.deepEqual(
    read.read === "Read"
      ? read.rows.agentPauses.filter((series) => series.owner === owner)
      : [],
    [
      { owner, agent: "Claude", trigger: "hard", paused: 0 },
      { owner, agent: "Claude", trigger: "soft", paused: 0 },
    ],
  );
});

test("where every credential a live runner names is paused, the agent is paused until the earliest of those ends", async () => {
  for (const kind of runnerKinds)
    assert.deepEqual(
      await pausedFor({
        readings: [
          weekly("work", 0.95, 900),
          weekly("home", 0.95, 600),
          weekly("spare", 0.95, 3000),
        ],
        limits: [{ observedSecs: -60, resetsSecs: 1200, credential: "home" }],
        runners: [runner(["work"], kind), runner(["home"])],
      }),
      {
        untilSecs: 900,
        reasons: ["limit", "seven_day"],
        admittedByPress: false,
      },
      kind,
    );
});

test("where no live runner names a credential of the agent, it is paused while any kept credential is", async () => {
  assert.deepEqual(
    await pausedFor({
      readings: [weekly("work", 0.95, 900), weekly("home", 0.1, 600)],
      runners: [
        runner([]),
        { kind: "Pool", polledSecs: -10, named: { Codex: ["home"] } },
        runner(["home"], "ChatHost", -agentAccountRunnerPolledSecsMaxAt170 - 1),
      ],
    }),
    { untilSecs: 900, reasons: ["seven_day"], admittedByPress: false },
  );
});

test("a runner that has stopped polling past its bound no longer counts the credentials it named", async () => {
  const bound = agentAccountRunnerPolledSecsMaxAt170;
  assert.deepEqual(
    await pausedFor({
      readings: [weekly("max-1", 0.98), weekly("max-2", 0.12)],
      runners: [runner(["max-1"], "Personal", -bound - 1), runner(["max-2"])],
    }),
    unpaused,
  );
  for (const kind of runnerKinds) {
    const state = (polledSecs: number): AgentAccountHarnessState => ({
      readings: [weekly("max-1", 0.98, 900), weekly("max-2", 0.12)],
      runners: [runner(["max-2"], kind, polledSecs), runner(["max-1"])],
    });
    assert.deepEqual(await pausedFor(state(1 - bound)), unpaused, kind);
    assert.deepEqual(
      await pausedFor(state(-bound - 1)),
      { untilSecs: 900, reasons: ["seven_day"], admittedByPress: false },
      kind,
    );
  }
});
