import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  sessionTaskVariable,
  workerCredentialFilesVariable,
  workerRepositoriesVariable,
  workerTaskVariable,
  workerWorkspaceVariable,
} from "@chuggy/worker-contract/workerEnvironment";

import { workerCheckCommands } from "./checks.mjs";
import {
  prepareWorker,
  publishWorkerResult,
  reportWorkerFailure,
  runWorkerTask,
  workerCredential,
  workerMode,
  workerWorkspace,
} from "./entrypoint.mjs";
import { workerCredentialPath } from "./planeCredential.mjs";
import { credentialScrub, runEvidenceRecorder } from "./runEvidence.mjs";
import { ticketBranch } from "./source.mjs";

const task = { workerPlane: { url: "http://worker-plane.test:3001" } };
const secret = "sk-ant-oat01-0123456789abcdefghijklmnop";
const minted = {
  username: "x-access-token",
  password: "ghs_0123456789abcdefghijklmnopqrstuvwxyz",
};

/** The repository this attempt was placed against, as the launcher configured it. */
const repositories = {
  "repository-1": {
    url: "https://github.com/kasofsk/chuggy.git",
    credential: "forge",
    credentialUsername: "x-access-token",
  },
};
const credentialFiles = { forge: "/var/run/chuggy/credentials/forge" };

/**
 * One attempt asking the plane for its credential, with what the plane answers
 * and what the pod is authorized to mount if it does not.
 */
function askedFor(answer, credentials = ["forge"]) {
  const kept = [];
  const written = [];
  const paths = [];
  return {
    kept,
    written,
    paths,
    asked: {
      task: { ...task, authority: { credentials } },
      bearer: "capability",
      repositories,
      credentialFiles,
      repositoryId: "repository-1",
      keepSecret: (value) => kept.push(value),
      request: async (_task, _bearer, path) => {
        paths.push(path);
        return typeof answer === "function" ? answer() : answer;
      },
      write: async (file, content) => written.push({ file, content }),
    },
  };
}

function published(calls, request, scrub, run) {
  return publishWorkerResult(
    {
      task: { ...task, taskKind: "Evaluation" },
      bearer: "bearer",
      evidence: evidenceFor(request),
      scrub,
      stopLease: async () => calls.push({ path: "lease/stopped" }),
      request,
    },
    {},
    run ?? {
      output: {
        type: "result",
        structured_output: { summary: `saw ${secret}` },
      },
      result: { verdict: "Pass", summary: `the run saw ${secret}` },
      diagnosticPath: ".chuggy/agent-result.json",
    },
  );
}

function planeCalls() {
  const calls = [];
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
      calls.push({ path, init });
      return { ok: true, status: 204 };
    },
  };
}

function evidenceFor(request) {
  return runEvidenceRecorder(task, "bearer", (text) => text, {
    request,
    setInterval: () => ({ unref: () => undefined }),
    clearInterval: () => undefined,
    warn: () => undefined,
  });
}

test("the image carries every module the worker imports", async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const dockerfile = await readFile(join(directory, "Dockerfile"), "utf8");
  const modules = (await readdir(directory)).filter(
    (name) =>
      name.endsWith(".mjs") &&
      !name.endsWith(".test.mjs") &&
      !name.endsWith(".fixture.mjs"),
  );

  assert.ok(modules.includes("checks.mjs"), modules.join(" "));
  for (const name of modules) {
    assert.ok(
      dockerfile.includes(`COPY images/worker/${name} `),
      `${name} is imported by the worker and copied into no image`,
    );
  }
});

/** Catches the image and the work launcher naming the workspace apart, since that launcher writes none. */
test("the image names the workspace a work pod reads", async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const dockerfile = await readFile(join(directory, "Dockerfile"), "utf8");

  assert.match(dockerfile, new RegExp(`^ +${workerWorkspaceVariable}=`, "mu"));
});

/** The contract's schemas run under the image's zod in a pod and under the lockfile's in every suite here. */
test("the image installs the zod the suites run", async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const dockerfile = await readFile(join(directory, "Dockerfile"), "utf8");
  const lockfile = JSON.parse(
    await readFile(join(directory, "../../package-lock.json"), "utf8"),
  );

  assert.equal(
    /^ARG ZOD_VERSION=(\S+)$/mu.exec(dockerfile)?.[1],
    lockfile.packages["node_modules/zod"].version,
  );
});

test("exactly one task document is what a pod may be launched with", () => {
  assert.equal(workerMode({ [workerTaskVariable]: "{}" }), "Work");
  assert.equal(workerMode({ [sessionTaskVariable]: "{}" }), "Session");
  assert.throws(
    () =>
      workerMode({ [workerTaskVariable]: "{}", [sessionTaskVariable]: "{}" }),
    /never both/u,
  );
  assert.throws(() => workerMode({}), /needs one of/u);
  assert.throws(
    () => workerMode({ [workerTaskVariable]: "", [sessionTaskVariable]: "" }),
    /needs one of/u,
  );
});

/**
 * One pod launched as the image launches it, which is the only way into the
 * environment `main` reads: it is not exported, and nothing imports it.
 */
function launched(environment) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), "entrypoint.mjs")],
      {
        env: { PATH: process.env["PATH"] ?? "", ...environment },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

/**
 * A work task the scheduler placed with commands rather than an agent, whose
 * authority names no credential because no agent asks for one.
 */
function commandedWorkTask(authority = {}) {
  return JSON.stringify({
    taskKind: "Work",
    worker: { mode: { type: "Commands", commands: ["true"] } },
    authority: {
      network: true,
      filesystem: "WriteWorkspace",
      credentials: [],
      ...authority,
    },
  });
}

/** The refusal a pod launched without its credential map ends with. */
const credentialFilesMissing = new RegExp(
  `^${workerCredentialFilesVariable} is required$`,
  "mu",
);

test("a pod placed with an empty repository map is given an empty one", async () => {
  const ran = await launched({
    [workerTaskVariable]: commandedWorkTask(),
    [workerRepositoriesVariable]: "",
  });

  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    credentialFilesMissing,
    "the map stood empty and the launch went on to the next variable",
  );
});

/** Catches the pod reading its repository map under a name its launcher does not write. */
test("a pod placed with a repository map that is not one is refused", async () => {
  const ran = await launched({
    [workerTaskVariable]: commandedWorkTask(),
    [workerRepositoriesVariable]: "[]",
  });

  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /worker repositories must be an object/u);
});

/**
 * Admission reads the carrier, not the kind: a commanded work task mounts no
 * agent credential, so demanding one — as a pod that built an agent for every
 * Work task would — stops the launch before the variable below is ever read.
 */
test("a commanded work task is admitted with no agent credential mounted", async () => {
  const ran = await launched({ [workerTaskVariable]: commandedWorkTask() });

  assert.match(
    ran.stderr,
    credentialFilesMissing,
    "a commanded work task asked for something an agent's credential answers",
  );
});

/** Both halves of what a commanded work task must be granted before it runs. */
test("a commanded work task without network or workspace write is refused", async () => {
  const launches = [
    await launched({
      [workerTaskVariable]: commandedWorkTask({ network: false }),
    }),
    await launched({
      [workerTaskVariable]: commandedWorkTask({ filesystem: "ReadOnly" }),
    }),
  ];

  for (const ran of launches) {
    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /requires network and workspace write authority/u);
  }
});

/**
 * The setup lines of a block are narrowed with its commands. Catches the
 * document reaching the shell that runs in the workspace just before them,
 * which could leave it in a file for the commands to read.
 */
test("a setup line sees the pod's environment but not the task document", async () => {
  const database = "postgres://postgres@127.0.0.1:5432/postgres";
  Object.assign(process.env, {
    [workerTaskVariable]: "{}",
    [sessionTaskVariable]: "{}",
    CHUG_PG_URL: database,
  });
  const directory = await mkdtemp(join(tmpdir(), "chuggy-setup-"));
  try {
    const setup =
      `printf "%s|%s|%s" "\${${workerTaskVariable}-unset}" ` +
      `"\${${sessionTaskVariable}-unset}" "\${CHUG_PG_URL-unset}" > inherited`;

    await prepareWorker({ worker: { setup: [setup] } }, directory);

    assert.equal(
      await readFile(join(directory, "inherited"), "utf8"),
      `unset|unset|${database}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    for (const name of [workerTaskVariable, sessionTaskVariable, "CHUG_PG_URL"])
      delete process.env[name];
  }
});

test("a run that died posts its figures and ends the attempt", async () => {
  const { calls, request } = planeCalls();
  const evidence = evidenceFor(request);
  evidence.observed({
    type: "result",
    subtype: "error_max_turns",
    num_turns: 3,
    total_cost_usd: 0.25,
  });

  await reportWorkerFailure(
    { task, bearer: "bearer", evidence, request },
    "Claude Code exited 1",
  );

  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      "/v1/run/totals",
      "/v1/artifacts/.chuggy/worker-error.txt",
      "/v1/run/ended",
    ],
  );
  assert.equal(JSON.parse(calls[0].init.body).costUsdMicros, 250_000);
  assert.equal(JSON.parse(calls[0].init.body).turns, 3);
  assert.equal(
    JSON.parse(calls.at(-1).init.body).evidence,
    "RunTurnsExhausted",
  );
});

test("a run that died reports no verdict of its own", async () => {
  const { calls, request } = planeCalls();

  await reportWorkerFailure(
    { task, bearer: "bearer", evidence: evidenceFor(request), request },
    "worker failed",
  );

  assert.ok(!calls.some(({ path }) => path === "/v1/report"));
  assert.ok(
    !calls.some(({ init }) => String(init.body ?? "").includes('"Fail"')),
  );
});

test("an error text that cannot be uploaded still ends the attempt", async () => {
  const calls = [];
  const request = async (_task, _bearer, path, init) => {
    calls.push({ path, init });
    if (path.startsWith("/v1/artifacts/")) throw new Error("plane refused");
    return { ok: true, status: 204 };
  };

  await reportWorkerFailure(
    { task, bearer: "bearer", evidence: evidenceFor(request), request },
    "worker failed",
  );

  assert.equal(calls.at(-1).path, "/v1/run/ended");
});

test("the run's totals reach the plane before the report that settles the task", async () => {
  const { calls, request } = planeCalls();

  await published(calls, request, (text) => text);

  const paths = calls.map(({ path }) => path);
  assert.ok(paths.includes("/v1/run/totals"));
  assert.ok(paths.includes("/v1/report"));
  assert.ok(
    paths.indexOf("/v1/run/totals") < paths.indexOf("/v1/report"),
    `totals must precede the report, got ${paths.join(" ")}`,
  );
});

test("the report summary and the diagnostic artifact are scrubbed", async () => {
  const { calls, request } = planeCalls();

  await published(calls, request, credentialScrub([secret]));

  const summary = JSON.parse(
    calls.find(({ path }) => path === "/v1/report").init.body,
  ).report;
  const diagnostic = calls
    .find(({ path }) => path.endsWith("agent-result.json"))
    .init.body.toString("utf8");
  assert.ok(!summary.includes(secret));
  assert.ok(summary.includes("[redacted credential]"));
  assert.ok(!diagnostic.includes(secret));
  assert.ok(diagnostic.includes("[redacted credential]"));
});

test("a task carrying commands runs them and never reaches for an agent", async () => {
  const context = {
    directory: process.cwd(),
    get agent() {
      throw new Error("the agent was consulted for a check stage");
    },
  };

  const run = await runWorkerTask(context, ["exit 2"]);

  assert.equal(run.diagnosticPath, ".chuggy/check-output.json");
  assert.equal(run.result.verdict, "Fail");
  assert.equal(run.result.summary, "exit 2 exited 2");
});

/**
 * The carrier is the mode and never the kind. Catches a commanded run resolved
 * from `taskKind`, which would send a work task to an agent that refuses it and
 * leave an evaluation the only thing commands can run.
 */
test("a work task's commands are what runs it, and no agent is asked for", async () => {
  const commanded = {
    ...task,
    taskKind: "Work",
    worker: { mode: { type: "Commands", commands: ["exit 0"] } },
  };
  const commands = workerCheckCommands(commanded);

  const run = await runWorkerTask(
    {
      task: commanded,
      directory: process.cwd(),
      get agent() {
        throw new Error("a commanded work task reached for an agent");
      },
    },
    commands,
  );

  assert.deepEqual(commands, ["exit 0"]);
  assert.equal(run.result.verdict, "Pass");
  assert.equal(run.diagnosticPath, ".chuggy/check-output.json");
});

test("a check stage's report is scrubbed with the context's own scrub before it is measured", async () => {
  const context = {
    directory: process.cwd(),
    scrub: credentialScrub([secret]),
    get agent() {
      throw new Error("the agent was consulted for a check stage");
    },
  };

  const run = await runWorkerTask(context, [`echo ${secret}; exit 1`]);

  assert.equal(run.result.verdict, "Fail");
  assert.ok(!run.result.summary.includes(secret), run.result.summary);
  assert.ok(run.result.summary.includes("[redacted credential]"));
});

test("a check stage's captured output is the run's own diagnostic artifact", async () => {
  const { calls, request } = planeCalls();

  await published(calls, request, credentialScrub([secret]), {
    output: {
      checks: [{ command: ".chug/tasks/ci.sh", exitStatus: 2, output: secret }],
    },
    result: { verdict: "Fail", summary: ".chug/tasks/ci.sh exited 2" },
    diagnosticPath: ".chuggy/check-output.json",
  });

  const uploaded = calls.find(({ path }) => path.endsWith("check-output.json"));
  assert.ok(uploaded, calls.map(({ path }) => path).join(" "));
  const body = uploaded.init.body.toString("utf8");
  assert.ok(!body.includes(secret));
  assert.ok(body.includes(".chug/tasks/ci.sh"));
  assert.equal(
    JSON.parse(calls.find(({ path }) => path === "/v1/report").init.body)
      .report,
    ".chug/tasks/ci.sh exited 2",
  );
});

test("the failure text a crashed run uploads is scrubbed", async () => {
  const { calls, request } = planeCalls();

  await reportWorkerFailure(
    {
      task,
      bearer: "bearer",
      evidence: evidenceFor(request),
      request,
      scrub: credentialScrub([secret]),
    },
    `Claude Code exited 1 with ${secret}`,
  );

  const uploaded = calls
    .find(({ path }) => path.endsWith("worker-error.txt"))
    .init.body.toString("utf8");
  assert.ok(!uploaded.includes(secret));
  assert.ok(uploaded.includes("[redacted credential]"));
});

test("a minted credential is what git is given, and the mount is never read", async () => {
  const { asked, kept, written, paths } = askedFor(
    { status: 200, ok: true, json: async () => minted },
    [],
  );

  const resolved = await workerCredential(asked);

  assert.deepEqual(paths, [workerCredentialPath]);
  assert.equal(resolved.repository, repositories["repository-1"].url);
  assert.equal(
    resolved.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    written[0].file,
  );
  assert.equal(written[0].content, minted.password);
  assert.equal(
    resolved.environment.CHUG_WORKER_GIT_CREDENTIAL_USERNAME,
    minted.username,
  );
  assert.notEqual(
    resolved.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    credentialFiles.forge,
  );
  assert.deepEqual(kept, [minted.password]);
});

test("a minted repository the site names no map for is cloned at its own id", async () => {
  const { asked } = askedFor(
    { status: 200, ok: true, json: async () => minted },
    [],
  );

  const resolved = await workerCredential({
    ...asked,
    repositories: {},
    repositoryId: "https://github.com/kasofsk/chuggy.git",
  });

  assert.equal(resolved.repository, "https://github.com/kasofsk/chuggy.git");
});

test("a mounted repository the site names no map for is still refused", async () => {
  const { asked } = askedFor({
    status: 404,
    json: async () => ({ reason: "ForgeNotConfigured" }),
  });

  await assert.rejects(
    workerCredential({
      ...asked,
      repositories: {},
      repositoryId: "https://github.com/kasofsk/chuggy.git",
    }),
    /no repository configuration for https:\/\/github.com\/kasofsk\/chuggy.git/u,
  );
});

test("a plane that mints nothing leaves the launcher's mount answering", async () => {
  const { asked, kept, written } = askedFor({
    status: 404,
    json: async () => ({ reason: "ForgeNotConfigured" }),
  });

  const resolved = await workerCredential(asked);

  assert.equal(resolved.repository, repositories["repository-1"].url);
  assert.equal(
    resolved.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    credentialFiles.forge,
  );
  assert.equal(resolved.refresh, undefined);
  assert.deepEqual(written, []);
  assert.deepEqual(kept, []);
});

test("the mounted credential is still one the attempt's authority grants", async () => {
  const { asked } = askedFor(
    { status: 404, json: async () => ({ reason: "ForgeNotConfigured" }) },
    ["claude-code"],
  );

  await assert.rejects(
    workerCredential(asked),
    /worker authority does not grant forge/u,
  );
});

test("the push takes a fresh mint rather than the one the clone used", async () => {
  const later = "ghs_zyxwvutsrqponmlkjihgfedcba9876543210";
  let mints = 0;
  const { asked, kept } = askedFor(() => {
    mints += 1;
    return {
      status: 200,
      ok: true,
      json: async () => (mints === 1 ? minted : { ...minted, password: later }),
    };
  });

  const resolved = await workerCredential(asked);
  const refreshed = await resolved.refresh();

  assert.equal(mints, 2);
  assert.equal(refreshed.CHUG_WORKER_GIT_CREDENTIAL_USERNAME, minted.username);
  assert.deepEqual(kept, [minted.password, later]);
});

test("an outage at the clone fails the attempt rather than falling back", async () => {
  const { asked, written } = askedFor({
    status: 503,
    json: async () => ({ action: "retry" }),
  });

  await assert.rejects(
    workerCredential(asked),
    /answered 503 for a credential/u,
  );
  assert.deepEqual(written, []);
});

/**
 * One attempt's workspace, over a plane answering the input bundle and then the
 * mint. `clone` stands in for git, the directory it would have made being all
 * the workspace carries of it.
 */
function workspaceFrom(mint) {
  const asks = [];
  return workerWorkspace(
    { ...task, authority: { credentials: ["forge"] } },
    repositories,
    credentialFiles,
    "capability",
    () => undefined,
    {
      request: async (_task, _bearer, path) => {
        asks.push(path);
        if (path !== "/v1/input") return mint;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            references: [
              { kind: "Repository", reference: "repository-1" },
              { kind: "TargetCommit", reference: "0".repeat(40) },
            ],
          }),
        };
      },
      clone: async () => "/workspace/repository",
      write: async () => undefined,
    },
  );
}

test("a workspace the plane minted for carries the refresh its push takes", async () => {
  process.env[workerWorkspaceVariable] = "/workspace";

  const workspace = await workspaceFrom({
    status: 200,
    ok: true,
    json: async () => minted,
  });

  assert.equal(typeof workspace.refresh, "function");
  assert.equal(
    workspace.environment.CHUG_WORKER_GIT_CREDENTIAL_USERNAME,
    minted.username,
  );
});

test("a workspace the launcher's mount answered carries no refresh", async () => {
  process.env[workerWorkspaceVariable] = "/workspace";

  const workspace = await workspaceFrom({
    status: 404,
    json: async () => ({ reason: "ForgeNotConfigured" }),
  });

  assert.equal(workspace.refresh, undefined);
  assert.equal(
    workspace.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    credentialFiles.forge,
  );
});

/** The attempt every work case below publishes, and the branch its push names. */
const workAttempt = { taskKind: "Work", ticket: 7, attempt: "attempt-1" };
const workCommit = "a".repeat(40);
const pushCredential = { CHUG_WORKER_GIT_CREDENTIAL_FILE: "/minted/at-push" };

/** The two carriers a work attempt can have run under. */
const commandedWorker = {
  mode: { type: "Commands", commands: [".chug/tasks/ci.sh"] },
};
const agentWorker = {
  mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
};

/**
 * One finished work attempt reaching the plane, with git stood in for by a
 * recorder: what the push would have run, and what the report carried.
 */
async function workPublished(worker, run) {
  const runs = [];
  const { calls, request } = planeCalls();
  await publishWorkerResult(
    {
      task: { ...task, ...workAttempt, worker },
      bearer: "bearer",
      evidence: evidenceFor(request),
      scrub: (text) => text,
      stopLease: async () => calls.push({ path: "lease/stopped" }),
      request,
      command: async (executable, args, options) => {
        runs.push({ executable, args, options });
        return { stdout: `${workCommit}\n` };
      },
    },
    {
      repositoryId: "repository-1",
      repository: repositories["repository-1"].url,
      base: "0".repeat(40),
      directory: "/workspace/repository",
      environment: { CHUG_WORKER_GIT_CREDENTIAL_FILE: "/minted/at-clone" },
      refresh: async () => pushCredential,
    },
    run,
  );
  return { runs, reported: JSON.parse(reportedBody(calls)) };
}

function reportedBody(calls) {
  return calls.find(({ path }) => path === "/v1/report").init.body;
}

/** The one git invocation of a verb the attempt made, and a legible miss where it made none. */
function gitRun(runs, verb) {
  const ran = runs.find(({ args }) => args[0] === verb);
  assert.ok(ran, `the attempt ran no git ${verb}`);
  return ran;
}

/** What a commanded stage hands the publisher, its exit status being its verdict. */
function commandedRun(exitStatus) {
  return {
    output: { checks: [{ command: ".chug/tasks/ci.sh", exitStatus }] },
    result: {
      verdict: exitStatus === 0 ? "Pass" : "Fail",
      summary: `.chug/tasks/ci.sh exited ${String(exitStatus)}`,
    },
    diagnosticPath: ".chuggy/check-output.json",
  };
}

test("a passing work attempt pushes under the credential its workspace refreshes", async () => {
  const { runs } = await workPublished(agentWorker, {
    output: { type: "result", structured_output: { summary: "done" } },
    result: { verdict: "Pass", summary: "the attempt passed" },
    diagnosticPath: ".chuggy/agent-result.json",
  });

  assert.deepEqual(gitRun(runs, "push").options.env, pushCredential);
});

/**
 * A commanded work attempt leaves the same candidate an agent's would. Catches a
 * push keyed on what ran rather than on the task's kind and verdict, and a
 * commit that stopped being `--allow-empty` or stopped naming the attempt.
 */
test("a passing commanded work attempt commits and pushes what it declares", async () => {
  const { runs, reported } = await workPublished(
    commandedWorker,
    commandedRun(0),
  );

  assert.deepEqual(gitRun(runs, "commit").args, [
    "commit",
    "--allow-empty",
    "-m",
    "ticket 7 attempt attempt-1",
  ]);
  const push = gitRun(runs, "push");
  assert.deepEqual(push.args, [
    "push",
    repositories["repository-1"].url,
    `HEAD:${ticketBranch(workAttempt)}`,
  ]);
  assert.deepEqual(push.options.env, pushCredential);
  assert.deepEqual(reported.source, {
    repository: "repository-1",
    ref: ticketBranch(workAttempt),
    commit: workCommit,
    base: "0".repeat(40),
  });
});

/**
 * The commands' exit status is the work's success, and a failed one leaves
 * nothing behind. Catches a push that stopped reading the verdict: the plane
 * refuses a source on a Fail, so the attempt would crash rather than fail.
 */
test("a failing commanded work attempt pushes nothing and declares no source", async () => {
  const { runs, reported } = await workPublished(
    commandedWorker,
    commandedRun(1),
  );

  assert.deepEqual(runs, []);
  assert.equal(reported.verdict, "Fail");
  assert.equal(reported.source, undefined);
});

test("a plane that stops minting mid-attempt fails it rather than pushing with a mount", async () => {
  let mints = 0;
  const { asked } = askedFor(() => {
    mints += 1;
    return mints === 1
      ? { status: 200, ok: true, json: async () => minted }
      : { status: 404, json: async () => ({ reason: "NotMinted" }) };
  });

  const resolved = await workerCredential(asked);

  await assert.rejects(resolved.refresh(), /mints no credential to push with/u);
});
