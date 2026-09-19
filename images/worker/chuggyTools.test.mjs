import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import { leadRoster } from "../../test/contract/sessionRosterFixture.ts";

import { z } from "zod";

import {
  allChuggyTools,
  chuggyToolAnswerBytes,
  chuggyToolAnswerBytesMax,
  chuggyToolAnswerCopiesInEntry,
  chuggyToolAnswerEnvelopeBytesMax,
  chuggyProjectTools,
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolHandler,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServer,
  chuggyToolTimeoutMs,
  sessionAllowedTools,
  sessionBuiltInTools,
  sessionCapabilityTools,
} from "./chuggyTools.mjs";
import {
  sessionStoreAdapter,
  sessionStoreBatchBytesMax,
} from "./sessionStore.mjs";

const task = {
  tenant: "vteng",
  project: "chuggy",
  api: { url: "https://api.test:8443" },
};
const bearer = "chgs_0123456789abcdef0123456789abcdef";
const everyCapability = Object.keys(sessionCapabilityTools);

function apiOf(answer) {
  const calls = [];
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
      calls.push({ path, method: init?.method ?? "GET", init });
      const given = answer?.(path, init) ?? { status: 200, body: "{}" };
      return {
        status: given.status,
        text: async () => given.body ?? "",
      };
    },
  };
}

function toolsOf(services = {}, answer) {
  const api = apiOf(answer);
  const context = chuggyToolContext(task, bearer, {
    capabilities: everyCapability,
    request: api.request,
    turn: () => "turn-1",
    ...services,
  });
  const registered = chuggyToolDefinitions(context);
  const definitions = [
    ...registered,
    ...chuggyProjectTools
      .filter(
        (definition) =>
          !registered.some((held) => held.name === definition.name),
      )
      .map((definition) => ({
        ...definition,
        call: (args) => definition.call(context, args),
      })),
  ];
  const held = new Map(
    definitions.map((definition) => [
      definition.name,
      chuggyToolHandler(definition, z),
    ]),
  );
  return { api, context, call: (name, args) => held.get(name)(args) };
}

function textOf(answer) {
  return answer.content[0].text;
}

test("the server the runtime is handed carries exactly the tools the roster admits", () => {
  const seen = [];
  const sdk = {
    z,
    tool: (name, description, shape, handler) => ({
      name,
      description,
      shape,
      handler,
    }),
    createSdkMcpServer: (options) => {
      seen.push(options);
      return options;
    },
  };

  const server = chuggyToolServer(
    chuggyToolContext(task, bearer, {
      capabilities: ["ProjectRead"],
    }),
    sdk,
  );

  assert.equal(seen.length, 1);
  assert.equal(server.timeout, chuggyToolTimeoutMs);
  assert.deepEqual(
    server.tools.map(({ name }) => name),
    sessionCapabilityTools.ProjectRead,
  );
  for (const { description } of server.tools)
    assert.ok(description.length > 0, "a registered tool describes nothing");
});

test("the adopted ticket graph is read once and relayed whole", async () => {
  const body = JSON.stringify({ tickets: [] });
  const { api, call } = toolsOf({}, () => ({ status: 200, body }));

  const answer = await call("list_tickets", {});

  assert.equal(api.calls.length, 1, "one tool call walked more than one page");
  assert.equal(
    api.calls[0].path,
    "/api/v1/tenants/vteng/projects/chuggy/ticket-machine/tickets",
  );
  assert.equal(api.calls[0].method, "GET");
  assert.equal(textOf(answer), `HTTP 200\n${body}`);
  assert.ok(answer.isError === undefined);
});

test("a page larger than the pod draws is refused rather than answered cut", async () => {
  assert.ok(
    chuggyToolAnswerBytesMax < chuggyToolResponseBytesMax,
    "a body cut at the draw bound is over the answer bound, which is what refuses it",
  );
  const { call } = toolsOf({}, () => ({
    status: 200,
    body: "x".repeat(70_000),
  }));

  const answer = await call("list_tickets", {});

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /larger than the/);
  assert.ok(!textOf(answer).includes("xxx"), "a cut body was answered anyway");
});

/**
 * What the refusal tells the model to do, which is nothing it can do for a tool
 * with no page bound and nothing again for one already asking for a single item.
 * A remedy the caller has already taken is a loop.
 */
test("the refusal names what this caller can lower, and says so where there is nothing", async () => {
  const body = "x".repeat(70_000);
  for (const [name, args, remedy] of [
    [
      "read_thread",
      { session: "t-1", limit: 1 },
      /read_thread is already asking for one; move past it with before\.$/,
    ],
  ]) {
    const answer = await routeOf(
      name,
      args,
      apiOf(() => ({ status: 200, body })),
    );

    assert.equal(answer.isError, true, name);
    assert.match(textOf(answer), remedy, name);
  }
});

/**
 * The bound at its own edge, over the relays that answer a route's body. The
 * weight is the escaped one because that is what the entry's line is charged,
 * and a page under the wire bound can be over this one.
 */
test("an answer at the bound is served and one over it never reaches the model", async () => {
  const head = "HTTP 200\n";
  const room = chuggyToolAnswerBytesMax - chuggyToolAnswerBytes(head);
  for (const [name, args] of [["read_thread", { session: "t-1", limit: 32 }]]) {
    const at = await routeOf(
      name,
      args,
      apiOf(() => ({ status: 200, body: "x".repeat(room) })),
    );
    const over = await routeOf(
      name,
      args,
      apiOf(() => ({ status: 200, body: "x".repeat(room + 1) })),
    );

    assert.ok(at.isError === undefined, name);
    assert.equal(
      chuggyToolAnswerBytes(textOf(at)),
      chuggyToolAnswerBytesMax,
      name,
    );
    assert.equal(over.isError, true, name);
    assert.match(textOf(over), /larger than the/, name);
    assert.ok(!textOf(over).includes("xxx"), name);
  }
});

/**
 * The tool #569 was filed on, against a batch of the size the plane refused
 * that session for. The route pages by store batch and a batch is bounded by
 * the store's own line bound, so the answer has to be cut below the page.
 */
test("a thread transcript of one full batch is read whole, page by page, under the bound", async () => {
  const entries = Array.from({ length: 89 }, (_, index) => ({
    uuid: `u-${String(index)}`,
    type: "assistant",
    message: { role: "assistant", content: "x".repeat(700) },
  }));
  const body = JSON.stringify({
    stream: "t-1",
    entries,
    held: ["u-1"],
    elided: 0,
    truncated: false,
  });
  assert.ok(
    chuggyToolAnswerBytes(body) > chuggyToolAnswerBytesMax,
    "the batch under test is smaller than one answer",
  );
  const { api, call } = toolsOf({}, () => ({ status: 200, body }));
  const read = [];
  let cursor = {};

  for (let page = 0; page < 64; page += 1) {
    const answer = await call("read_thread_transcript", {
      session: "t-1",
      ...cursor,
    });

    assert.ok(answer.isError === undefined, `page ${String(page)} was refused`);
    assert.ok(
      chuggyToolAnswerBytes(textOf(answer)) <= chuggyToolAnswerBytesMax,
      `page ${String(page)} is over the bound`,
    );
    const given = JSON.parse(textOf(answer));
    read.push(...given.entries.map(({ uuid }) => uuid));
    if (given.next === undefined) break;
    cursor = given.next;
  }

  assert.deepEqual(
    read,
    entries.map(({ uuid }) => uuid),
    "the transcript was not read whole",
  );
  assert.ok(api.calls.length > 1, "one answer carried a whole batch");
  assert.ok(
    api.calls.every(({ path }) => path.includes("limit=1")),
    "a transcript read asked for more than the batch it cuts from",
  );
});

test("a raise too large to store is refused like any other answer", async () => {
  const huge = "x".repeat(chuggyToolAnswerBytesMax);
  const api = {
    request: async () => {
      throw new Error(huge);
    },
  };

  const answer = await routeOf("read_ticket", { ticket: 7 }, api);

  assert.equal(answer.isError, true);
  assert.ok(!textOf(answer).includes("xxx"), "the raise was answered whole");
  assert.match(textOf(answer), /larger than the/);
});

/**
 * The entry a tool answer becomes, captured off a transcript the pinned runtime
 * wrote rather than composed here. An entry this suite composed would hold the
 * shape this suite believes in, which is what the bound is derived from.
 */
function capturedEntry() {
  return JSON.parse(
    readFileSync(new URL("./toolAnswerEntry.fixture.json", import.meta.url)),
  );
}

test("the captured entry carries one answer as many times as the bound divides by", () => {
  const entry = capturedEntry();
  const inMessage = entry.message.content[0].content[0].text;

  assert.equal(entry.toolUseResult[0].text, inMessage, "the copies differ");
  assert.equal(
    JSON.stringify(entry).split(JSON.stringify(inMessage).slice(1, -1)).length -
      1,
    chuggyToolAnswerCopiesInEntry,
    "the entry carries the answer a different number of times than the bound divides by",
  );
});

test("the reserve is wider than the captured envelope by more than the whole of it", () => {
  const entry = capturedEntry();
  entry.message.content[0].content[0].text = "";
  entry.toolUseResult[0].text = "";

  assert.ok(
    Buffer.byteLength(JSON.stringify(entry)) * 2 <=
      chuggyToolAnswerEnvelopeBytesMax,
    `the captured envelope weighs ${String(Buffer.byteLength(JSON.stringify(entry)))} bytes against a reserve of ${String(chuggyToolAnswerEnvelopeBytesMax)}`,
  );
});

/**
 * The tool's bound held against the store's, through that entry. The answer at
 * the bound goes into both copies, because that is where the runtime puts it.
 */
test("a maximal answer inside the captured entry is one batch the store can post", async () => {
  const posted = [];
  const store = sessionStoreAdapter(
    { workerPlane: { url: "http://worker-plane.test:3001" } },
    "chgs_b",
    {
      request: async (_task, _bearer, _path, init) => {
        posted.push(init.body);
        return { status: 204 };
      },
    },
  );
  const entry = capturedEntry();
  const text = `HTTP 200\n${"x".repeat(
    chuggyToolAnswerBytesMax - chuggyToolAnswerBytes("HTTP 200\n"),
  )}`;
  entry.message.content[0].content[0].text = text;
  entry.toolUseResult[0].text = text;

  await store.append({ sessionId: entry.sessionId }, [entry]);

  assert.equal(chuggyToolAnswerBytes(text), chuggyToolAnswerBytesMax);
  assert.equal(posted.length, 1);
  assert.ok(
    posted[0].length <= sessionStoreBatchBytesMax,
    `the entry posted ${String(posted[0].length)} bytes and one batch holds ${String(sessionStoreBatchBytesMax)}`,
  );
});

/** One tool's route, driven past the unserved table so every path is covered. */
function routeOf(name, args, api) {
  const definition = chuggyProjectTools.find((held) => held.name === name);
  return chuggyToolHandler(
    {
      ...definition,
      call: (called) =>
        definition.call(
          chuggyToolContext(task, bearer, { request: api.request }),
          called,
        ),
    },
    z,
  )(args);
}

test("a thread read past its bound is refused before it asks, and within it asks", async () => {
  for (const [name, args] of [
    ["read_thread", { session: "" }],
    ["read_thread", { session: "t-1", limit: 0 }],
    ["read_thread", { session: "t-1", limit: 33 }],
    ["read_thread", { session: "t-1", before: 0 }],
    ["read_thread_transcript", { session: "t-1", entry: -1 }],
    ["read_thread_transcript", { session: "" }],
  ]) {
    const api = apiOf();

    const answer = await routeOf(name, args, api);

    assert.equal(answer.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(api.calls.length, 0, name);
  }
  const api = apiOf();

  await routeOf("read_thread_transcript", { session: "t-1", entry: 0 }, api);

  assert.equal(api.calls.length, 1, "a transcript at its cursor was refused");
});

test("the project inventory is read outside the project's own path", async () => {
  const api = apiOf();

  await routeOf("read_projects", { limit: 3 }, api);

  assert.equal(api.calls[0].path, "/api/v1/projects?limit=3");
});

test("an argument past its bound is refused before any call is made", async () => {
  const { api, call } = toolsOf();

  for (const [name, args] of [
    ["read_ticket", { ticket: 0 }],
    ["read_lead_transcript", { after: -1 }],
  ]) {
    const answer = await call(name, args);

    assert.equal(answer.isError, true, name);
  }
  assert.equal(api.calls.length, 0, "a refused argument still reached the API");
});

test("every subset of the capabilities admits its tools and disallows the rest", () => {
  const every = [
    ...sessionBuiltInTools,
    ...allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  ];
  for (let subset = 0; subset < 2 ** everyCapability.length; subset += 1) {
    const held = everyCapability.filter(
      (_, index) => ((subset >> index) & 1) === 1,
    );
    const admitted = new Set(
      held.flatMap((name) =>
        sessionCapabilityTools[name].map((tool) =>
          sessionBuiltInTools.includes(tool)
            ? tool
            : `${chuggyToolPrefix}${tool}`,
        ),
      ),
    );

    const { allowedTools, disallowedTools } = sessionAllowedTools(held);

    assert.deepEqual(new Set(allowedTools), admitted, held.join(","));
    assert.deepEqual(
      [...allowedTools, ...disallowedTools].sort(),
      [...every].sort(),
      held.join(","),
    );
  }
});

/**
 * The runtime's own tool-discovery tool is admitted by no capability, and a
 * built-in the roster does not carry is in NEITHER list — governed by
 * `permissionMode: "bypassPermissions"` alone, which is no roster at all. So a
 * roster that merely declines to grant it still offers it, and a lead that
 * reaches for it has the whole decision it was in refused against
 * `toolAllowlist`, which is derived from the roster and cannot name it.
 */
test("the runtime's tool-discovery tool is denied by name to every roster", () => {
  const discovery = "ToolSearch";

  for (const [capability, tools] of Object.entries(sessionCapabilityTools))
    assert.ok(!tools.includes(discovery), `${capability} admits it`);
  for (const held of [[], [...leadRoster], everyCapability]) {
    const { allowedTools, disallowedTools } = sessionAllowedTools(held);

    assert.ok(
      disallowedTools.includes(discovery),
      `${held.join(",")} does not deny it by name`,
    );
    assert.ok(!allowedTools.includes(discovery), `${held.join(",")} allows it`);
  }
});

test("a session with no ProjectRead disallows every chuggy read by name", () => {
  const { allowedTools, disallowedTools } = sessionAllowedTools([
    "RepositoryRead",
    "RepositoryRead",
  ]);

  for (const tool of sessionCapabilityTools.ProjectRead) {
    const name = `${chuggyToolPrefix}${tool}`;
    assert.ok(disallowedTools.includes(name), `${name} was not disallowed`);
    assert.ok(!allowedTools.includes(name), `${name} was allowed`);
  }
});

test("a capability this image does not know admits nothing", () => {
  const { allowedTools, disallowedTools } = sessionAllowedTools(["Telepathy"]);

  assert.deepEqual(allowedTools, []);
  assert.equal(
    disallowedTools.length,
    sessionBuiltInTools.length + allChuggyTools.length,
  );
});
