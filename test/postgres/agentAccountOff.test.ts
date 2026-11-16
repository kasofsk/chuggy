/**
 * A person turns a credential of their own agent account off and on by name,
 * against a real server and under the API's role: each door's answers, a name
 * with no reading or limit listed among the credentials in order, the bound on
 * off names, a reading at the bound on kept credentials evicting no off name,
 * the read marking a pause off alone, and another person's credential of the
 * same name untouched.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { postgresAgentAccounts } from "../../src/adapters/postgres/agentAccount.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { agentAccountCredentialsKeptMaxAt163 } from "../../src/adapters/postgres/schema/migrations/163-agent-account-credential.ts";
import { agentAccountCredentialsOffMaxAt191 } from "../../src/adapters/postgres/schema/migrations/191-agent-account-credential-off.ts";
import { workerRunnerCredentialsPerAgentMax } from "../../src/contract/workerPool.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import {
  agentAccountHarnessClaude,
  agentAccountHarnessCommitted,
  agentAccountHarnessCredentialsOver,
  agentAccountHarnessMember,
} from "./agentAccountHarness.ts";
import { postgresHarnessOpen, postgresHarnessRolePool } from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await harness.close();
});

const accounts = postgresAgentAccounts(apiPool);

/** Each credential of Claude by its name, with whether its own pause is off alone. */
async function credentialsOf(
  principal: Principal,
): Promise<readonly (readonly [string, boolean])[]> {
  return (await agentAccountHarnessClaude(accounts, principal)).credentials.map(
    (credential) => [credential.name, credential.pause?.off === true],
  );
}

test("the off bound is as many credentials as a runner names of one agent", () => {
  assert.equal(
    agentAccountCredentialsOffMaxAt191,
    workerRunnerCredentialsPerAgentMax,
  );
});

test("turning a credential off answers Off, also when already off, and turning it on answers On, then NotOff", async () => {
  const owner = agentAccountHarnessMember();
  assert.equal(await accounts.turnOn(owner, "Claude", "work"), "NotOff");
  assert.equal(await accounts.turnOff(owner, "Claude", "work"), "Off");
  assert.equal(
    await accounts.turnOff(owner, "Claude", "work"),
    "Off",
    "a credential already off",
  );
  assert.equal(
    await accounts.turnOn(owner, "Codex", "work"),
    "NotOff",
    "a credential is off of one agent alone",
  );
  assert.equal(await accounts.turnOn(owner, "Claude", "work"), "On");
  assert.equal(await accounts.turnOn(owner, "Claude", "work"), "NotOff");
  assert.deepEqual(await credentialsOf(owner), []);
});

test("an off name with no reading or limit is listed among the credentials in order, its pause off alone with no end", async () => {
  const owner = agentAccountHarnessMember();
  await agentAccountHarnessCommitted(
    harness,
    owner,
    "Claude",
    agentAccountHarnessCredentialsOver({ home: 600, zeta: 900 }),
  );
  assert.equal(await accounts.turnOff(owner, "Claude", "spare"), "Off");
  assert.equal(await accounts.turnOff(owner, "Claude", "Alpha"), "Off");
  assert.deepEqual(await credentialsOf(owner), [
    ["Alpha", true],
    ["home", false],
    ["spare", true],
    ["zeta", false],
  ]);
  const spare = (
    await agentAccountHarnessClaude(accounts, owner)
  ).credentials.find((credential) => credential.name === "spare");
  assert.deepEqual(spare?.pause, {
    off: true,
    reasons: ["off"],
    pressed: false,
  });
  assert.deepEqual(spare?.readings, []);
});

test("an agent whose live runners name only off credentials reads a pause off alone, naming them", async () => {
  const owner = agentAccountHarnessMember();
  await agentAccountHarnessCommitted(harness, owner, "Claude", {
    off: ["home", "work"],
    runners: [
      { kind: "Personal", polledSecs: -5, named: { Claude: ["work", "home"] } },
    ],
  });
  assert.deepEqual((await agentAccountHarnessClaude(accounts, owner)).pause, {
    off: true,
    reasons: ["off"],
    pressed: false,
    credentials: ["home", "work"],
  });
  assert.equal(await accounts.turnOn(owner, "Claude", "home"), "On");
  assert.equal(
    (await agentAccountHarnessClaude(accounts, owner)).pause,
    undefined,
  );
});

test("turning off past the bound answers OffFull, and a name already off is still Off", async () => {
  const owner = agentAccountHarnessMember();
  const names = Array.from(
    { length: agentAccountCredentialsOffMaxAt191 },
    (_, index) => `off-${String(index).padStart(2, "0")}`,
  );
  for (const name of names)
    assert.equal(await accounts.turnOff(owner, "Claude", name), "Off");
  assert.equal(await accounts.turnOff(owner, "Claude", "one-more"), "OffFull");
  assert.equal(await accounts.turnOff(owner, "Claude", names[0] ?? ""), "Off");
  assert.equal(
    await accounts.turnOff(owner, "Codex", "one-more"),
    "Off",
    "the bound is per agent",
  );
  assert.equal(await accounts.turnOn(owner, "Claude", names[0] ?? ""), "On");
  assert.equal(await accounts.turnOff(owner, "Claude", "one-more"), "Off");
});

test("a reading at the bound on kept credentials evicts the oldest one's rows and never its off name", async () => {
  const owner = agentAccountHarnessMember();
  const ends = Object.fromEntries(
    Array.from({ length: agentAccountCredentialsKeptMaxAt163 }, (_, index) => [
      `kept-${String(index).padStart(2, "0")}`,
      600 + index,
    ]),
  );
  await agentAccountHarnessCommitted(
    harness,
    owner,
    "Claude",
    agentAccountHarnessCredentialsOver(ends),
  );
  await harness.query(
    "UPDATE agent_account_usage SET observed_at=now()-interval '1 day' WHERE principal=$1 AND credential='kept-00'",
    [owner],
  );
  assert.equal(await accounts.turnOff(owner, "Claude", "kept-00"), "Off");
  assert.equal(await accounts.turnOff(owner, "Claude", "spare"), "Off");
  await harness.query(
    "SELECT agent_account_credential_kept($1,'Claude','arriving')",
    [owner],
  );
  const credentials = (await agentAccountHarnessClaude(accounts, owner))
    .credentials;
  const evicted = credentials.find(
    (credential) => credential.name === "kept-00",
  );
  assert.deepEqual(
    evicted?.readings,
    [],
    "the oldest kept credential's rows go",
  );
  assert.equal(evicted?.pause?.off, true, "and it stays off");
  assert.ok(credentials.some((credential) => credential.name === "spare"));
  assert.equal(
    credentials.length,
    agentAccountCredentialsKeptMaxAt163 + 1,
    "every other kept credential and both off names are read",
  );
});

test("turning a credential off leaves another person's credential of the same name untouched", async () => {
  const owner = agentAccountHarnessMember();
  const other = agentAccountHarnessMember();
  await agentAccountHarnessCommitted(
    harness,
    other,
    "Claude",
    agentAccountHarnessCredentialsOver({ work: 600 }),
  );
  assert.equal(await accounts.turnOff(owner, "Claude", "work"), "Off");
  assert.deepEqual(await credentialsOf(other), [["work", false]]);
  assert.deepEqual(
    (await agentAccountHarnessClaude(accounts, other)).pause?.reasons,
    ["seven_day"],
  );
  assert.equal(await accounts.turnOn(other, "Claude", "work"), "NotOff");
  assert.deepEqual(await credentialsOf(owner), [["work", true]]);
});
