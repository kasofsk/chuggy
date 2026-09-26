/**
 * The pod held to the contract it imports, from its own side: each status a
 * route it calls may answer is driven through the caller that reads it, the
 * documents it writes are read by the contract's schemas, and the tools it
 * offers are the contract's roster under the contract's capabilities.
 *
 * WHAT A STATUS DOES IS WRITTEN HERE, NOT DERIVED. Each table names what the pod
 * does with every status of every route it calls, and must name exactly the
 * statuses the contract's map does: a status the plane starts answering is a
 * reaction nobody chose until this suite is told it.
 */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import test, { mock } from "node:test";
import { URL } from "node:url";

import {
  sessionCapabilities,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "@chuggy/worker-contract/sessionPlane";
import {
  allChuggyTools,
  builtInToolCapabilities,
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPrefix,
  chuggyToolRoutes,
  chuggyToolServerName,
} from "@chuggy/worker-contract/sessionTools";
import {
  leadDecisionDocumentSchema,
  resultManifestDocumentSchema,
  resultReportCharsMax,
} from "@chuggy/worker-contract/workerDocuments";
import { contractVersionRefusalStatus } from "@chuggy/worker-contract/workerContract";
import { workerWorkspaceVariable } from "@chuggy/worker-contract/workerEnvironment";
import { z } from "zod";

import {
  chuggyProjectTools,
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolHandler,
  sessionAllowedTools,
  sessionBuiltInTools,
} from "./chuggyTools.mjs";
import { publishWorkerResult, workerWorkspace } from "./entrypoint.mjs";
import { heartbeatIntervalMilliseconds, keepWorkerLease } from "./lease.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";
import {
  planeCredential,
  sessionCredentialPath,
  workerCredentialPath,
} from "./planeCredential.mjs";
import {
  overPlane,
  planeFetch,
  planes,
  refusalBodies,
  versionRefusal,
} from "./plane.fixture.mjs";
import { runEvidenceRecorder } from "./runEvidence.mjs";
import { sessionLease } from "./session.mjs";
import {
  bearer,
  facts,
  mintedCredential,
  queryOf,
  rejection,
  result,
  run,
  task as sessionTask,
  turnOne,
} from "./sessionHarness.fixture.mjs";
import { sessionMailbox } from "./sessionMailbox.mjs";
import { sessionStoreAdapter } from "./sessionStore.mjs";
import { sessionRequest } from "./sessionTransport.mjs";
import { workerRequest } from "./transport.mjs";

const jobTask = {
  taskKind: "Evaluation",
  ticket: 7,
  attempt: "attempt-1",
  workerPlane: { url: "http://worker-plane.test:3001" },
};

/** The repository a job's input bundle names, and the base it pins. */
const repositories = {
  "repository-1": { url: "https://github.com/kasofsk/chuggy.git" },
};
const base = "0".repeat(40);

/** What each job route answers when it is not the one a case is about. */
function jobSuccess(route) {
  switch (route) {
    case "input":
      return {
        status: 200,
        body: {
          bundle: "bundle-1",
          digest: "0".repeat(64),
          references: [
            { ordinal: 1, kind: "Repository", reference: "repository-1" },
            { ordinal: 2, kind: "TargetCommit", reference: base },
          ],
        },
      };
    case "report":
      return { status: 202, body: { action: "stop" } };
    case "runTurns":
      return { status: 200, body: { turnsRecorded: 1 } };
    case "credential":
      return { status: 200, body: mintedCredential };
    default:
      return { status: 204 };
  }
}

/** What each session route answers when it is not the one a case is about. */
function sessionSuccess(route, nth) {
  switch (route) {
    case "facts":
      return { status: 200, body: facts };
    case "turn":
      return nth === 1 ? { status: 200, body: turnOne } : { status: 204 };
    case "credential":
      return { status: 200, body: mintedCredential };
    case "storeStreams":
      return { status: 200, body: { streams: [] } };
    case "storePage":
      return { status: 200, body: { batches: [] } };
    default:
      return { status: 204 };
  }
}

/** A run whose one assistant turn reaches every run route the recorder writes. */
async function recorded(request) {
  const recorder = runEvidenceRecorder(jobTask, bearer, (text) => text, {
    request,
    setInterval: () => ({ unref: () => undefined }),
    clearInterval: () => undefined,
    warn: () => undefined,
  });
  const event = {
    type: "assistant",
    message: { model: "claude-test", usage: { input_tokens: 1 } },
  };
  await recorder.record(JSON.stringify(event), event);
  await recorder.finish();
  return recorder;
}

/** A finished evaluation reaching the plane: its diagnostic uploaded and its manifest reported. */
function published(request, verdict = "Pass", summary = "the checks passed") {
  return publishWorkerResult(
    {
      task: jobTask,
      bearer,
      evidence: { finish: async () => undefined },
      scrub: (text) => text,
      stopLease: async () => undefined,
      request,
    },
    {},
    {
      output: { checks: [] },
      result: { verdict, summary },
      diagnosticPath: ".chuggy/check-output.json",
    },
  );
}

/**
 * The caller of each job route, and whether it carried on. Every one reaches
 * the plane through `workerRequest`, the transport a job pod is given.
 */
const jobCallers = {
  input: async (request) => {
    process.env[workerWorkspaceVariable] = "/workspace";
    await workerWorkspace(jobTask, repositories, {}, bearer, () => undefined, {
      request,
      clone: async () => "/workspace/repository",
      write: async () => undefined,
    });
  },
  heartbeat: async (request) => {
    const stop = keepWorkerLease(jobTask, bearer, {
      request,
      setInterval: (beat) => {
        beat();
        return 0;
      },
      clearInterval: () => undefined,
    });
    await stop();
  },
  artifact: published,
  report: published,
  runConfiguration: async (request) => {
    const recorder = await recorded(request);
    await recorder.configuration(Buffer.from("{}"));
  },
  runTranscript: recorded,
  runTurns: recorded,
  runTotals: recorded,
  runEnded: async (request) => {
    const recorder = await recorded(request);
    await recorder.ended();
  },
  credential: (request) =>
    planeCredential({
      task: jobTask,
      bearer,
      path: workerCredentialPath,
      request,
      write: async () => undefined,
    }),
};

/** A session pod run end to end, carrying on where it exits cleanly. */
function sessionRun(script) {
  return async (request) => {
    const code = await run({ request, query: queryOf(script).query });
    if (code !== 0) throw new Error(`the session exited ${String(code)}`);
  };
}

const answeredTurn = sessionRun(() => [
  { type: "system", subtype: "init", session_id: "runtime-1" },
  result("success", { result: "ok" }),
]);

/** The caller of each session route, reached through `sessionRequest`. */
const sessionCallers = {
  facts: answeredTurn,
  heartbeat: async (request) => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const stop = sessionLease(sessionTask, bearer, request);
      mock.timers.tick(heartbeatIntervalMilliseconds);
      await stop();
    } finally {
      mock.timers.reset();
    }
  },
  reference: answeredTurn,
  turn: async (request) => {
    const turns = sessionMailbox(sessionTask, bearer, {
      request,
      wait: async () => undefined,
    }).turns();
    if ((await turns.next()).done) throw new Error("the mailbox stopped");
  },
  turnAnswer: answeredTurn,
  turnFailure: sessionRun(() => [result("error_during_execution")]),
  held: sessionRun(() => [rejection, result("error_during_execution")]),
  storeStreams: (request) =>
    sessionStoreAdapter(sessionTask, bearer, { request }).listSubkeys({
      sessionId: "runtime-1",
    }),
  storeBatch: (request) =>
    sessionStoreAdapter(sessionTask, bearer, { request }).append(
      { sessionId: "runtime-1" },
      [{ uuid: "a", type: "assistant" }],
    ),
  storePage: (request) =>
    sessionStoreAdapter(sessionTask, bearer, { request }).load({
      sessionId: "runtime-1",
    }),
  credential: (request) =>
    planeCredential({
      task: sessionTask,
      bearer,
      path: sessionCredentialPath,
      repository: "https://github.com/kasofsk/chuggy.git",
      request,
      write: async () => undefined,
    }),
};

/**
 * What one caller did when `route` gave `answer` once, every other ask
 * answering as it does on success: `reads` where it carried on after one ask,
 * `stops` where it gave up after one, and `retries` where it asked again.
 */
async function reaction(wire, success, transport, caller, route, answer) {
  const counts = new Map();
  const plane = planeFetch(wire, (asked) => {
    const nth = (counts.get(asked) ?? 0) + 1;
    counts.set(asked, nth);
    const succeeded = success(asked, nth);
    return asked !== route || nth > 1 || answer.status === succeeded.status
      ? succeeded
      : answer;
  });
  const carried = await caller(overPlane(transport, plane.fetch)).then(
    () => true,
    () => false,
  );
  const asks = counts.get(route) ?? 0;
  if (asks === 0) return "unreached";
  if (asks > 1) return "retries";
  return carried ? "reads" : "stops";
}

/** Every status of every job route the pod calls. */
const jobReactions = {
  input: { 200: "reads", 401: "stops", 409: "stops" },
  heartbeat: { 204: "reads", 401: "stops", 409: "stops" },
  artifact: {
    204: "reads",
    400: "stops",
    401: "stops",
    409: "stops",
    413: "stops",
    415: "stops",
    503: "retries",
  },
  report: {
    202: "reads",
    400: "stops",
    401: "stops",
    409: "stops",
    503: "retries",
  },
  runConfiguration: {
    204: "reads",
    400: "reads",
    401: "reads",
    409: "reads",
    413: "reads",
    415: "reads",
    503: "retries",
  },
  runTranscript: {
    204: "reads",
    400: "reads",
    401: "reads",
    409: "reads",
    413: "reads",
    415: "reads",
    503: "retries",
  },
  runTurns: { 200: "reads", 400: "reads", 401: "reads", 409: "reads" },
  runTotals: {
    204: "reads",
    400: "reads",
    401: "reads",
    409: "reads",
    413: "reads",
  },
  runEnded: { 204: "reads", 400: "stops", 401: "stops", 409: "stops" },
  credential: {
    200: "reads",
    401: "stops",
    404: "reads",
    409: "stops",
    503: "retries",
  },
};

/** The job routes a pod does not call. */
const jobRoutesUncalled = ["task"];

/** Every status of every session route the pod calls. */
const sessionReactions = {
  facts: { 200: "reads", 401: "stops", 409: "stops" },
  heartbeat: { 204: "reads", 401: "stops", 409: "stops" },
  reference: { 204: "reads", 400: "stops", 401: "stops", 409: "stops" },
  turn: { 200: "reads", 204: "retries", 401: "stops", 409: "stops" },
  turnAnswer: { 204: "reads", 400: "stops", 401: "stops", 409: "stops" },
  turnFailure: { 204: "reads", 400: "stops", 401: "stops", 409: "stops" },
  held: { 204: "reads", 401: "stops", 409: "stops" },
  storeStreams: {
    200: "reads",
    400: "stops",
    401: "stops",
    409: "stops",
    413: "stops",
  },
  storeBatch: {
    204: "reads",
    400: "stops",
    401: "stops",
    409: "stops",
    413: "stops",
    415: "stops",
    503: "retries",
  },
  storePage: {
    200: "reads",
    400: "stops",
    401: "stops",
    409: "stops",
    503: "retries",
  },
  credential: {
    200: "reads",
    400: "stops",
    401: "stops",
    404: "reads",
    409: "stops",
    503: "retries",
  },
};

/** Each way `route` may answer `status`: its success where that is what it is, and otherwise once for every body the status carries. */
function answersOf(wire, success, route, status) {
  const schema = wire.answers[route][status];
  if (schema === "empty" || success(route, 1).status === status)
    return [{ status }];
  return refusalBodies(schema).map((body) => ({ status, body }));
}

/** Each table's statuses against the map's, and each driven through its caller. */
async function heldToMap(
  wire,
  reactions,
  uncalled,
  callers,
  success,
  transport,
) {
  assert.deepEqual(
    [...Object.keys(reactions), ...uncalled].sort(),
    Object.keys(wire.answers).sort(),
    "a route the contract names is neither driven nor named as uncalled",
  );
  for (const [route, statuses] of Object.entries(reactions)) {
    assert.deepEqual(
      Object.keys(statuses),
      Object.keys(wire.answers[route]),
      `${route} answers statuses this suite does not name`,
    );
    for (const [status, expected] of Object.entries(statuses))
      for (const answer of answersOf(wire, success, route, Number(status)))
        assert.equal(
          await reaction(
            wire,
            success,
            transport,
            callers[route],
            route,
            answer,
          ),
          expected,
          `${route} answering ${status} ${JSON.stringify(answer.body)}`,
        );
  }
}

test("every status a job route the pod calls may answer is one the pod has a named reaction to", async () => {
  await heldToMap(
    planes.job,
    jobReactions,
    jobRoutesUncalled,
    jobCallers,
    jobSuccess,
    workerRequest,
  );
});

test("every status a session route the pod calls may answer is one the pod has a named reaction to", async () => {
  await heldToMap(
    planes.session,
    sessionReactions,
    [],
    sessionCallers,
    sessionSuccess,
    sessionRequest,
  );
});

/**
 * A plane that serves no version this pod speaks, refusing every call: no
 * route is asked twice, and the first call each kind of pod makes ends it.
 */
test("a plane refusing the pod's release is asked once per route, and the pod stops", async () => {
  for (const [wire, callers, transport, first] of [
    [planes.job, jobCallers, workerRequest, "input"],
    [planes.session, sessionCallers, sessionRequest, "facts"],
  ])
    for (const [route, caller] of Object.entries(callers)) {
      const asked = [];
      const plane = planeFetch(wire, (named) => {
        asked.push(named);
        return { status: contractVersionRefusalStatus, body: versionRefusal };
      });
      const carried = await caller(overPlane(transport, plane.fetch)).then(
        () => true,
        () => false,
      );
      assert.ok(asked.length > 0, `${route} reached no route`);
      assert.deepEqual(asked, [...new Set(asked)], `${route} asked again`);
      if (route === first) assert.equal(carried, false, `${route} carried on`);
    }
});

/** The manifest one finished attempt reported, as the plane was offered it. */
async function reportedManifest(publish) {
  const reported = [];
  const plane = planeFetch(planes.job, (route, asked) => {
    if (route === "report") reported.push(asked.body);
    return jobSuccess(route);
  });
  await publish(overPlane(workerRequest, plane.fetch));
  assert.equal(reported.length, 1);
  return reported[0];
}

/**
 * The writer driven, not a document built beside it: an evaluation's manifest
 * with a report at its bound, and a passing work attempt's with the source its
 * push left.
 */
test("the manifest the pod reports is one the contract's manifest schema reads", async () => {
  const evaluation = await reportedManifest((request) =>
    published(request, "Fail", "x".repeat(resultReportCharsMax)),
  );
  resultManifestDocumentSchema.parse(evaluation);
  assert.equal(evaluation.report.length, resultReportCharsMax);

  const work = await reportedManifest((request) =>
    publishWorkerResult(
      {
        task: { ...jobTask, taskKind: "Work" },
        bearer,
        evidence: { finish: async () => undefined },
        scrub: (text) => text,
        stopLease: async () => undefined,
        request,
        command: async () => ({ stdout: `${"a".repeat(40)}\n` }),
      },
      {
        repositoryId: "repository-1",
        repository: repositories["repository-1"].url,
        base,
        directory: "/workspace/repository",
        environment: {},
      },
      {
        output: {},
        result: { verdict: "Pass", summary: "done" },
        diagnosticPath: ".chuggy/agent-result.json",
      },
    ),
  );
  resultManifestDocumentSchema.parse(work);
  assert.equal(work.source.repository, "repository-1");
});

/** An observation offering one ticket to dispatch and one to refuse. */
const observation = JSON.stringify({
  version: 1,
  decision: "decision-1",
  partition: { tenant: "vteng", project: "chuggy" },
  changes: [],
  candidates: [
    { ticket: 4, ticketVersion: 2 },
    { ticket: 5, ticketVersion: 1 },
  ],
  token: {},
  operationalContext: {},
  refusals: [{ ticket: 6, ticketVersion: 1, reason: "later" }],
});

test("the decision every decision tool composes is one the contract's decision schema reads", async () => {
  const staging = leadDecisionStaging();
  staging.reset(observation);
  const call = (name, args) =>
    chuggyToolHandler(
      staging.definitions.find((definition) => definition.name === name),
      z,
    )(args);
  const calls = {
    dispatch: { ticket: 4, expectedTicketVersion: 2 },
    refuse: { ticket: 5, ticketVersion: 1, reason: "later" },
    lift: { ticket: 6 },
    set_attention: { attention: "Attention" },
    set_handoff_note: { note: { carried: "on" } },
    set_planning_intent: { intent: { next: "ticket 7" } },
  };

  assert.deepEqual(Object.keys(calls), [
    ...chuggyToolCapabilities.LeadDecision,
  ]);
  for (const [name, args] of Object.entries(calls)) {
    const answer = await call(name, args);
    assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
  }
  leadDecisionDocumentSchema.parse(staging.document());
});

/** Every field a project tool requires, so one argument set drives each tool to its route. */
const everyToolArgument = {
  ticket: 7,
  parent: 7,
  relation: "FollowUp",
  revision: "r-1",
  execution: "e-1",
  attempt: "a-1",
  operation: "o-1",
  session: "s-1",
  expectedVersion: 1,
  authoringVersion: 1,
  configurationRevision: "r-1",
  configurationDigest: "d-1",
  expectedProjectSequence: 1,
  authoring: { dependencies: [7] },
  brief: {},
};

/** The routes of the tools' table one path matches. */
function toolRoutesMatching(pathname) {
  return Object.entries(chuggyToolRoutes)
    .filter(([, pattern]) =>
      new RegExp(`^${pattern.replace(/:[A-Za-z]+/gu, "[^/]+")}$`, "u").test(
        pathname,
      ),
    )
    .map(([name]) => name);
}

test("the pod's tools reach exactly the routes the contract gives them", async () => {
  const reached = new Set();
  for (const definition of chuggyProjectTools) {
    const paths = [];
    const context = chuggyToolContext(
      { tenant: "t-1", project: "p-1", api: { url: "https://api.test" } },
      bearer,
      {
        request: async (_task, _bearer, path) => {
          paths.push(new URL(path, "https://api.test").pathname);
          return { status: 200, text: async () => "{}" };
        },
        turn: () => "turn-1",
      },
    );

    await chuggyToolHandler(
      { ...definition, call: (args) => definition.call(context, args) },
      z,
    )(everyToolArgument);

    assert.equal(paths.length, 1, definition.name);
    const matched = toolRoutesMatching(paths[0]);
    assert.equal(matched.length, 1, `${definition.name} asked ${paths[0]}`);
    reached.add(matched[0]);
  }
  assert.deepEqual([...reached].sort(), Object.keys(chuggyToolRoutes).sort());
});

/** The tool names one roster registers, off the pod's own server definitions. */
function registered(capabilities) {
  return chuggyToolDefinitions(
    chuggyToolContext(sessionTask, bearer, {
      capabilities,
      staging: leadDecisionStaging(),
    }),
  ).map(({ name }) => name);
}

/** Every roster the contract's capabilities make, the empty one included. */
function everyRoster() {
  return Array.from({ length: 2 ** sessionCapabilities.length }, (_, subset) =>
    sessionCapabilities.filter((_, index) => ((subset >> index) & 1) === 1),
  );
}

test("the pod defines every tool the contract rosters, and no other", () => {
  const defined = [
    ...chuggyProjectTools.map(({ name }) => name),
    ...leadDecisionStaging().definitions.map(({ name }) => name),
  ];

  assert.deepEqual([...defined].sort(), [...allChuggyTools].sort());
  assert.deepEqual(
    leadDecisionStaging().definitions.map(({ name }) => name),
    [...chuggyToolCapabilities.LeadDecision],
  );
});

/**
 * Over every roster there is, not the two this installation opens sessions
 * with: what a session is opened with is the provisioning root's, and the pod
 * must be right for whichever it is handed.
 */
test("every roster registers, allows and disallows exactly what the contract's capabilities admit", () => {
  const every = [
    ...sessionBuiltInTools,
    ...allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  ];
  for (const roster of everyRoster()) {
    const named = roster.join(",") || "no capability";
    const admitted = new Set([
      ...roster.flatMap((capability) => builtInToolCapabilities[capability]),
      ...chuggyToolNames(roster),
    ]);
    const { allowedTools, disallowedTools } = sessionAllowedTools(roster);

    assert.deepEqual(new Set(allowedTools), admitted, named);
    assert.deepEqual(
      [...allowedTools, ...disallowedTools].sort(),
      [...every].sort(),
      named,
    );
    assert.deepEqual(
      registered(roster)
        .map((tool) => `${chuggyToolPrefix}${tool}`)
        .sort(),
      [...chuggyToolNames(roster)].sort(),
      named,
    );
  }
});

test("every built-in a capability admits is one the pod names, and the runtime names the server's tools by its prefix", () => {
  for (const [capability, tools] of Object.entries(builtInToolCapabilities))
    for (const tool of tools)
      assert.ok(sessionBuiltInTools.includes(tool), `${capability}: ${tool}`);
  assert.equal(chuggyToolPrefix, `mcp__${chuggyToolServerName}__`);
});

test("every tool a session may be offered fits one measured turn's tool list", () => {
  const names = [
    ...sessionBuiltInTools,
    ...allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  ];

  assert.ok(
    names.length <= sessionTurnToolsMax,
    `a session may report ${String(names.length)} tools and a turn records ${String(sessionTurnToolsMax)}`,
  );
  for (const name of names)
    assert.ok(
      name.length <= sessionTurnToolNameCharsMax,
      `${name} is longer than a recorded tool name holds`,
    );
});
