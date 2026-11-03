/**
 * A person's own agent accounts as the API reads and writes them, against a
 * real server and under the API's role: each agent's settings, newest
 * readings, limit and pause, the settings written whole within their bounds,
 * and a press recorded only while a limit holds the agent. Every door is handed
 * one principal and reaches that account alone. The metrics plane's gauge is
 * read here too, under the plane's own role, from the same rule.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresAgentAccounts } from "../../src/adapters/postgres/agentAccount.ts";
import { postgresMetricsPlaneReads } from "../../src/adapters/postgres/metricsPlane.ts";
import {
  apiRole,
  metricsPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import type { AgentAccountView } from "../../src/interpreter/agentAccount.ts";
import type { MetricsPlaneAgentPausedRow } from "../../src/interpreter/metricsPlane.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  agentAccountHarnessCommitted,
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

const accounts = postgresAgentAccounts(apiPool);

function member(): Principal {
  return asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
}

const defaults = {
  fiveHourPercent: 80,
  sevenDayPercent: 90,
  pausesThreads: false,
  pausesLead: true,
};

/** One agent of `principal`'s account as the API reads it. */
async function agentOf(
  principal: Principal,
  agent: AgentAccountView["agent"],
): Promise<AgentAccountView> {
  const found = (await accounts.accounts(principal)).find(
    (account) => account.agent === agent,
  );
  assert.ok(found !== undefined, agent);
  return found;
}

/** Minutes from now to `instant`, rounded. */
function minutesTo(instant: string | undefined): number | undefined {
  return instant === undefined
    ? undefined
    : Math.round((Date.parse(instant) - Date.now()) / 60_000);
}

const softly: AgentAccountHarnessState = {
  readings: [
    {
      window: "five_hour",
      utilization: 0.85,
      resetsSecs: 3_600,
      observedSecs: -120,
    },
    {
      window: "seven_day",
      utilization: 0.4,
      resetsSecs: 86_400,
      observedSecs: -120,
    },
  ],
};

test("an account no reading, limit or setting names reads every agent at the defaults and unpaused", async () => {
  assert.deepEqual(await accounts.accounts(member()), [
    { agent: "Claude", settings: defaults, readings: [] },
    { agent: "Codex", settings: defaults, readings: [] },
  ]);
});

test("each window's newest reading and the limit read with the pause they come to, for their own account alone", async () => {
  const owner = member();
  await agentAccountHarnessCommitted(harness, owner, "Claude", {
    ...softly,
    limit: { observedSecs: -60, resetsSecs: 7_200 },
  });
  const claude = await agentOf(owner, "Claude");
  assert.deepEqual(
    claude.readings.map((reading) => [
      reading.window,
      reading.utilization,
      minutesTo(reading.resetsAt),
      minutesTo(reading.observedAt),
    ]),
    [
      ["five_hour", 0.85, 60, -2],
      ["seven_day", 0.4, 1_440, -2],
    ],
  );
  assert.equal(claude.limit?.window, undefined);
  assert.equal(minutesTo(claude.limit?.resetsAt), 120);
  assert.equal(minutesTo(claude.limit?.observedAt), -1);
  assert.deepEqual(claude.pause?.reasons, ["five_hour", "limit"]);
  assert.equal(minutesTo(claude.pause?.until), 120);
  assert.equal(claude.pause?.pressed, false);
  assert.deepEqual(await agentOf(owner, "Codex"), {
    agent: "Codex",
    settings: defaults,
    readings: [],
  });
  assert.deepEqual(
    await accounts.accounts(member()),
    [
      { agent: "Claude", settings: defaults, readings: [] },
      { agent: "Codex", settings: defaults, readings: [] },
    ],
    "another person reads nothing of this account",
  );
});

test("settings are written whole for one agent, and the pause follows them at the next read", async () => {
  const owner = member();
  await agentAccountHarnessCommitted(harness, owner, "Claude", softly);
  assert.deepEqual((await agentOf(owner, "Claude")).pause?.reasons, [
    "five_hour",
  ]);
  const raised = {
    fiveHourPercent: 90,
    sevenDayPercent: 100,
    pausesThreads: true,
    pausesLead: false,
  };
  await accounts.write(owner, "Claude", raised);
  const claude = await agentOf(owner, "Claude");
  assert.deepEqual(claude.settings, raised);
  assert.equal(claude.pause, undefined);
  assert.deepEqual((await agentOf(owner, "Codex")).settings, defaults);
  await accounts.write(owner, "Claude", {
    ...raised,
    fiveHourPercent: 1,
    sevenDayPercent: 40,
  });
  assert.deepEqual((await agentOf(owner, "Claude")).pause?.reasons, [
    "five_hour",
    "seven_day",
  ]);
  const other = member();
  assert.deepEqual((await agentOf(other, "Claude")).settings, defaults);
});

test("a threshold outside a whole percentage from 1 to 100 is refused by the relation", async () => {
  const owner = member();
  for (const fiveHourPercent of [0, 101])
    await assert.rejects(
      accounts.write(owner, "Codex", { ...defaults, fiveHourPercent }),
    );
  await assert.rejects(
    accounts.write(owner, "Codex", { ...defaults, sevenDayPercent: 0 }),
  );
  assert.deepEqual((await agentOf(owner, "Codex")).settings, defaults);
});

test("a press is recorded only while a limit holds the agent, and lets one claim through it", async () => {
  const owner = member();
  assert.equal(await accounts.press(owner, "Claude"), "NotHardPaused");
  await agentAccountHarnessCommitted(harness, owner, "Claude", softly);
  assert.equal(
    await accounts.press(owner, "Claude"),
    "NotHardPaused",
    "a threshold is no limit to try past",
  );
  const pressed = await harness.query(
    `SELECT 1 FROM agent_account_press WHERE principal=$1`,
    [owner],
  );
  assert.equal(pressed.length, 0, "a refused press writes nothing");
  await agentAccountHarnessCommitted(harness, owner, "Claude", {
    limit: { observedSecs: -60, resetsSecs: 3_600 },
  });
  const other = member();
  assert.equal(await accounts.press(other, "Claude"), "NotHardPaused");
  assert.equal((await agentOf(owner, "Claude")).pause?.pressed, false);
  assert.equal(await accounts.press(owner, "Codex"), "NotHardPaused");
  assert.equal(await accounts.press(owner, "Claude"), "Pressed");
  assert.equal((await agentOf(owner, "Claude")).pause?.pressed, true);
  await harness.query(
    `UPDATE agent_account_press SET spent_at=now() WHERE principal=$1`,
    [owner],
  );
  assert.equal((await agentOf(owner, "Claude")).pause?.pressed, false);
  assert.equal(await accounts.press(owner, "Claude"), "Pressed");
  assert.equal(
    (await agentOf(owner, "Claude")).pause?.pressed,
    true,
    "pressing again after a spent press tries once more",
  );
});

test("the metrics plane reads whether each account's agent is paused by a threshold, a limit or neither", async () => {
  const soft = member();
  const hard = member();
  const neither = member();
  await agentAccountHarnessCommitted(harness, soft, "Claude", softly);
  await agentAccountHarnessCommitted(harness, hard, "Codex", {
    limit: { observedSecs: -60, resetsSecs: 3_600 },
  });
  await agentAccountHarnessCommitted(harness, neither, "Claude", {
    readings: [
      {
        window: "five_hour",
        utilization: 0.1,
        resetsSecs: 3_600,
        observedSecs: -60,
      },
    ],
  });
  const read = await postgresMetricsPlaneReads(metricsPool, 10_000).read({
    seriesMax: 1_000,
    owner: (principal) => principal,
  });
  assert.equal(read.read, "Read");
  const of = (owner: Principal): readonly MetricsPlaneAgentPausedRow[] =>
    read.read === "Read"
      ? read.rows.agentPauses.filter((row) => row.owner === owner)
      : [];
  assert.deepEqual(of(soft), [
    { owner: soft, agent: "Claude", trigger: "hard", paused: 0 },
    { owner: soft, agent: "Claude", trigger: "soft", paused: 1 },
  ]);
  assert.deepEqual(of(hard), [
    { owner: hard, agent: "Codex", trigger: "hard", paused: 1 },
    { owner: hard, agent: "Codex", trigger: "soft", paused: 0 },
  ]);
  assert.deepEqual(of(neither), [
    { owner: neither, agent: "Claude", trigger: "hard", paused: 0 },
    { owner: neither, agent: "Claude", trigger: "soft", paused: 0 },
  ]);
  const capped = await postgresMetricsPlaneReads(metricsPool, 10_000).read({
    seriesMax: 1,
    owner: (principal) => principal,
  });
  assert.equal(capped.read, "Refused");
});
