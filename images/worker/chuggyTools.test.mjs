import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";

import { leadRoster } from "../../test/contract/sessionRosterFixture.ts";

import { z } from "zod";

import {
  allChuggyTools,
  chuggyOperationIdentity,
  chuggyToolAnswerBytes,
  chuggyToolAnswerBytesMax,
  chuggyProjectTools,
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolHandler,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServer,
  chuggyToolsNotYetServed,
  chuggyToolTimeoutMs,
  sessionAllowedTools,
  sessionBuiltInTools,
  sessionCapabilityTools,
} from "./chuggyTools.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";
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
  const staging = services.staging ?? leadDecisionStaging();
  const context = chuggyToolContext(task, bearer, {
    capabilities: everyCapability,
    request: api.request,
    turn: () => "turn-1",
    staging,
    ...services,
  });
  const held = new Map(
    chuggyToolDefinitions(context).map((definition) => [
      definition.name,
      chuggyToolHandler(definition, z),
    ]),
  );
  return { api, staging, context, call: (name, args) => held.get(name)(args) };
}

function textOf(answer) {
  return answer.content[0].text;
}

test("a tool the roster does not grant is never registered", () => {
  const registered = (capabilities) =>
    chuggyToolDefinitions(
      chuggyToolContext(task, bearer, {
        capabilities,
        staging: leadDecisionStaging(),
      }),
    ).map(({ name }) => name);

  assert.deepEqual(registered([]), []);
  assert.deepEqual(registered(["RepositoryRead"]), []);
  assert.deepEqual(
    registered(["LeadDecision"]),
    sessionCapabilityTools.LeadDecision,
  );
  assert.deepEqual(
    registered(everyCapability).sort(),
    [...allChuggyTools].sort(),
  );
});

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
      staging: leadDecisionStaging(),
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

/**
 * The decision channel through the server's own registration, which is where a
 * staged answer meets the protocol. The tools' own suite holds each answer's
 * text; this holds the bridge that carries it.
 */
test("a decision tool the server registers answers a well-formed result", async () => {
  const staging = leadDecisionStaging();
  staging.reset(
    JSON.stringify({ candidates: [{ ticket: 4, ticketVersion: 2 }] }),
  );
  const { api, call } = toolsOf({ staging });

  const answer = await call("dispatch", {
    ticket: 4,
    expectedTicketVersion: 2,
  });

  assert.deepEqual(answer.content, [
    { type: "text", text: "dispatch staged for ticket 4" },
  ]);
  assert.ok(answer.isError === undefined);
  assert.equal(api.calls.length, 0, "a decision tool wrote something");
  assert.equal(staging.document().dispatches.length, 1);
});

test("every read answers one page, relays the route's own body and names its cursor", async () => {
  const body = JSON.stringify({ tickets: [], nextAfter: 41 });
  const { api, call } = toolsOf({}, () => ({ status: 200, body }));

  const answer = await call("list_tickets", { after: 40, limit: 25 });

  assert.equal(api.calls.length, 1, "one tool call walked more than one page");
  assert.equal(
    api.calls[0].path,
    "/api/v1/tenants/vteng/projects/chuggy?after=40&limit=25",
  );
  assert.equal(api.calls[0].method, "GET");
  assert.equal(textOf(answer), `HTTP 200\n${body}`);
  assert.ok(answer.isError === undefined);
});

test("a page larger than the pod draws is refused rather than answered cut", async () => {
  const { call } = toolsOf({}, () => ({
    status: 200,
    body: "x".repeat(70_000),
  }));

  const answer = await call("read_ticket", { ticket: 7 });

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /ask again for a smaller page/);
  assert.match(
    textOf(answer),
    new RegExp(`${String(chuggyToolResponseBytesMax)} bytes one answer draws`),
    "a cut page is refused as a page too large to draw, not weighed as an answer",
  );
  assert.ok(!textOf(answer).includes("xxx"), "a cut body was answered anyway");
});

/**
 * The bound at its own edge, over one relay that pages by items and one that
 * pages by store batches. The weight is the escaped one because that is what the
 * entry's line is charged, and a page under the wire bound can be over this one.
 */
test("an answer at the bound is served and one over it never reaches the model", async () => {
  const head = "HTTP 200\n";
  const room = chuggyToolAnswerBytesMax - chuggyToolAnswerBytes(head);
  for (const [name, args] of [
    ["list_executions", { limit: 100 }],
    ["read_thread_transcript", { session: "t-1", limit: 8 }],
  ]) {
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
    assert.match(textOf(over), /ask again for a smaller page/, name);
    assert.ok(!textOf(over).includes("xxx"), name);
  }
});

/**
 * The tool's bound held against the store's, through the entry the runtime
 * writes around an answer. The envelope is written here because the runtime owns
 * its shape and this image never sees one, so what is checked is that the
 * reserve covers a generous one rather than that it is the true size.
 */
test("a maximal answer inside a transcript entry is one batch the store can post", async () => {
  const uuid = "0f9c1a3e-6d24-4c8b-9a7e-1b2c3d4e5f60";
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
  const text = "x".repeat(
    chuggyToolAnswerBytesMax - chuggyToolAnswerBytes("HTTP 200\n"),
  );

  await store.append({ sessionId: uuid }, [
    {
      parentUuid: uuid,
      isSidechain: false,
      userType: "external",
      cwd: "/workspace/repository/checkout",
      sessionId: uuid,
      version: "2.0.44",
      gitBranch: "main",
      type: "user",
      message: {
        role: "user",
        content: [
          {
            tool_use_id: `toolu_01${"a".repeat(22)}`,
            type: "tool_result",
            content: [{ type: "text", text: `HTTP 200\n${text}` }],
          },
        ],
      },
      uuid,
      timestamp: "2026-09-04T12:00:00.000Z",
    },
  ]);

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

test("each read reaches the route its roster names, and only it", async () => {
  const cases = [
    [["read_ticket", { ticket: 7 }], "/tickets/7"],
    [["read_draft", { ticket: 7 }], "/drafts/7"],
    [["list_drafts", { limit: 5 }], "/drafts?limit=5"],
    [["list_configurations", { limit: 5 }], "/configurations?limit=5"],
    [["read_configuration", { revision: "r/1" }], "/configurations/r%2F1"],
    [
      ["read_decision_log", { after: 3, limit: 2 }],
      "/selector-history?after=3&limit=2",
    ],
    [["read_refusals", { limit: 4 }], "/agentic-refusals?limit=4"],
    [["read_ticket_refusals", { ticket: 9 }], "/tickets/9/agentic-refusals"],
    [["read_lead", {}], "/lead"],
    [
      ["read_lead_transcript", { after: 2, limit: 8 }],
      "/lead/transcript?after=2&limit=8",
    ],
    [
      ["list_executions", { ticket: 3, state: ["Running"] }],
      "/executions?ticket=3&state=Running",
    ],
    [["read_execution", { execution: "e-1" }], "/executions/e-1"],
    [
      ["read_run_transcript", { execution: "e-1", attempt: "a-1", after: 0 }],
      "/executions/e-1/attempts/a-1/transcript?after=0",
    ],
    [["read_operation", { operation: "o-1" }], "/operations/o-1"],
    [["initialize_draft", { revision: "r1" }], "/draft-initializations/r1"],
    [["list_threads", {}], "/threads"],
    [["read_thread", { session: "thread-1/a" }], "/threads/thread-1%2Fa"],
    [
      ["read_thread", { session: "thread-1", before: 7, limit: 32 }],
      "/threads/thread-1?before=7&limit=32",
    ],
    [
      ["read_thread_transcript", { session: "thread-1", after: 2, limit: 8 }],
      "/threads/thread-1/transcript?after=2&limit=8",
    ],
  ];
  for (const [[name, args], suffix] of cases) {
    const api = apiOf();

    await routeOf(name, args, api);

    assert.equal(
      api.calls[0].path,
      `/api/v1/tenants/vteng/projects/chuggy${suffix}`,
      name,
    );
  }
});

/**
 * Every identity a tool puts in a path segment, given one that carries the
 * separator. A segment is model-chosen text bounded only by `identity(z)`, so
 * an unencoded one is a tool that reaches a route its roster does not name:
 * `new URL(path, origin)` resolves `..` before the request is made, which is
 * how `…/threads/../lead/transcript` becomes the lead's route. The assertion is
 * on the RESOLVED pathname rather than on the string this file built, because
 * the string is not what the API is asked for.
 */
test("an identity carrying a separator stays inside the route its tool names", async () => {
  const escaping = "../lead";
  const escaped = "..%2Flead";
  const partition = "/api/v1/tenants/vteng/projects/chuggy";
  const cases = [
    [
      ["read_configuration", { revision: escaping }],
      `/configurations/${escaped}`,
    ],
    [["read_execution", { execution: escaping }], `/executions/${escaped}`],
    [
      ["read_run_transcript", { execution: escaping, attempt: escaping }],
      `/executions/${escaped}/attempts/${escaped}/transcript`,
    ],
    [["read_operation", { operation: escaping }], `/operations/${escaped}`],
    [
      ["initialize_draft", { revision: escaping }],
      `/draft-initializations/${escaped}`,
    ],
    [["read_thread", { session: escaping }], `/threads/${escaped}`],
    [
      ["read_thread_transcript", { session: escaping }],
      `/threads/${escaped}/transcript`,
    ],
  ];
  for (const [[name, args], suffix] of cases) {
    const api = apiOf();

    await routeOf(name, args, api);

    assert.equal(api.calls.length, 1, name);
    assert.equal(
      new URL(api.calls[0].path, "https://api.test").pathname,
      `${partition}${suffix}`,
      name,
    );
  }
});

/**
 * The thread reads' own bounds, driven past the unserved table. Their entries
 * there answer `isError` for any argument at all, so a bound checked through a
 * session's handler would pass with the bound deleted; `routeOf` is what makes
 * the refusal the shape's rather than the table's.
 */
test("a thread read past its bound is refused before it asks, and within it asks", async () => {
  for (const [name, args] of [
    ["read_thread", { session: "" }],
    ["read_thread", { session: "t-1", limit: 0 }],
    ["read_thread", { session: "t-1", limit: 33 }],
    ["read_thread", { session: "t-1", before: 0 }],
    ["read_thread_transcript", { session: "t-1", limit: 0 }],
    ["read_thread_transcript", { session: "t-1", limit: 9 }],
    ["read_thread_transcript", { session: "" }],
  ]) {
    const api = apiOf();

    const answer = await routeOf(name, args, api);

    assert.equal(answer.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(api.calls.length, 0, name);
  }
  const api = apiOf();

  await routeOf("read_thread_transcript", { session: "t-1", limit: 8 }, api);

  assert.equal(api.calls.length, 1, "a transcript at its bound was refused");
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
    ["list_tickets", { limit: 101 }],
    ["read_decision_log", { limit: 51 }],
    ["read_refusals", { limit: 33 }],
    ["read_lead_transcript", { limit: 9 }],
    ["read_execution", { execution: "" }],
  ]) {
    const answer = await call(name, args);

    assert.equal(answer.isError, true, name);
  }
  assert.equal(api.calls.length, 0, "a refused argument still reached the API");
});

test("a write relays the status and the body the API answered, unaltered", async () => {
  for (const status of [409, 422, 429]) {
    const body = JSON.stringify({ error: "Stale", status });
    const { api, call } = toolsOf({}, () => ({ status, body }));

    const answer = await call("delete_draft", {
      ticket: 4,
      expectedVersion: 2,
    });

    assert.equal(textOf(answer), `HTTP ${String(status)}\n${body}`);
    assert.equal(answer.isError, true);
    assert.equal(api.calls.length, 1, "a refused write was asked again");
    assert.equal(
      api.calls[0].path,
      "/api/v1/tenants/vteng/projects/chuggy/drafts/4?expectedVersion=2",
    );
    assert.equal(api.calls[0].method, "DELETE");
  }
});

test("a write is written in the versioned media type the API requires", async () => {
  const { api, call } = toolsOf();

  await call("revise_draft", {
    ticket: 4,
    expectedVersion: 2,
    configurationRevision: "r1",
    authoring: { dependencies: [] },
    brief: { title: "t" },
  });

  assert.equal(api.calls[0].method, "PUT");
  assert.equal(
    api.calls[0].init.headers["content-type"],
    "application/vnd.chuggy.v1+json",
  );
  assert.deepEqual(JSON.parse(api.calls[0].init.body), {
    expectedVersion: 2,
    configurationRevision: "r1",
    authoring: { dependencies: [] },
    brief: { title: "t" },
  });
});

const dependent = {
  parent: 7,
  relation: "FollowUp",
  configurationRevision: "r1",
  configurationDigest: "d1",
  expectedProjectSequence: 12,
  authoring: { dependencies: [7] },
  brief: { title: "t" },
};

test("a dependent is filed with its parent among the draft's dependencies", async () => {
  const { api, call } = toolsOf();

  await call("file_dependent", dependent);

  assert.equal(api.calls[0].method, "POST");
  assert.equal(
    api.calls[0].path,
    "/api/v1/tenants/vteng/projects/chuggy/drafts",
  );
  assert.deepEqual(JSON.parse(api.calls[0].init.body).authoring, {
    dependencies: [7],
  });
});

test("a prerequisite is refused, and the refusal names dependency immutability", async () => {
  const { api, call } = toolsOf();

  const answer = await call("file_dependent", {
    ...dependent,
    relation: "Prerequisite",
  });

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /dependencies are immutable/);
  assert.match(textOf(answer), /FollowUp/);
  assert.equal(api.calls.length, 0);
});

test("a dependent that does not carry its parent is refused", async () => {
  const { api, call } = toolsOf();

  const answer = await call("file_dependent", {
    ...dependent,
    authoring: { dependencies: [8] },
  });

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /does not name ticket 7/);
  assert.equal(api.calls.length, 0);
});

test("a relation outside the roster never reaches the refusal that explains one", async () => {
  const { call } = toolsOf();

  const answer = await call("file_dependent", {
    ...dependent,
    relation: "Supersedes",
  });

  assert.equal(answer.isError, true);
});

test("releasing a draft submits one operation and answers its id, not an outcome", async () => {
  const accepted = JSON.stringify({ operation: "o", state: "Accepted" });
  const { api, call } = toolsOf({}, () => ({ status: 202, body: accepted }));

  const answer = await call("release_draft", {
    ticket: 4,
    authoringVersion: 3,
    configurationRevision: "r1",
  });

  const body = JSON.parse(api.calls[0].init.body);
  assert.deepEqual(body.mutation, {
    mutation: "ReleaseDraft",
    ticket: 4,
    authoringVersion: 3,
    configurationRevision: "r1",
  });
  assert.equal(api.calls[0].init.headers["idempotency-key"], body.operation);
  assert.equal(textOf(answer), `HTTP 202\n${accepted}`);
});

test("two releases in one turn are two operations, and one repeated is one", async () => {
  const { api, call } = toolsOf({}, () => ({ status: 202, body: "{}" }));
  const release = (ticket) =>
    call("release_draft", {
      ticket,
      authoringVersion: 3,
      configurationRevision: "r1",
    });

  await release(4);
  await release(9);
  await release(4);

  const ids = api.calls.map(({ init }) => JSON.parse(init.body).operation);
  const keys = api.calls.map(({ init }) => init.headers["idempotency-key"]);
  assert.notEqual(
    ids[0],
    ids[1],
    "two releases of different drafts in one turn collide on one operation, and the second is an idempotency conflict naming nothing the lead can act on",
  );
  assert.equal(ids[0], ids[2], "one call repeated minted a second operation");
  assert.deepEqual(keys, ids, "the key and the operation are not the same");
});

test("a command's identity is a value the caller cannot have guessed", () => {
  const mutation = {
    mutation: "ReleaseDraft",
    ticket: 4,
    authoringVersion: 3,
    configurationRevision: "r1",
  };

  assert.notEqual(
    chuggyOperationIdentity("turn-1", mutation),
    chuggyOperationIdentity("turn-1", { ...mutation, ticket: 9 }),
  );
  assert.notEqual(
    chuggyOperationIdentity("turn-1", mutation),
    chuggyOperationIdentity("turn-1", { ...mutation, authoringVersion: 4 }),
  );
  assert.notEqual(
    chuggyOperationIdentity("turn-1", mutation),
    chuggyOperationIdentity("turn-2", mutation),
  );
});

test("the same release repeated in one turn is the same operation, and a new turn is a new one", async () => {
  let turn = "turn-1";
  const { api, call } = toolsOf({ turn: () => turn }, () => ({
    status: 202,
    body: "{}",
  }));
  const args = { ticket: 4, authoringVersion: 3, configurationRevision: "r1" };

  await call("release_draft", args);
  await call("release_draft", args);
  turn = "turn-2";
  await call("release_draft", args);

  const ids = api.calls.map(({ init }) => JSON.parse(init.body).operation);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[1], ids[2]);
});

test("a command submitted with no turn claimed is refused rather than minted", async () => {
  const { api, call } = toolsOf({ turn: () => undefined });

  const answer = await call("release_draft", {
    ticket: 4,
    authoringVersion: 3,
    configurationRevision: "r1",
  });

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /no turn is claimed/);
  assert.equal(api.calls.length, 0);
});

const origination = {
  configurationRevision: "r1",
  configurationDigest: "d1",
  expectedProjectSequence: 12,
  authoring: { dependencies: [] },
  brief: { title: "what the member asked for" },
};

test("an originated draft is filed at the drafts route, fenced and derived from nothing", async () => {
  const filed = JSON.stringify({ ticket: 14, version: 1 });
  const { api, call } = toolsOf({}, () => ({ status: 201, body: filed }));

  const answer = await call("create_draft", origination);

  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].method, "POST");
  assert.equal(
    api.calls[0].path,
    "/api/v1/tenants/vteng/projects/chuggy/drafts",
  );
  assert.equal(
    api.calls[0].init.headers["content-type"],
    "application/vnd.chuggy.v1+json",
  );
  assert.deepEqual(JSON.parse(api.calls[0].init.body), origination);
  assert.equal(textOf(answer), `HTTP 201\n${filed}`);
  assert.ok(answer.isError === undefined);
});

test("an origination the API refuses is relayed unaltered and never asked again", async () => {
  const body = JSON.stringify({ error: "StaleProjectSequence" });
  const { api, call } = toolsOf({}, () => ({ status: 409, body }));

  const answer = await call("create_draft", origination);

  assert.equal(textOf(answer), `HTTP 409\n${body}`);
  assert.equal(answer.isError, true);
  assert.equal(api.calls.length, 1);
});

test("an origination without the fence the route requires never reaches it", async () => {
  const { api, call } = toolsOf();

  for (const missing of [
    "configurationRevision",
    "configurationDigest",
    "expectedProjectSequence",
    "authoring",
    "brief",
  ]) {
    const answer = await call(
      "create_draft",
      Object.fromEntries(
        Object.entries(origination).filter(([field]) => field !== missing),
      ),
    );

    assert.equal(answer.isError, true, missing);
  }
  assert.equal(api.calls.length, 0);
});

test("origination is registered for a thread's roster and for no lead's", () => {
  const registered = (capabilities) =>
    chuggyToolDefinitions(
      chuggyToolContext(task, bearer, {
        capabilities,
        staging: leadDecisionStaging(),
      }),
    ).map(({ name }) => name);

  assert.ok(registered(["DraftOriginate"]).includes("create_draft"));
  assert.deepEqual(registered(["DraftOriginate"]), ["create_draft"]);
  assert.ok(
    !registered([...leadRoster]).includes("create_draft"),
    "a lead's roster registered the tool that files from nothing",
  );
});

/**
 * The reads whose route `src/adapters/http/server.ts` does not register.
 * Written here rather than read off the table under test, so a table that lost
 * an entry is a failure rather than a change of expectation.
 */
const unservedOnThisInstallation = [
  "read_decision_log",
  "read_refusals",
  "read_ticket_refusals",
  "read_lead",
  "read_lead_transcript",
];

test("the table names exactly the reads this installation does not serve", () => {
  assert.deepEqual(
    Object.keys(chuggyToolsNotYetServed).sort(),
    [...unservedOnThisInstallation].sort(),
  );
});

test("every tool whose route is unserved refuses before it asks, and no other does", async () => {
  const arguments_ = {
    list_drafts: {},
    read_decision_log: {},
    read_refusals: {},
    read_ticket_refusals: { ticket: 4 },
    read_lead: {},
    read_lead_transcript: {},
    list_threads: {},
    read_thread: { session: "t-1" },
    read_thread_transcript: { session: "t-1" },
    read_ticket: { ticket: 4 },
    list_tickets: {},
    read_operation: { operation: "o-1" },
    create_draft: origination,
  };
  for (const [name, args] of Object.entries(arguments_)) {
    const unserved = unservedOnThisInstallation.includes(name);
    const { api, call } = toolsOf();

    const answer = await call(name, args);

    assert.equal(answer.isError, unserved ? true : undefined, name);
    assert.equal(api.calls.length, unserved ? 0 : 1, name);
    if (unserved) {
      assert.ok(textOf(answer).length > 0, name);
      assert.equal(textOf(answer), chuggyToolsNotYetServed[name], name);
    }
  }
});

test("every tool the unserved table names is one the roster carries", () => {
  for (const name of unservedOnThisInstallation) {
    assert.ok(allChuggyTools.includes(name), name);
    assert.ok(
      (chuggyToolsNotYetServed[name] ?? "").length > 0,
      `${name} refuses with nothing`,
    );
  }
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
    "LeadDecision",
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
