/**
 * A person's own agent accounts as their routes answer them: what each outcome
 * of the service is sent as, that every route hands the service the caller's
 * own principal and no other, that a threshold outside a whole percentage from
 * 1 to 100 never reaches it, and that an agent no account lends is not found.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { agentAccountsResponseSchema } from "../../src/contract/responses.ts";
import type {
  AgentAccountService,
  AgentAccountView,
} from "../../src/interpreter/agentAccount.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { callerApp } from "./callerAppFixture.ts";

const caller = asPrincipal("issuer-subject");
const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };

const defaults = {
  fiveHourPercent: 80,
  sevenDayPercent: 90,
  pausesThreads: false,
};

const accounts: readonly AgentAccountView[] = [
  {
    agent: "Claude",
    settings: defaults,
    readings: [
      {
        window: "five_hour",
        utilization: 0.82,
        resetsAt: "2026-11-03T15:00:00.000Z",
        observedAt: "2026-11-03T12:00:00.000Z",
      },
    ],
    limit: {
      window: "seven_day",
      observedAt: "2026-11-03T12:01:00.000Z",
    },
    pause: {
      until: "2026-11-03T15:00:00.000Z",
      reasons: ["five_hour", "limit"],
      pressed: false,
    },
  },
  { agent: "Codex", settings: defaults, readings: [] },
];

/** A service answering every caller the same accounts, recording what it was asked and as whom. */
function fakeAccounts(calls: string[]): AgentAccountService {
  return {
    accounts: (principal) => {
      calls.push(`accounts:${principal}`);
      return Promise.resolve(accounts);
    },
    write: (principal, agent, settings) => {
      calls.push(`write:${principal}:${agent}:${JSON.stringify(settings)}`);
      return Promise.resolve();
    },
    press: (principal, agent) => {
      calls.push(`press:${principal}:${agent}`);
      return Promise.resolve(agent === "Claude" ? "Pressed" : "NotHardPaused");
    },
  };
}

function accountsApp(calls: string[]) {
  return callerApp(caller, { agentAccounts: fakeAccounts(calls) });
}

const settings = (agent: string) =>
  nativeHttpRoutes.agentAccountSettings.replace(":agent", agent);
const presses = (agent: string) =>
  nativeHttpRoutes.agentAccountPresses.replace(":agent", agent);

test("the caller reads their own accounts as the response schema has them, and an unauthenticated read is refused", async () => {
  const calls: string[] = [];
  await using app = accountsApp(calls);
  const read = await app.inject({
    url: nativeHttpRoutes.agentAccounts,
    headers: bearer,
  });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(
    agentAccountsResponseSchema.parse(read.json()),
    { accounts },
    "the body is the service's accounts, whole",
  );
  const named = await app.inject({
    url: `${nativeHttpRoutes.agentAccounts}?principal=someone-else`,
    headers: bearer,
  });
  assert.equal(named.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        url: nativeHttpRoutes.agentAccounts,
        headers: { authorization: "Bearer other" },
      })
    ).statusCode,
    401,
  );
  assert.deepEqual(calls, [`accounts:${caller}`, `accounts:${caller}`]);
});

test("the caller writes one agent's settings whole, within whole percentages from 1 to 100", async () => {
  const calls: string[] = [];
  await using app = accountsApp(calls);
  const put = (agent: string, body: unknown) =>
    app.inject({
      method: "PUT",
      url: settings(agent),
      headers: { ...bearer, ...json },
      payload: JSON.stringify(body),
    });
  const edges = {
    fiveHourPercent: 1,
    sevenDayPercent: 100,
    pausesThreads: true,
  };
  assert.equal((await put("Codex", edges)).statusCode, 204);
  for (const refused of [
    { ...edges, fiveHourPercent: 0 },
    { ...edges, sevenDayPercent: 101 },
    { ...edges, fiveHourPercent: 50.5 },
    { ...edges, sevenDayPercent: "90" },
    { fiveHourPercent: 80, sevenDayPercent: 90 },
    { ...edges, principal: "someone-else" },
    { ...edges, pausesLead: false },
  ])
    assert.equal(
      (await put("Claude", refused)).statusCode,
      400,
      JSON.stringify(refused),
    );
  assert.equal((await put("Gemini", edges)).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: settings("Claude"),
        headers: bearer,
        payload: JSON.stringify(edges),
      })
    ).statusCode,
    415,
  );
  assert.deepEqual(calls, [`write:${caller}:Codex:${JSON.stringify(edges)}`]);
});

test("the caller presses their own agent, a press no limit lets through is a conflict, and an agent no account lends is not found", async () => {
  const calls: string[] = [];
  await using app = accountsApp(calls);
  const press = (agent: string, headers: Record<string, string> = bearer) =>
    app.inject({ method: "POST", url: presses(agent), headers });
  assert.equal((await press("Claude")).statusCode, 204);
  assert.equal(
    (await press("Claude", { ...bearer, ...json })).statusCode,
    204,
    "a bodyless press reaches the service however it is framed",
  );
  const refused = await press("Codex");
  assert.equal(refused.statusCode, 409);
  assert.equal(
    refused.json<{ error: { code: string } }>().error.code,
    "NotHardPaused",
  );
  assert.equal((await press("Gemini")).statusCode, 404);
  assert.equal((await press("Claude", {})).statusCode, 401);
  assert.deepEqual(calls, [
    `press:${caller}:Claude`,
    `press:${caller}:Claude`,
    `press:${caller}:Codex`,
  ]);
});

test("no account route names a principal in its path, so no caller can reach another's", () => {
  for (const route of [
    nativeHttpRoutes.agentAccounts,
    nativeHttpRoutes.agentAccountSettings,
    nativeHttpRoutes.agentAccountPresses,
  ])
    assert.deepEqual(
      route.match(/:[a-z]+/gu) ?? [],
      route === nativeHttpRoutes.agentAccounts ? [] : [":agent"],
      route,
    );
});
