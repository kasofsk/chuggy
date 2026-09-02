import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  allChuggyTools,
  chuggyOperationIdentity,
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolHandler,
  chuggyToolPrefix,
  chuggyToolServer,
  chuggyToolTimeoutMs,
  sessionAllowedTools,
  sessionBuiltInTools,
  sessionCapabilityTools,
} from "./chuggyTools.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";

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

test("a read cut at the bound says so rather than answering a broken body", async () => {
  const { call } = toolsOf({}, () => ({
    status: 200,
    body: "x".repeat(70_000),
  }));

  const answer = await call("read_ticket", { ticket: 7 });

  assert.match(textOf(answer), /\[cut at 65536 bytes\]$/);
});

test("each read reaches the route its roster names, and only it", async () => {
  const cases = [
    [["read_ticket", { ticket: 7 }], "/tickets/7"],
    [["read_draft", { ticket: 7 }], "/drafts/7"],
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
  ];
  for (const [[name, args], suffix] of cases) {
    const { api, call } = toolsOf();

    await call(name, args);

    assert.equal(
      api.calls[0].path,
      `/api/v1/tenants/vteng/projects/chuggy${suffix}`,
      name,
    );
  }
});

test("the project inventory is read outside the project's own path", async () => {
  const { api, call } = toolsOf();

  await call("read_projects", { limit: 3 });

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
  assert.equal(
    body.operation,
    chuggyOperationIdentity("turn-1", body.mutation),
    "the operation id is not derived from the turn and the command",
  );
  assert.equal(api.calls[0].init.headers["idempotency-key"], body.operation);
  assert.equal(textOf(answer), `HTTP 202\n${accepted}`);
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

test("listing drafts says which of the two is missing until the route is served", async () => {
  const { api, call } = toolsOf();

  const answer = await call("list_drafts", {});

  assert.equal(answer.isError, true);
  assert.match(textOf(answer), /not served/);
  assert.equal(api.calls.length, 0);
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
