import assert from "node:assert/strict";
import test from "node:test";

import {
  leadRoster,
  threadRoster,
} from "../../test/contract/sessionRosterFixture.ts";
import { chuggyToolPrefix, sessionBuiltInTools } from "./chuggyTools.mjs";
import {
  checkedSessionBounds,
  sessionBoundNames,
  sessionTurnFailure,
  sessionTurnResultCharsMax,
} from "./session.mjs";
import { observeRateLimit, rateLimitSightings } from "./rateLimit.mjs";
import {
  bearer,
  credentialFile,
  environment,
  facts,
  planeOf,
  queryOf,
  rejection,
  result,
  run,
  task,
  token,
  turnOne,
} from "../../test/contract/sessionHarness.mjs";

/** The sightings a turn that saw exactly these frames, in this order, ends with. */
function seenBy(...events) {
  return events.reduce(observeRateLimit, rateLimitSightings());
}

test("a mirror_error after the result fails the turn and never answers it", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    { type: "assistant", message: { role: "assistant" } },
    result("success", { result: "ok" }),
    { type: "system", subtype: "mirror_error", error: "gave up on batch 3" },
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 1);
  const failure = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/failure",
  );
  assert.ok(failure !== undefined, "the late mirror_error failed no turn");
  assert.deepEqual(failure.body, { turn: "turn-1", failure: "StoreRefused" });
  assert.ok(
    !plane.calls.some(({ path }) => path === "/v1/session/turn/answer"),
    "a turn whose transcript has a hole was answered",
  );
  assert.equal(
    plane.calls.filter(({ path }) => path === "/v1/session/turn").length,
    1,
    "the session took another turn over a hole",
  );
});

test("a successful turn is answered with its result text and the batches it wrote", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf((_asked, _index, options) => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    () =>
      options.sessionStore.append({ sessionId: "runtime-1" }, [
        { uuid: "a", type: "assistant" },
      ]),
    result("success", { result: "kestrel" }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  const answer = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/answer",
  );
  assert.deepEqual(answer.body, {
    turn: "turn-1",
    result: "kestrel",
    batchFirst: 1,
    batchLast: 1,
  });
  assert.ok(
    plane.calls.some(({ path }) => path === "/v1/session/store/runtime-1/1"),
    "the runtime's append never reached the plane",
  );
});

test("a result the runtime could not finish is the failure that names why", async () => {
  const cases = [
    [result("error_max_budget_usd"), "AgentBudgetExhausted"],
    [result("error_max_turns"), "AgentTurnsExhausted"],
    [result("error_during_execution"), "AgentFailed"],
  ];
  for (const [ended, failure] of cases) {
    const plane = planeOf([turnOne], facts);
    const { query } = queryOf(() => [ended]);

    const code = await run({ request: plane.request, query });

    assert.equal(code, 0, failure);
    assert.deepEqual(
      plane.calls.find(({ path }) => path === "/v1/session/turn/failure").body,
      { turn: "turn-1", failure },
    );
  }
});

test("a mailbox that stays empty for the idle bound ends the session cleanly", async () => {
  const plane = planeOf([], facts);
  const { query } = queryOf(() => []);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  assert.ok(
    !plane.calls.some(({ path }) => path.startsWith("/v1/session/turn/")),
    "an idle session settled a turn it never claimed",
  );
});

test("the query is opened eagerly against the store, with the session's own bounds", async () => {
  const plane = planeOf([], facts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  const { options } = seen;
  assert.equal(options.sessionStoreFlush, "eager");
  assert.ok(
    !("persistSession" in options),
    "persistSession was set beside a store",
  );
  assert.equal(typeof options.sessionStore.append, "function");
  assert.equal(typeof options.sessionStore.listSubkeys, "function");
  assert.equal(options.permissionMode, "bypassPermissions");
  assert.equal(options.maxTurns, task.bounds.turnsMax);
  assert.equal(options.maxBudgetUsd, task.bounds.budgetUsd);
  assert.equal(options.loadTimeoutMs, task.bounds.loadTimeoutMs);
  assert.equal(options.cwd, "/workspace");
  assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, token);
  assert.equal(options.env.CLAUDE_CONFIG_DIR, "/workspace/.claude");
  assert.deepEqual(options.allowedTools, ["Bash", "Glob", "Grep", "Read"]);
  assert.ok(options.disallowedTools.includes("Write"));
  assert.ok(!("resume" in options), "a session that never ran was resumed");
  assert.ok(!("forkSession" in options), "a lead was forked");
});

test("a session that has run before is resumed, and only an inquiry is forked", async () => {
  for (const [kind, forked] of [
    ["Lead", false],
    ["Thread", false],
    ["Inquiry", true],
  ]) {
    const plane = planeOf([], { ...facts, kind, agentReference: "runtime-1" });
    const { seen, query } = queryOf(() => []);

    await run({ request: plane.request, query });

    assert.equal(seen.options.resume, "runtime-1", kind);
    assert.equal(seen.options.forkSession, forked ? true : undefined, kind);
  }
});

test("the runtime's session id is bound once, however many times it says so", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    result("success", { result: "ok" }),
  ]);

  await run({ request: plane.request, query });

  const bound = plane.calls.filter(
    ({ path }) => path === "/v1/session/reference",
  );
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].body, { reference: "runtime-1" });
});

test("the answer a turn carries is scrubbed of what the pod was handed", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    result("success", { result: `the token is ${token} and ${bearer}` }),
  ]);

  await run({ request: plane.request, query });

  const answered = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/answer",
  ).body.result;
  assert.ok(!answered.includes(token));
  assert.ok(!answered.includes(bearer));
  assert.ok(answered.includes("[redacted credential]"));
});

test("a failure carries nothing of the credential into the pod's own stderr", async () => {
  const warned = [];
  const plane = planeOf([], facts);

  const code = await run({
    request: async (_task, _bearer, path, init) => {
      if (path === "/v1/session/turn")
        throw new Error(`the plane refused ${bearer}`);
      return plane.request(_task, _bearer, path, init);
    },
    query: queryOf(() => []).query,
    warn: (text) => warned.push(text),
  });

  assert.equal(code, 1);
  assert.ok(warned.some((text) => text.includes("[redacted credential]")));
  assert.ok(!warned.some((text) => text.includes(bearer)));
});

test("every result subtype maps to one failure, and success maps to none", () => {
  assert.equal(sessionTurnFailure({ subtype: "success" }), undefined);
  assert.equal(
    sessionTurnFailure({ subtype: "error_max_budget_usd" }),
    "AgentBudgetExhausted",
  );
  assert.equal(
    sessionTurnFailure({ subtype: "error_max_turns" }),
    "AgentTurnsExhausted",
  );
  assert.equal(sessionTurnFailure(undefined), "AgentFailed");
});

test("a turn is rate limited by the frames the runtime declares, not by its subtype", () => {
  assert.equal(
    sessionTurnFailure(
      { subtype: "error_during_execution" },
      seenBy(rejection),
    ),
    "AgentRateLimited",
  );
  assert.equal(
    sessionTurnFailure(
      { subtype: "error_during_execution", terminal_reason: "api_error" },
      rateLimitSightings(),
    ),
    "AgentFailed",
  );
  assert.equal(
    sessionTurnFailure({ subtype: "success", result: "ok" }, seenBy(rejection)),
    "AgentRateLimited",
  );
});

test("a rate-limited turn is held, never failed, and the pod gives up its attempt", async () => {
  const plane = planeOf([turnOne, turnOne], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    rejection,
    result("error_during_execution", { terminal_reason: "api_error" }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0, "a hold is not the pod failing");
  const held = plane.calls.filter(({ path }) => path === "/v1/session/held");
  assert.equal(held.length, 1);
  assert.deepEqual(held[0].body, {});
  assert.ok(
    !plane.calls.some(({ path }) => path === "/v1/session/turn/failure"),
    "a held turn was charged as a failure",
  );
  assert.ok(
    !plane.calls.some(({ path }) => path === "/v1/session/turn/answer"),
    "a held turn was answered",
  );
  assert.equal(
    plane.calls.filter(({ path }) => path === "/v1/session/turn").length,
    1,
    "the pod claimed another turn while its account was refused",
  );
});

test("a mirror_error before the result fails the turn just as a late one does", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    { type: "system", subtype: "mirror_error", error: "gave up on batch 3" },
    { type: "assistant", message: { role: "assistant" } },
    result("success", { result: "ok" }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 1);
  const failure = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/failure",
  );
  assert.ok(failure !== undefined, "the early mirror_error failed no turn");
  assert.deepEqual(failure.body, { turn: "turn-1", failure: "StoreRefused" });
  assert.ok(
    !plane.calls.some(({ path }) => path === "/v1/session/turn/answer"),
    "a turn whose transcript has a hole was answered",
  );
});

test("a bound the launcher did not give is refused by name, with no default invented", async () => {
  for (const name of sessionBoundNames) {
    const rest = Object.fromEntries(
      Object.entries(task.bounds).filter(([held]) => held !== name),
    );
    const warned = [];

    const code = await run({
      environment: {
        ...environment,
        CHUG_SESSION_TASK: JSON.stringify({ ...task, bounds: rest }),
      },
      request: planeOf([], facts).request,
      query: queryOf(() => []).query,
      warn: (text) => warned.push(text),
    });

    assert.equal(code, 1, name);
    assert.ok(
      warned.join("").includes(name),
      `${name} was not named: ${warned.join("")}`,
    );
  }
});

test("a bound that is not a positive whole number is refused too", () => {
  const bounds = task.bounds;
  assert.throws(
    () => checkedSessionBounds({ ...bounds, idleMs: 0 }),
    /idleMs/u,
  );
  assert.throws(
    () => checkedSessionBounds({ ...bounds, idleMs: -1 }),
    /idleMs/u,
  );
  assert.throws(
    () => checkedSessionBounds({ ...bounds, turnsMax: 1.5 }),
    /turnsMax/u,
  );
  assert.ok(
    sessionBoundNames.includes("budgetUsd"),
    "the roster omits a bound the check enforces",
  );
  assert.throws(
    () => checkedSessionBounds({ ...bounds, budgetUsd: 0 }),
    /budgetUsd/u,
  );
  assert.deepEqual(checkedSessionBounds({ ...bounds, budgetUsd: 0.5 }), {
    ...bounds,
    budgetUsd: 0.5,
  });
});

test("a credential that straddles the result's truncation is scrubbed whole", async () => {
  const plane = planeOf([turnOne], facts);
  const straddled = `${"x".repeat(sessionTurnResultCharsMax - 10)}${token}`;
  const { query } = queryOf(() => [result("success", { result: straddled })]);

  await run({ request: plane.request, query });

  const answered = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/answer",
  ).body.result;
  assert.ok(answered.length <= sessionTurnResultCharsMax);
  assert.ok(
    !answered.includes(token.slice(0, 10)),
    "the truncation cut a credential in half and posted the head",
  );
});

test("a reference bind the plane did not accept ends the session rather than running on", async () => {
  for (const status of [400, 413, 401]) {
    const plane = planeOf([turnOne], facts, (path) =>
      path === "/v1/session/reference" ? status : undefined,
    );
    const { query } = queryOf(() => [
      { type: "system", subtype: "init", session_id: "runtime-1" },
      result("success", { result: "ok" }),
    ]);

    const code = await run({ request: plane.request, query });

    assert.equal(code, 1, `status ${String(status)} was treated as bound`);
    assert.ok(
      !plane.calls.some(({ path }) => path === "/v1/session/turn/answer"),
      `status ${String(status)} answered a turn the plane cannot resume`,
    );
  }
});

const leadFacts = {
  ...facts,
  capabilities: [...leadRoster],
  systemPrompt: "# What this project wants\n\nShip the lead.",
};

const observation = JSON.stringify({
  version: 1,
  decision: "decision-1",
  partition: { tenant: "vteng", project: "chuggy" },
  changes: [],
  candidates: [{ ticket: 4, ticketVersion: 2 }],
  token: {},
  operationalContext: {},
  handoffNote: { carried: "note" },
  refusals: [],
});

const observationTurn = {
  turn: "turn-1",
  ordinal: 1,
  inputKind: "Observation",
  input: observation,
};

test("the one chuggy server is served in-process, with the tools the roster admits", async () => {
  const plane = planeOf([], leadFacts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  const server = seen.options.mcpServers.chuggy;
  assert.equal(server.name, "chuggy");
  assert.equal(server.timeout, 30_000);
  const names = server.tools.map(({ name }) => `${chuggyToolPrefix}${name}`);
  assert.deepEqual(
    names.filter((name) => !seen.options.allowedTools.includes(name)),
    [],
    "a tool was registered that the allowlist does not name",
  );
  assert.equal(
    names.length,
    seen.options.allowedTools.filter((name) =>
      name.startsWith(chuggyToolPrefix),
    ).length,
  );
  for (const name of names)
    assert.ok(
      name.length <= 128,
      `${name} is longer than a measured turn's tool name holds`,
    );
});

test("a session with no ProjectRead registers no read and disallows every one by name", async () => {
  const plane = planeOf([], { ...leadFacts, capabilities: ["LeadDecision"] });
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  const registered = seen.options.mcpServers.chuggy.tools.map(
    ({ name }) => name,
  );
  assert.deepEqual(registered, [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
  const disallowed = seen.options.disallowedTools;
  assert.ok(disallowed.includes(`${chuggyToolPrefix}read_ticket`));
  assert.ok(disallowed.includes(`${chuggyToolPrefix}release_draft`));
  for (const tool of sessionBuiltInTools)
    assert.ok(disallowed.includes(tool), `${tool} was left ungoverned`);
});

test("the session's objectives ride on the preset prompt, recorded for the conversation", async () => {
  const plane = planeOf([], leadFacts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  assert.deepEqual(seen.options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    snapshot: true,
    append: leadFacts.systemPrompt,
  });
  assert.deepEqual(seen.options.settingSources, ["project"]);
});

test("a session row that carries no objectives still takes its turn", async () => {
  for (const systemPrompt of [undefined, ""]) {
    const plane = planeOf([], { ...leadFacts, systemPrompt });
    const { seen, query } = queryOf(() => []);

    const code = await run({ request: plane.request, query });

    assert.equal(code, 0);
    assert.deepEqual(seen.options.systemPrompt, {
      type: "preset",
      preset: "claude_code",
      snapshot: true,
    });
  }
});

test("an observation answered with decision tools posts the document they composed", async () => {
  const plane = planeOf([observationTurn], leadFacts);
  const { query } = queryOf((_asked, _index, options) => [
    async () => {
      const tools = options.mcpServers.chuggy.tools;
      const staged = (name, args) =>
        tools.find((tool) => tool.name === name).handler(args);
      await staged("dispatch", { ticket: 4, expectedTicketVersion: 2 });
      await staged("set_attention", { attention: "Attention" });
    },
    result("success", { result: "I dispatched ticket 4." }),
  ]);

  await run({ request: plane.request, query });

  const answered = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/answer",
  ).body;
  assert.deepEqual(JSON.parse(answered.result), {
    version: 1,
    dispatches: [{ ticket: 4, expectedTicketVersion: 2 }],
    refusals: [],
    lifts: [],
    attention: "Attention",
    handoffNote: { carried: "note" },
  });
});

test("an observation that called no decision tool still answers in the model's own text", async () => {
  const plane = planeOf([observationTurn], leadFacts);
  const { query } = queryOf(() => [
    result("success", { result: '{"version":1,"attention":"Monitoring"}' }),
  ]);

  await run({ request: plane.request, query });

  assert.equal(
    plane.calls.find(({ path }) => path === "/v1/session/turn/answer").body
      .result,
    '{"version":1,"attention":"Monitoring"}',
  );
});

/**
 * The kinds answered to a reader rather than to the selector. The roster here
 * is a lead's, because a thread holds no decision tool at all and a turn that
 * staged nothing would prove only that `document()` is empty: what is under
 * test is that the branch is the INPUT KIND and not whether anything was
 * staged, and only a staged turn can tell those two apart.
 */
test("a turn that is not an observation is answered in text however many decision tools it called", async () => {
  for (const inputKind of ["UserMessage", "Wake"]) {
    const plane = planeOf([{ ...observationTurn, inputKind }], leadFacts);
    const { query } = queryOf((_asked, _index, options) => [
      async () => {
        const tools = options.mcpServers.chuggy.tools;
        await tools
          .find((tool) => tool.name === "set_attention")
          .handler({ attention: "Stopped" });
        await tools
          .find((tool) => tool.name === "dispatch")
          .handler({ ticket: 4, expectedTicketVersion: 2 });
      },
      result("success", { result: "here is the plan" }),
    ]);

    await run({ request: plane.request, query });

    assert.equal(
      plane.calls.find(({ path }) => path === "/v1/session/turn/answer").body
        .result,
      "here is the plan",
      inputKind,
    );
  }
});

test("one turn's staging never reaches the next turn's answer", async () => {
  const plane = planeOf(
    [observationTurn, { ...observationTurn, turn: "turn-2" }],
    leadFacts,
  );
  const { query } = queryOf((_asked, index, options) => [
    async () => {
      if (index > 0) return;
      const tools = options.mcpServers.chuggy.tools;
      await tools
        .find((tool) => tool.name === "dispatch")
        .handler({ ticket: 4, expectedTicketVersion: 2 });
    },
    result("success", { result: "done" }),
  ]);

  await run({ request: plane.request, query });

  const answers = plane.calls.filter(
    ({ path }) => path === "/v1/session/turn/answer",
  );
  assert.equal(answers.length, 2);
  assert.deepEqual(JSON.parse(answers[0].body.result).dispatches, [
    { ticket: 4, expectedTicketVersion: 2 },
  ]);
  assert.equal(answers[1].body.result, "done");
});

/**
 * The two arms this branch and the decision tools each added meet here, and the
 * order they meet in is the property: a turn whose account was refused is a turn
 * the session never got, so the choices its tools staged are not an answer to
 * post. The result below is a *success* carrying text, which is what makes the
 * ordering load-bearing rather than incidental.
 */
test("a held turn posts no answer, so the decision its tools staged is never settled", async () => {
  const plane = planeOf([observationTurn], leadFacts);
  const { query } = queryOf((_asked, _index, options) => [
    async () => {
      const tools = options.mcpServers.chuggy.tools;
      await tools
        .find((tool) => tool.name === "dispatch")
        .handler({ ticket: 4, expectedTicketVersion: 2 });
    },
    rejection,
    result("success", { result: "I dispatched ticket 4." }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  assert.deepEqual(
    plane.calls.filter(({ path }) => path === "/v1/session/held").length,
    1,
  );
  assert.deepEqual(
    plane.calls.filter(({ path }) => path.startsWith("/v1/session/turn/")),
    [],
    "a held turn was settled",
  );
});

test("a composed decision is scrubbed of what the pod was handed, exactly as prose is", async () => {
  const plane = planeOf([observationTurn], leadFacts);
  const { query } = queryOf((_asked, _index, options) => [
    async () => {
      const tools = options.mcpServers.chuggy.tools;
      const staged = (name, args) =>
        tools.find((tool) => tool.name === name).handler(args);
      await staged("refuse", {
        ticket: 4,
        ticketVersion: 2,
        reason: `the run logged ${token} and ${bearer}`,
      });
      await staged("set_handoff_note", { note: { seen: bearer } });
    },
    result("success", { result: "refused" }),
  ]);

  await run({ request: plane.request, query });

  const answered = plane.calls.find(
    ({ path }) => path === "/v1/session/turn/answer",
  ).body.result;
  assert.ok(!answered.includes(token), "the credential reached the mailbox");
  assert.ok(!answered.includes(bearer), "the bearer reached the mailbox");
  assert.ok(answered.includes("[redacted credential]"));
  assert.equal(
    JSON.parse(answered).refusals.length,
    1,
    "the scrub broke the document",
  );
});

test("a project tool reaches the API under the session's own bearer", async () => {
  const plane = planeOf([observationTurn], leadFacts);
  const seenApi = [];
  const { query } = queryOf((_asked, _index, options) => [
    async () => {
      await options.mcpServers.chuggy.tools
        .find((tool) => tool.name === "read_ticket")
        .handler({ ticket: 4 });
    },
    result("success", { result: "read" }),
  ]);

  await run({
    request: plane.request,
    query,
    chuggyRequest: async (_task, apiBearer, path, init) => {
      seenApi.push({ apiBearer, path, init });
      return { status: 200, text: async () => "{}" };
    },
  });

  assert.deepEqual(
    seenApi.map(({ path }) => path),
    ["/api/v1/tenants/vteng/projects/chuggy/tickets/4"],
  );
  assert.equal(seenApi[0].apiBearer, bearer);
});

/**
 * A member's thread as the plane hands one over, under the roster the fixture
 * carries: `test/contract/imageTools.test.mjs` asserts that copy is
 * `threadCapabilitiesDefault`, so a thread suite cannot stay green against a
 * roster the tree no longer opens a thread with.
 */
const threadFacts = {
  ...facts,
  kind: "Thread",
  capabilities: [...threadRoster],
  systemPrompt:
    "# Whose thread this is\n\nYou are geoff's thread on vteng/chuggy.",
};

const threadMessageTurn = {
  turn: "turn-1",
  ordinal: 1,
  inputKind: "UserMessage",
  input: "file me a draft for the footer",
};

test("a thread is served origination and the thread reads, and no decision tool", async () => {
  const plane = planeOf([], threadFacts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  const registered = seen.options.mcpServers.chuggy.tools.map(
    ({ name }) => name,
  );
  for (const tool of [
    "create_draft",
    "list_threads",
    "read_thread",
    "read_thread_transcript",
  ]) {
    assert.ok(registered.includes(tool), `${tool} was not served`);
    assert.ok(
      seen.options.allowedTools.includes(`${chuggyToolPrefix}${tool}`),
      `${tool} was served and not allowed`,
    );
  }
  for (const tool of [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]) {
    assert.ok(!registered.includes(tool), `${tool} was served to a thread`);
    assert.ok(
      seen.options.disallowedTools.includes(`${chuggyToolPrefix}${tool}`),
      `${tool} was left ungoverned for a thread`,
    );
  }
  assert.equal(
    seen.options.forkSession,
    undefined,
    "a thread was forked from its own session",
  );
});

test("a lead is served no origination, and it is disallowed by name", async () => {
  const plane = planeOf([], leadFacts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  const registered = seen.options.mcpServers.chuggy.tools.map(
    ({ name }) => name,
  );
  assert.ok(
    !registered.includes("create_draft"),
    "a lead was served the tool that files from nothing",
  );
  assert.ok(
    seen.options.disallowedTools.includes(`${chuggyToolPrefix}create_draft`),
    "a lead was left ungoverned for origination",
  );
});

test("a thread's own objectives ride on the preset prompt, recorded for the conversation", async () => {
  const plane = planeOf([], threadFacts);
  const { seen, query } = queryOf(() => []);

  await run({ request: plane.request, query });

  assert.deepEqual(seen.options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    snapshot: true,
    append: threadFacts.systemPrompt,
  });
});

test("a thread originates through the API under its own session bearer, and answers in text", async () => {
  const plane = planeOf([threadMessageTurn], threadFacts);
  const seenApi = [];
  const { query } = queryOf((_asked, _index, options) => [
    async () => {
      await options.mcpServers.chuggy.tools
        .find((tool) => tool.name === "create_draft")
        .handler({
          configurationRevision: "r1",
          configurationDigest: "d1",
          expectedProjectSequence: 12,
          authoring: { dependencies: [] },
          brief: { title: "the footer" },
        });
    },
    result("success", { result: "filed ticket 14" }),
  ]);

  await run({
    request: plane.request,
    query,
    chuggyRequest: async (_task, apiBearer, path, init) => {
      seenApi.push({ apiBearer, path, method: init?.method });
      return { status: 201, text: async () => "{}" };
    },
  });

  assert.deepEqual(seenApi, [
    {
      apiBearer: bearer,
      path: "/api/v1/tenants/vteng/projects/chuggy/drafts",
      method: "POST",
    },
  ]);
  assert.equal(
    plane.calls.find(({ path }) => path === "/v1/session/turn/answer").body
      .result,
    "filed ticket 14",
  );
});

test("a session with a checkout runs in it, and one without runs in the bare workspace", async () => {
  for (const [checkout, cwd] of [
    [undefined, "/workspace"],
    [
      { directory: "/workspace/repository", commit: "a".repeat(40) },
      "/workspace/repository",
    ],
  ]) {
    const plane = planeOf([], facts);
    const { seen, query } = queryOf(() => []);

    await run({
      request: plane.request,
      query,
      checkout: async () => checkout,
    });

    assert.equal(seen.options.cwd, cwd);
    assert.equal(
      seen.options.env.CLAUDE_CONFIG_DIR,
      "/workspace/.claude",
      "the runtime's local mirror moved into the git working tree",
    );
    assert.deepEqual(seen.options.settingSources, ["project"]);
  }
});

test("the checkout is asked for what the placement bound, under the session's own workspace", async () => {
  const plane = planeOf([], facts);
  const { query } = queryOf(() => []);
  const asked = [];

  await run({
    request: plane.request,
    query,
    environment: {
      ...environment,
      CHUG_SESSION_TASK: JSON.stringify({
        ...task,
        repository: { reference: "chuggy" },
      }),
      CHUG_WORKER_REPOSITORIES: JSON.stringify({ chuggy: { url: "git://x" } }),
    },
    checkout: async (
      checkoutTask,
      repositories,
      credentialFiles,
      workspace,
    ) => {
      asked.push({ checkoutTask, repositories, credentialFiles, workspace });
      return undefined;
    },
  });

  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].checkoutTask.repository, { reference: "chuggy" });
  assert.deepEqual(asked[0].repositories, { chuggy: { url: "git://x" } });
  assert.deepEqual(asked[0].credentialFiles, { "claude-code": credentialFile });
  assert.equal(asked[0].workspace, "/workspace");
});

test("a site that names no repository map still runs the sessions that bind none", async () => {
  const plane = planeOf([], facts);
  const { query } = queryOf(() => []);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
});

/**
 * The runtime derives `projectKey` from the sanitised `cwd`, so moving `cwd` to
 * a checkout is the one change in this unit that could rename every stream a
 * session has ever written — and a renamed stream is a resumed lead that finds
 * no transcript. Both runs write through the real store adapter, so what is
 * compared is the path the plane was asked for.
 */
test("moving cwd to the checkout does not move the store stream a resumed session reads", async () => {
  const written = [];
  for (const checkout of [
    undefined,
    { directory: "/workspace/repository", commit: "b".repeat(40) },
  ]) {
    const plane = planeOf([turnOne], facts);
    const { query } = queryOf((_asked, _index, options) => [
      { type: "system", subtype: "init", session_id: "runtime-1" },
      () =>
        options.sessionStore.append(
          {
            projectKey: options.cwd.replaceAll("/", "-"),
            sessionId: "runtime-1",
          },
          [{ uuid: "a", type: "assistant" }],
        ),
      result("success", { result: "ok" }),
    ]);

    await run({
      request: plane.request,
      query,
      checkout: async () => checkout,
    });

    written.push(
      plane.calls
        .filter(({ path }) => path.startsWith("/v1/session/store/"))
        .map(({ path }) => path),
    );
  }

  assert.deepEqual(written[0], ["/v1/session/store/runtime-1/1"]);
  assert.deepEqual(written[1], written[0]);
});

/**
 * The clone is the longest thing the pod does before its first turn, and the
 * attempt's lease is already running down when the pod starts — so the lease is
 * kept before the clone is asked for, and a clone slower than what is left of
 * the lease is not reaped mid-clone. What this holds is that order; that a
 * kept lease reaches the plane is `lease.mjs`'s own.
 */
test("the lease is kept before the clone is asked for", async () => {
  const plane = planeOf([], facts);
  const { query } = queryOf(() => []);
  const order = [];

  await run({
    request: plane.request,
    query,
    lease: () => {
      order.push("lease");
      return async () => undefined;
    },
    checkout: async () => {
      order.push("checkout");
      return undefined;
    },
  });

  assert.deepEqual(order, ["lease", "checkout"]);
});

/**
 * The scrub the checkout is handed must be the one built from this pod's
 * secrets, not the identity function `sessionMain` starts with. Asserting it at
 * the parameter would pass with either, so it is asserted at the wiring: what
 * the checkout was actually given, redacting what a failed clone could print.
 */
test("the checkout is handed the scrub built from this pod's own secrets", async () => {
  const plane = planeOf([], facts);
  const { query } = queryOf(() => []);
  let handed;

  await run({
    request: plane.request,
    query,
    checkout: async (_task, _repositories, _files, _workspace, logging) => {
      handed = logging.scrub;
      return undefined;
    },
  });

  const printed = handed(`git failed: token ${token} bearer ${bearer}`);
  assert.ok(!printed.includes(token), "a failed clone would print the token");
  assert.ok(!printed.includes(bearer), "a failed clone would print the bearer");
});
