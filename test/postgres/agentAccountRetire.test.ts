/**
 * A person retires a credential of their own agent account, against a real
 * server and under the API's role: its readings and its limit go from the
 * read, a name none is held under is not held, a credential a live runner of
 * the account names is refused until that runner stops being live, and another
 * person's credential of the same name is untouched.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresAgentAccounts } from "../../src/adapters/postgres/agentAccount.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { agentAccountRunnerPolledSecsMaxAt171 } from "../../src/adapters/postgres/schema/migrations/171-agent-account-credential-retire.ts";
import type { AgentAccountView } from "../../src/interpreter/agentAccount.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  agentAccountHarnessCommitted,
  type AgentAccountHarnessRunner,
  type AgentAccountHarnessState,
} from "./agentAccountHarness.ts";
import { postgresHarnessOpen, postgresHarnessRolePool } from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await harness.close();
});

const accounts = postgresAgentAccounts(apiPool);

function member(): Principal {
  return asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
}

async function claudeOf(principal: Principal): Promise<AgentAccountView> {
  const found = (await accounts.accounts(principal)).find(
    (account) => account.agent === "Claude",
  );
  assert.ok(found !== undefined);
  return found;
}

/** Each credential of Claude by its name, with each window it holds a reading of. */
async function credentialsOf(
  principal: Principal,
): Promise<readonly (readonly [string, readonly string[]])[]> {
  return (await claudeOf(principal)).credentials.map((credential) => [
    credential.name,
    credential.readings.map((reading) => reading.window),
  ]);
}

/** Readings of `home` and `work`, `work` at its weekly limit too, under any runners `runners` names. */
function kept(
  runners?: readonly AgentAccountHarnessRunner[],
): AgentAccountHarnessState {
  return {
    readings: [
      {
        window: "five_hour",
        utilization: 0.2,
        resetsSecs: 3_600,
        observedSecs: -60,
        credential: "home",
      },
      {
        window: "five_hour",
        utilization: 0.9,
        resetsSecs: 3_600,
        observedSecs: -30,
        credential: "work",
      },
      {
        window: "seven_day",
        utilization: 0.4,
        resetsSecs: 86_400,
        observedSecs: -30,
        credential: "work",
      },
    ],
    limits: [{ observedSecs: -10, resetsSecs: 1_800, credential: "work" }],
    ...(runners === undefined ? {} : { runners }),
  };
}

test("retiring a credential removes it and its readings and its limit from the account's read", async () => {
  const owner = member();
  await agentAccountHarnessCommitted(harness, owner, "Claude", kept());
  const before = await claudeOf(owner);
  assert.deepEqual(before.pause?.reasons, ["five_hour", "limit"]);
  assert.equal(await accounts.retire(owner, "Claude", "work"), "Retired");
  assert.deepEqual(await credentialsOf(owner), [["home", ["five_hour"]]]);
  const after = await claudeOf(owner);
  assert.deepEqual(
    after.readings.map((reading) => [reading.window, reading.utilization]),
    [["five_hour", 0.2]],
    "the account's readings are the newest of those it still keeps",
  );
  assert.equal(after.limit, undefined);
  assert.equal(after.pause, undefined);
  assert.equal(
    await accounts.retire(owner, "Claude", "work"),
    "NotHeld",
    "a credential retired is held no more",
  );
});

test("a name no credential of the agent is held under is not held, and nothing is dropped", async () => {
  const owner = member();
  await agentAccountHarnessCommitted(harness, owner, "Claude", kept());
  assert.equal(await accounts.retire(owner, "Claude", "spare"), "NotHeld");
  assert.equal(
    await accounts.retire(owner, "Codex", "work"),
    "NotHeld",
    "a credential is held of one agent alone",
  );
  assert.deepEqual(await credentialsOf(owner), [
    ["home", ["five_hour"]],
    ["work", ["five_hour", "seven_day"]],
  ]);
});

test("a credential a live runner of the account names is refused, and retired once that runner stops being live", async () => {
  const owner = member();
  for (const kind of ["Personal", "Pool", "ChatHost"] as const) {
    await agentAccountHarnessCommitted(
      harness,
      owner,
      "Claude",
      kept([{ kind, polledSecs: -5, named: { Claude: ["work"] } }]),
    );
    assert.equal(
      await accounts.retire(owner, "Claude", "work"),
      "CredentialInUse",
      kind,
    );
    assert.equal(
      await accounts.retire(owner, "Claude", "home"),
      "Retired",
      `${kind}: a credential no live runner names is retired beside it`,
    );
  }
  assert.deepEqual(await credentialsOf(owner), [
    ["work", ["five_hour", "seven_day"]],
  ]);
  await agentAccountHarnessCommitted(
    harness,
    owner,
    "Claude",
    kept([
      {
        kind: "Personal",
        polledSecs: -(agentAccountRunnerPolledSecsMaxAt171 + 60),
        named: { Claude: ["work"] },
      },
      { kind: "Pool", polledSecs: -5, named: { Codex: ["work"] } },
    ]),
  );
  assert.equal(await accounts.retire(owner, "Claude", "work"), "Retired");
  assert.deepEqual(await credentialsOf(owner), [["home", ["five_hour"]]]);
});

test("retiring a credential leaves another person's credential of the same name untouched", async () => {
  const owner = member();
  const other = member();
  await agentAccountHarnessCommitted(harness, owner, "Claude", kept());
  await agentAccountHarnessCommitted(harness, other, "Claude", kept());
  assert.equal(await accounts.retire(owner, "Claude", "work"), "Retired");
  assert.deepEqual(await credentialsOf(other), [
    ["home", ["five_hour"]],
    ["work", ["five_hour", "seven_day"]],
  ]);
  assert.deepEqual((await claudeOf(other)).pause?.reasons, [
    "five_hour",
    "limit",
  ]);
});
