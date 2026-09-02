import assert from "node:assert/strict";
import test from "node:test";

import { sessionMain, sessionTurnFailure } from "./session.mjs";

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
  bounds: {
    mailboxPollMs: 1,
    idleMs: 0,
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

function planeOf(turns, facts) {
  const calls = [];
  let claims = 0;
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
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

function run(services) {
  return sessionMain({
    environment,
    read: async (path) => (path === bearerFile ? `${bearer}\n` : `${token}\n`),
    ensureDirectory: async () => undefined,
    warn: () => undefined,
    ...services,
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
    [
      result("error_during_execution", { stop_reason: "rate_limit" }),
      "AgentRateLimited",
    ],
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
  assert.equal(
    sessionTurnFailure({ subtype: "error_rate_limit" }),
    "AgentRateLimited",
  );
  assert.equal(sessionTurnFailure(undefined), "AgentFailed");
});
