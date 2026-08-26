import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

import { claudeInvocation, claudeResult } from "./claude.mjs";
import { keepWorkerLease } from "./lease.mjs";
import { startLocalPostgres } from "./postgres.mjs";
import { commitAndPushSource, resultDocument } from "./source.mjs";
import { workerRequest } from "./transport.mjs";

const executeFile = promisify(execFile);
let activeTask;
let activeBearer;

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function parsed(name) {
  return JSON.parse(required(name));
}

function oneReference(input, kind) {
  const references = input.references.filter(
    (reference) => reference.kind === kind,
  );
  if (references.length !== 1)
    throw new Error(`input bundle must carry one ${kind}`);
  return references[0].reference;
}

async function command(executable, args, options = {}) {
  return executeFile(executable, args, {
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

async function cloneRepository(repository, commit, workspace) {
  const directory = join(workspace, "repository");
  const environment = {
    ...process.env,
    GIT_ASKPASS: "/usr/local/lib/chuggy/git-askpass.sh",
    GIT_TERMINAL_PROMPT: "0",
  };
  await command("git", ["clone", "--no-checkout", repository, directory], {
    env: environment,
  });
  await command("git", ["checkout", "--detach", commit], {
    cwd: directory,
    env: environment,
  });
  return directory;
}

function workspaceFile(directory, path) {
  const target = resolve(directory, path);
  const within = relative(directory, target);
  if (within.length === 0 || within.startsWith("..") || within.startsWith("/"))
    throw new Error(`worker setup path escapes the repository: ${path}`);
  return target;
}

async function prepareWorker(task, directory) {
  for (const file of task.worker?.files ?? []) {
    const target = workspaceFile(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
  for (const setup of task.worker?.setup ?? []) {
    await command("/bin/sh", ["-eu", "-c", setup], { cwd: directory });
  }
}

async function runClaude(task, directory) {
  const token = (
    await readFile("/var/run/chuggy/credentials/claude-code", "utf8")
  ).trim();
  const child = spawn("claude", claudeInvocation(task), {
    cwd: directory,
    env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) =>
      resolve([exitCode, exitSignal]),
    );
  });
  let resultEvent;
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    process.stdout.write(`${line}\n`);
    try {
      const event = JSON.parse(line);
      if (event?.type === "result" && event.structured_output !== undefined)
        resultEvent = event;
    } catch {
      throw new Error("Claude Code emitted invalid streaming JSON");
    }
  }
  const [code, signal] = await exited;
  if (code !== 0)
    throw new Error(
      `Claude Code exited ${code ?? `after signal ${signal ?? "unknown"}`}`,
    );
  return claudeResult([resultEvent]);
}

function artifact(path, content) {
  return {
    path,
    digest: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  };
}

async function upload(task, bearer, path, content) {
  await workerRequest(task, bearer, `/v1/artifacts/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: content,
  });
  return artifact(path, content);
}

async function workSource(
  task,
  repositoryId,
  repository,
  base,
  directory,
  verdict,
) {
  if (task.taskKind !== "Work" || verdict !== "Pass") return undefined;
  const environment = {
    ...process.env,
    GIT_ASKPASS: "/usr/local/lib/chuggy/git-askpass.sh",
    GIT_TERMINAL_PROMPT: "0",
  };
  return commitAndPushSource({
    task,
    repositoryId,
    repository,
    base,
    directory,
    command,
    environment,
  });
}

async function diagnostic(task, bearer, result) {
  const content = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  return upload(task, bearer, ".chuggy/claude-result.json", content);
}

async function report(task, bearer, manifest) {
  await workerRequest(task, bearer, "/v1/report", {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: JSON.stringify(resultDocument(manifest)),
  });
}

async function main() {
  const task = parsed("CHUG_WORKER_TASK");
  activeTask = task;
  for (const credential of ["chuggy-git-worker", "claude-code"])
    if (!task.authority.credentials.includes(credential))
      throw new Error(`worker authority does not grant ${credential}`);
  if (!task.authority.network || task.authority.filesystem !== "WriteWorkspace")
    throw new Error(
      "development worker requires network and workspace write authority",
    );
  const repositories = parsed("CHUG_WORKER_REPOSITORIES");
  const bearer = (
    await readFile(task.workerPlane.capabilityFile, "utf8")
  ).trim();
  activeBearer = bearer;
  const stopLease = keepWorkerLease(task, bearer);
  let stopPostgres = async () => undefined;
  try {
    const input = await (await workerRequest(task, bearer, "/v1/input")).json();
    const repositoryId = oneReference(input, "Repository");
    const repository = repositories[repositoryId];
    if (typeof repository !== "string")
      throw new Error(`no repository location for ${repositoryId}`);
    const base = oneReference(input, "TargetCommit");
    const directory = await cloneRepository(
      repository,
      base,
      required("CHUG_WORKER_WORKSPACE"),
    );
    stopPostgres = await startLocalPostgres(required("CHUG_WORKER_WORKSPACE"));
    await prepareWorker(task, directory);
    const { output, result } = await runClaude(task, directory);
    const source = await workSource(
      task,
      repositoryId,
      repository,
      base,
      directory,
      result.verdict,
    );
    const diagnostics = [await diagnostic(task, bearer, output)];
    await stopLease();
    await report(task, bearer, {
      verdict: result.verdict,
      handoffs: [],
      ...(source === undefined ? {} : { source }),
      diagnostics,
    });
  } finally {
    try {
      await stopPostgres();
    } finally {
      await stopLease();
    }
  }
}

main().catch(async (failure) => {
  const message = failure instanceof Error ? failure.message : "worker failed";
  process.stderr.write(`${message}\n`);
  if (activeTask !== undefined && activeBearer !== undefined) {
    try {
      const error = await upload(
        activeTask,
        activeBearer,
        ".chuggy/worker-error.txt",
        Buffer.from(`${message}\n`),
      );
      await report(activeTask, activeBearer, {
        verdict: "Fail",
        handoffs: [],
        diagnostics: [error],
      });
    } catch {
      process.stderr.write("worker failure could not be reported\n");
    }
  }
  process.exitCode = 1;
});
