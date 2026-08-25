import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { URL } from "node:url";

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

async function workerRequest(task, bearer, path, init = {}) {
  const response = await globalThis.fetch(new URL(path, task.workerPlane.url), {
    ...init,
    headers: { authorization: `Bearer ${bearer}`, ...init.headers },
  });
  if (!response.ok)
    throw new Error(`worker plane ${path} answered ${String(response.status)}`);
  return response;
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

const resultSchema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary"],
  properties: {
    verdict: { enum: ["Pass", "Fail"] },
    summary: { type: "string" },
  },
});

const reservedClaudeArguments = [
  "-p",
  "--print",
  "--output-format",
  "--input-format",
  "--json-schema",
  "--permission-mode",
  "--dangerously-skip-permissions",
  "--mcp-config",
  "--strict-mcp-config",
  "--cwd",
  "--add-dir",
  "--worktree",
  "--resume",
  "--continue",
];

function claudeArguments(task) {
  const args = task.worker?.arguments ?? [];
  for (const argument of args) {
    if (
      reservedClaudeArguments.some(
        (reserved) =>
          argument === reserved || argument.startsWith(`${reserved}=`),
      )
    )
      throw new Error(
        `worker configuration reserves Claude argument ${argument}`,
      );
  }
  return args;
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
  const { stdout } = await command(
    "claude",
    [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      resultSchema,
      "--permission-mode",
      "bypassPermissions",
      "--strict-mcp-config",
      "--mcp-config",
      "{}",
      ...claudeArguments(task),
      task.briefing.text,
    ],
    {
      cwd: directory,
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
    },
  );
  const output = JSON.parse(stdout);
  const result = output.structured_output;
  if (result?.verdict !== "Pass" && result?.verdict !== "Fail")
    throw new Error("Claude Code returned no structured verdict");
  return { output, result };
}

async function changedPaths(task, directory) {
  const deleted = await command(
    "git",
    ["diff", "--name-only", "--diff-filter=D", "HEAD"],
    { cwd: directory },
  );
  if (deleted.stdout.trim().length > 0)
    throw new Error("worker handoffs cannot represent deleted files");
  const tracked = await command(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", "-z", "HEAD"],
    { cwd: directory, encoding: "buffer" },
  );
  const untracked = await command(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: directory, encoding: "buffer" },
  );
  const setupFiles = new Set(
    (task.worker?.files ?? []).map((file) => file.path),
  );
  return [
    ...new Set(
      Buffer.concat([tracked.stdout, untracked.stdout])
        .toString("utf8")
        .split("\0"),
    ),
  ]
    .filter((path) => path.length > 0 && !setupFiles.has(path))
    .sort();
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

async function workHandoffs(task, bearer, directory, verdict) {
  if (task.taskKind !== "Work" || verdict !== "Pass") return [];
  const handoffs = [];
  for (const path of await changedPaths(task, directory)) {
    const content = await readFile(join(directory, path));
    handoffs.push(await upload(task, bearer, path, content));
  }
  return handoffs;
}

async function diagnostic(task, bearer, result) {
  const content = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  return upload(task, bearer, ".chuggy/claude-result.json", content);
}

async function report(task, bearer, manifest) {
  await workerRequest(task, bearer, "/v1/report", {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: JSON.stringify({ version: 1, ...manifest }),
  });
}

async function main() {
  const task = parsed("CHUG_WORKER_TASK");
  activeTask = task;
  for (const credential of ["chuggy-git", "claude-code"])
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
  const input = await (await workerRequest(task, bearer, "/v1/input")).json();
  const repositoryId = oneReference(input, "Repository");
  const repository = repositories[repositoryId];
  if (typeof repository !== "string")
    throw new Error(`no repository location for ${repositoryId}`);
  const directory = await cloneRepository(
    repository,
    oneReference(input, "TargetCommit"),
    required("CHUG_WORKER_WORKSPACE"),
  );
  await prepareWorker(task, directory);
  const { output, result } = await runClaude(task, directory);
  const handoffs = await workHandoffs(task, bearer, directory, result.verdict);
  const diagnostics = [await diagnostic(task, bearer, output)];
  await report(task, bearer, {
    verdict: result.verdict,
    handoffs,
    diagnostics,
  });
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
