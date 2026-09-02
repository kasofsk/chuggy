import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  leadRoster,
  threadRoster,
} from "../../test/contract/sessionRosterFixture.ts";
import { chuggyToolPrefix, sessionBuiltInTools } from "./chuggyTools.mjs";
import {
  checkedSessionBounds,
  sessionBoundNames,
  sessionMain,
  sessionMeasure,
  sessionTurnFailure,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./session.mjs";
import { observeRateLimit, rateLimitSightings } from "./rateLimit.mjs";

/** The sightings a turn that saw exactly these frames, in this order, ends with. */
function seenBy(...events) {
  return events.reduce(observeRateLimit, rateLimitSightings());
}

/** The rejection frame kasofsk/chuggy#386 reports, as the runtime declares it. */
const rejection = {
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
};

const bearerFile = "/var/run/chuggy/session-capability/bearer";
const credentialFile = "/var/run/chuggy/credentials/claude-code";
const bearer = "chgs_0123456789abcdef0123456789abcdef";
const token = "sk-ant-oat01-0123456789abcdefghijklmnop";

const task = {
  tenant: "vteng",
  project: "chuggy",
  session: "session-1",
  kind: "Lead",
  attempt: "attempt-1",
  generation: 1,
  workerPlane: {
    url: "http://worker-plane.test:3001",
    capabilityFile: bearerFile,
  },
  api: { url: "http://chuggy-api.test:3000" },
  bounds: {
    mailboxPollMs: 1,
    idleMs: 1,
    resultDrainMs: 50,
    loadTimeoutMs: 1_000,
    turnsMax: 200,
    budgetUsd: 5,
  },
};

const environment = {
  CHUG_SESSION_TASK: JSON.stringify(task),
  CHUG_WORKER_CREDENTIAL_FILES: JSON.stringify({
    "claude-code": credentialFile,
  }),
  CHUG_WORKER_WORKSPACE: "/workspace",
};

function planeOf(turns, facts, refuse = () => undefined) {
  const calls = [];
  let claims = 0;
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
      const refused = refuse(path);
      if (refused !== undefined) {
        calls.push({ path, method: init?.method });
        return { status: refused, json: async () => ({}) };
      }
      const type = init?.headers?.["content-type"];
      calls.push({
        path,
        method: init?.method,
        body: type === "application/json" ? JSON.parse(init.body) : init?.body,
      });
      if (path === "/v1/session")
        return { status: 200, json: async () => facts };
      if (path === "/v1/session/turn") {
        const turn = turns[claims];
        claims += 1;
        return turn === undefined
          ? { status: 204 }
          : { status: 200, json: async () => turn };
      }
      return { status: 204 };
    },
  };
}

function queryOf(script) {
  const seen = {};
  return {
    seen,
    query: ({ prompt, options }) => {
      seen.options = options;
      return (async function* messages() {
        let index = 0;
        for await (const asked of prompt) {
          for (const message of script(asked, index, options)) {
            if (typeof message === "function") await message();
            else yield message;
          }
          index += 1;
        }
      })();
    },
  };
}

const facts = {
  tenant: "vteng",
  project: "chuggy",
  session: "session-1",
  kind: "Lead",
  capabilities: ["RepositoryRead", "RunCommands"],
  credentialSlot: "claude-code",
};

/**
 * The runtime as this pod resolves it, with the suite's own `query`. The other
 * three members are what the in-process server is built from, and `zod` is the
 * real one: a stub shape would prove the tools were registered and nothing about
 * whether their bounds hold.
 */
function sdkOf(query) {
  return {
    query,
    z,
    tool: (name, description, shape, handler) => ({
      name,
      description,
      shape,
      handler,
    }),
    createSdkMcpServer: (options) => options,
  };
}

function run(services) {
  const { query, ...rest } = services;
  return sessionMain({
    environment,
    read: async (path) => (path === bearerFile ? `${bearer}\n` : `${token}\n`),
    ensureDirectory: async () => undefined,
    warn: () => undefined,
    ...(query === undefined ? {} : { sdk: sdkOf(query) }),
    ...rest,
  });
}

const turnOne = {
  turn: "turn-1",
  ordinal: 1,
  inputKind: "UserMessage",
  input: "ask",
};
const result = (subtype, extra = {}) => ({ type: "result", subtype, ...extra });

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
/**
 * What the runtime reported its query pipeline had spent, taken from the spike's
 * own two-turn run: per-model totals, cumulative across the turns of one query,
 * four counters the measurement sums.
 */
const spentAfter = (
  inputTokens,
  outputTokens,
  cacheCreationInputTokens,
  cacheReadInputTokens,
) => ({
  "claude-haiku-4-5-20251001": {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    webSearchRequests: 0,
  },
});
const spent = spentAfter(948, 349, 16_150, 31_671);
const spentAgain = spentAfter(958, 375, 16_251, 47_821);
const spentTokens = 948 + 349 + 16_150 + 31_671;
const spentAgainTokens = 958 + 375 + 16_251 + 47_821 - spentTokens;

const answerOf = (plane) =>
  plane.calls.find(({ path }) => path === "/v1/session/turn/answer").body;

test("a turn reports the model, the tokens, the cost and the time the runtime spent", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    result("success", {
      result: "ok",
      modelUsage: spent,
      total_cost_usd: 0.038_160_1,
      duration_ms: 5_195,
    }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  assert.deepEqual(answerOf(plane).measured, {
    model: "haiku",
    tokens: spentTokens,
    costMicros: 38_160,
    durationMs: 5_195,
    tools: [],
  });
});

test("a turn's cost and tokens are what the running totals moved by, not the totals", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf((_asked, index) => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    result("success", {
      result: "ok",
      modelUsage: index === 0 ? spent : spentAgain,
      duration_ms: 1,
      total_cost_usd: index === 0 ? 0.038_160_1 : 0.040_117_1,
    }),
  ]);

  await run({ request: plane.request, query });

  const answered = plane.calls
    .filter(({ path }) => path === "/v1/session/turn/answer")
    .map(({ body }) => body.measured);
  assert.deepEqual(
    answered.map(({ costMicros }) => costMicros),
    [38_160, 1_957],
  );
  assert.deepEqual(
    answered.map(({ tokens }) => tokens),
    [spentTokens, spentAgainTokens],
  );
});

test("the tools a turn reports are the distinct ones its assistant named", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const called = (name) => ({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name }] },
  });
  const { query } = queryOf((_asked, index) =>
    index === 0
      ? [
          {
            type: "system",
            subtype: "init",
            session_id: "runtime-1",
            model: "haiku",
          },
          called("Bash"),
          {
            type: "user",
            message: {
              role: "user",
              content: [{ type: "tool_use", name: "Write" }],
            },
          },
          called("Read"),
          called("Bash"),
          result("success", {
            result: "ok",
            modelUsage: spent,
            duration_ms: 1,
          }),
        ]
      : [
          result("success", {
            result: "ok",
            modelUsage: spent,
            duration_ms: 1,
          }),
        ],
  );

  await run({ request: plane.request, query });

  const answers = plane.calls
    .filter(({ path }) => path === "/v1/session/turn/answer")
    .map(({ body }) => body.measured.tools);
  assert.deepEqual(answers, [["Bash", "Read"], []]);
});

test("a turn naming more tools than a row holds reports the bound and no more", async () => {
  const plane = planeOf([turnOne], facts);
  const named = Array.from(
    { length: sessionTurnToolsMax + 4 },
    (_unused, index) => `tool-${String(index)}`,
  );
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: named.map((name) => ({ type: "tool_use", name })),
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const { tools } = answerOf(plane).measured;
  assert.equal(tools.length, sessionTurnToolsMax);
  assert.deepEqual(tools, named.slice(0, sessionTurnToolsMax));
});

test("a tool name longer than a row holds is cut to the bound rather than refused", async () => {
  const plane = planeOf([turnOne], facts);
  const long = `x${"\u{1f600}".repeat(sessionTurnToolNameCharsMax)}`;
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: long }],
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const [only] = answerOf(plane).measured.tools;
  assert.equal(only.length, sessionTurnToolNameCharsMax);
  assert.ok(only.isWellFormed(), "the cut left half a surrogate pair behind");
});

test("a turn the runtime accounted for nothing on is answered with no measurement", async () => {
  for (const ended of [
    result("success", { result: "ok", duration_ms: 1 }),
    result("success", { result: "ok", modelUsage: null, duration_ms: 1 }),
  ]) {
    const plane = planeOf([turnOne], facts);
    const { query } = queryOf(() => [
      {
        type: "system",
        subtype: "init",
        session_id: "runtime-1",
        model: "haiku",
      },
      ended,
    ]);

    const code = await run({ request: plane.request, query });

    assert.equal(code, 0);
    const answered = answerOf(plane);
    assert.ok(
      !("measured" in answered),
      "a turn with nothing to measure carried a measurement of zeroes",
    );
  }
});

test("a turn whose runtime named no model carries no measurement either", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  assert.ok(
    !("measured" in answerOf(plane)),
    "four of the five columns were posted as a whole measurement",
  );
});

test("a figure the runtime reported as no number is measured as nothing spent", () => {
  const measure = sessionMeasure();
  measure.saw({ type: "system", subtype: "init", model: "haiku" });
  assert.deepEqual(
    measure.of({
      modelUsage: { haiku: { inputTokens: "many", outputTokens: -3 } },
      total_cost_usd: "free",
      duration_ms: undefined,
    }),
    {
      model: "haiku",
      tokens: 0,
      costMicros: 0,
      durationMs: 0,
      tools: [],
    },
  );
});

/** One measure that has already been told a model, which is all the envelope needs. */
function measureOf(model = "haiku") {
  const measure = sessionMeasure();
  measure.saw({ type: "system", subtype: "init", model });
  return measure;
}

test("a total the runtime did not report leaves the mark, and the next one is a delta from it", () => {
  const measure = measureOf();
  const costs = [0.3, undefined, 0.45].map(
    (total_cost_usd) =>
      measure.of({ modelUsage: spent, total_cost_usd }).costMicros,
  );

  assert.deepEqual(costs, [300_000, 0, 150_000]);
});

test("a total the runtime reported lower than the last charges the turn nothing", () => {
  const measure = measureOf();
  const costs = [0.3, 0.1, 0.25].map(
    (total_cost_usd) =>
      measure.of({ modelUsage: spent, total_cost_usd }).costMicros,
  );

  assert.deepEqual(costs, [300_000, 0, 150_000]);
});

test("what a failed turn spent is charged to the next turn that answers", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf((_asked, index) => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    index === 0
      ? result("error_during_execution", {
          modelUsage: spent,
          total_cost_usd: 0.3,
          duration_ms: 1,
        })
      : result("success", {
          result: "ok",
          modelUsage: spentAgain,
          total_cost_usd: 0.45,
          duration_ms: 1,
        }),
  ]);

  await run({ request: plane.request, query });

  const answers = plane.calls.filter(
    ({ path }) => path === "/v1/session/turn/answer",
  );
  assert.equal(answers.length, 1, "a failed turn was answered");
  assert.equal(answers[0].body.measured.costMicros, 450_000);
  assert.equal(
    answers[0].body.measured.tokens,
    spentTokens + spentAgainTokens,
    "the failed turn's tokens were dropped rather than carried",
  );
});

test("the tokens counted are every model's, not the main loop's alone", () => {
  const withSubagent = {
    ...spent,
    "claude-opus-4-5": {
      inputTokens: 11,
      outputTokens: 22,
      cacheCreationInputTokens: 33,
      cacheReadInputTokens: 44,
    },
  };

  assert.equal(
    measureOf().of({ modelUsage: withSubagent }).tokens,
    spentTokens + 11 + 22 + 33 + 44,
  );
});

test("a name carrying the one character no stored row holds is stripped of it", async () => {
  const plane = planeOf([turnOne], facts);
  const named = "Ba\u0000sh";
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "hai\u0000ku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: named }],
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const { model, tools } = answerOf(plane).measured;
  assert.deepEqual(tools, ["Bash"]);
  assert.equal(model, "haiku");
});

test("a model identity longer than a row holds is cut to the bound rather than refused", () => {
  const long = `x${"\u{1f600}".repeat(sessionTurnModelCharsMax)}`;
  const measure = measureOf(long);

  const { model } = measure.of({ modelUsage: spent });
  assert.equal(model.length, sessionTurnModelCharsMax);
  assert.ok(model.isWellFormed(), "the cut left half a surrogate pair behind");
});

test("a model the runtime named as nothing a row holds leaves the last one standing", () => {
  const measure = measureOf();
  measure.saw({ type: "system", subtype: "init", model: "\u0000" });
  measure.saw({ type: "system", subtype: "init", model: "" });

  assert.equal(measure.of({ modelUsage: spent }).model, "haiku");
});

test("a record naming no model leaves the mark, so the next turn is a delta not a session", () => {
  const measure = measureOf();

  const first = measure.of({ modelUsage: spent, total_cost_usd: 0.3 });
  const empty = measure.of({ modelUsage: {}, total_cost_usd: undefined });
  const next = measure.of({ modelUsage: spentAgain, total_cost_usd: 0.45 });

  assert.equal(first.tokens, spentTokens);
  assert.equal(empty, undefined, "a record naming no model was measured");
  assert.equal(next.tokens, spentAgainTokens);
  assert.equal(next.costMicros, 150_000);
});
