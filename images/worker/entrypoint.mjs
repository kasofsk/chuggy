import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

import { workerAgent } from "./agent.mjs";
import { runChecks, workerCheckCommands } from "./checks.mjs";
import { keepWorkerLease } from "./lease.mjs";
import { scopedDatabase } from "./postgres.mjs";
import { workerRepositories, workerRepository } from "./repository.mjs";
import { credentialScrub, runEvidenceRecorder } from "./runEvidence.mjs";
import { runConfigurationSnapshot } from "./snapshot.mjs";
import { commitAndPushSource, resultDocument } from "./source.mjs";
import { workerRequest } from "./transport.mjs";
import { agentResultSchema } from "./result.mjs";

const executeFile = promisify(execFile);
const agentResultSchemaFile = "/tmp/chuggy-agent-result-schema.json";
const agentDiagnosticPath = ".chuggy/agent-result.json";
const checkDiagnosticPath = ".chuggy/check-output.json";
const workerCredentialFilesMax = 64;
let activeTask;
let activeBearer;
let activeScrub;
let activeEvidence;

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

async function cloneRepository(repository, commit, workspace, environment) {
  const directory = join(workspace, "repository");
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

async function captureConfiguration(context, argv, init) {
  const snapshot = await runConfigurationSnapshot({
    argv,
    init,
    task: context.task,
    cwd: context.directory,
    home: process.env.HOME,
    scrub: context.scrub,
  });
  await context.evidence.configuration(snapshot);
}

async function readAgentStream(context, child, argv) {
  let resultEvent;
  let captured = false;
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    process.stdout.write(`${line}\n`);
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(
        `${context.agent.runtime} emitted invalid streaming JSON`,
      );
    }
    if (!captured && context.agent.configurationEvent(event)) {
      captured = true;
      await captureConfiguration(context, argv, event);
    }
    if (context.agent.resultEvent(event)) resultEvent = event;
    const observed = context.agent.observed(event);
    if (observed !== undefined) context.evidence.observed(observed);
    await context.evidence.record(line, event);
  }
  return resultEvent;
}

async function runAgent(context) {
  const argv = context.agent.invocation(context.task, {
    resultSchema: agentResultSchemaFile,
  });
  if (context.agent.configuration !== undefined)
    await captureConfiguration(
      context,
      argv,
      await context.agent.configuration(context.task, {
        ...process.env,
        ...context.agentEnvironment,
      }),
    );
  const child = spawn(context.agent.executable, argv, {
    cwd: context.directory,
    env: { ...process.env, ...context.agentEnvironment },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) =>
      resolve([exitCode, exitSignal]),
    );
  });
  const resultEvent = await readAgentStream(context, child, argv);
  const [code, signal] = await exited;
  if (code !== 0)
    throw new Error(
      `${context.agent.runtime} exited ${code ?? `after signal ${signal ?? "unknown"}`}`,
    );
  return {
    ...context.agent.result([resultEvent]),
    diagnosticPath: agentDiagnosticPath,
  };
}

function artifact(path, content) {
  return {
    path,
    digest: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  };
}

async function upload(task, bearer, path, content, request = workerRequest) {
  await request(task, bearer, `/v1/artifacts/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: content,
  });
  return artifact(path, content);
}

async function workSource(task, workspace, verdict) {
  if (task.taskKind !== "Work" || verdict !== "Pass") return undefined;
  return commitAndPushSource({ task, ...workspace, command });
}

async function workerWorkspace(task, repositories, credentialFiles, bearer) {
  const input = await (await workerRequest(task, bearer, "/v1/input")).json();
  const repositoryId = oneReference(input, "Repository");
  const { repository, credential, environment } = workerRepository(
    repositories,
    credentialFiles,
    repositoryId,
  );
  if (!task.authority.credentials.includes(credential))
    throw new Error(`worker authority does not grant ${credential}`);
  const base = oneReference(input, "TargetCommit");
  const directory = await cloneRepository(
    repository,
    base,
    required("CHUG_WORKER_WORKSPACE"),
    environment,
  );
  return { repositoryId, repository, base, directory, environment };
}

async function diagnostic(context, path, result) {
  const content = Buffer.from(
    context.scrub(`${JSON.stringify(result, null, 2)}\n`),
  );
  return upload(context.task, context.bearer, path, content, context.request);
}

async function report(context, manifest) {
  await context.request(context.task, context.bearer, "/v1/report", {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: JSON.stringify(resultDocument(manifest)),
  });
}

function reportSummary(summary) {
  return summary.replace(/\s+/gu, " ").trim();
}

async function credentialValues(credentialFiles) {
  const values = [];
  for (const path of Object.values(credentialFiles).slice(
    0,
    workerCredentialFilesMax,
  )) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    try {
      values.push((await readFile(path, "utf8")).trim());
    } catch {
      process.stderr.write(`worker credential ${path} could not be read\n`);
    }
  }
  return values;
}

async function agentCredential(credentialFiles, agent) {
  const credentialFile = credentialFiles[agent.credential];
  if (typeof credentialFile !== "string")
    throw new Error(`worker credential ${agent.credential} is not mounted`);
  const token = (await readFile(credentialFile, "utf8")).trim();
  return agent.prepareCredential(token);
}

async function workerRun(task, bearer, credentialFiles, agent) {
  const prepared =
    agent === undefined
      ? { environment: {}, secrets: [] }
      : await agentCredential(credentialFiles, agent);
  const scrub = credentialScrub([
    ...prepared.secrets,
    bearer,
    ...(await credentialValues(credentialFiles)),
  ]);
  activeScrub = scrub;
  const evidence = runEvidenceRecorder(task, bearer, scrub);
  activeEvidence = evidence;
  return { agentEnvironment: prepared.environment, scrub, evidence };
}

function scrubbed(text) {
  return activeScrub === undefined ? text : activeScrub(text);
}

/** What the task must grant before it runs, and what an agent-run task needs on disk. */
async function admitWorkerTask(task, agent) {
  if (agent !== undefined) {
    if (!task.authority.credentials.includes(agent.credential))
      throw new Error(`worker authority does not grant ${agent.credential}`);
    await writeFile(agentResultSchemaFile, JSON.stringify(agentResultSchema), {
      flag: "wx",
    });
  }
  if (!task.authority.network || task.authority.filesystem !== "WriteWorkspace")
    throw new Error(
      "development worker requires network and workspace write authority",
    );
}

/** What ran and what it found: one agent's result, or one check stage's. */
export async function runWorkerTask(context, commands) {
  if (commands === undefined) return runAgent(context);
  const run = await runChecks({ directory: context.directory }, commands);
  return { ...run, diagnosticPath: checkDiagnosticPath };
}

async function main() {
  const task = parsed("CHUG_WORKER_TASK");
  activeTask = task;
  const commands = workerCheckCommands(task);
  const agent = commands === undefined ? workerAgent(task) : undefined;
  await admitWorkerTask(task, agent);
  const repositories = workerRepositories(required("CHUG_WORKER_REPOSITORIES"));
  const credentialFiles = workerRepositories(
    required("CHUG_WORKER_CREDENTIAL_FILES"),
  );
  const bearer = (
    await readFile(task.workerPlane.capabilityFile, "utf8")
  ).trim();
  activeBearer = bearer;
  const { agentEnvironment, scrub, evidence } = await workerRun(
    task,
    bearer,
    credentialFiles,
    agent,
  );
  const stopLease = keepWorkerLease(task, bearer);
  let dropDatabase = async () => undefined;
  try {
    const workspace = await workerWorkspace(
      task,
      repositories,
      credentialFiles,
      bearer,
    );
    dropDatabase = await scopedDatabase(
      required("CHUG_WORKER_DATABASE_URL"),
      required("CHUG_WORKER_DATABASE_SCOPE"),
    );
    await prepareWorker(task, workspace.directory);
    const run = await runWorkerTask(
      {
        task,
        directory: workspace.directory,
        agentEnvironment,
        scrub,
        evidence,
        agent,
      },
      commands,
    );
    await publishWorkerResult(
      { task, bearer, evidence, scrub, stopLease, request: workerRequest },
      workspace,
      run,
    );
  } finally {
    evidence.stop();
    try {
      await dropDatabase();
    } finally {
      await stopLease();
    }
  }
}

/**
 * What a finished run leaves behind, in the order it has to leave it: the run's
 * totals reach the plane before the report that terminalizes the execution, so
 * a settled task never carries figures nothing wrote.
 */
export async function publishWorkerResult(
  context,
  workspace,
  { output, result, diagnosticPath },
) {
  await context.evidence.finish();
  const source = await workSource(context.task, workspace, result.verdict);
  const diagnostics = [await diagnostic(context, diagnosticPath, output)];
  await context.stopLease();
  await report(context, {
    verdict: result.verdict,
    report: context.scrub(reportSummary(result.summary)),
    handoffs: [],
    ...(source === undefined ? {} : { source }),
    diagnostics,
  });
}

/**
 * What a crashed run leaves behind: its figures, its error text, and the label
 * that ends the attempt. It reports no verdict, because a run that died is a
 * lost attempt and never a failed task.
 */
export async function reportWorkerFailure(
  { task, bearer, evidence, request = workerRequest, scrub = scrubbed },
  message,
) {
  await evidence?.finish();
  try {
    await upload(
      task,
      bearer,
      ".chuggy/worker-error.txt",
      Buffer.from(scrub(`${message}\n`)),
      request,
    );
  } catch {
    process.stderr.write("worker failure text could not be uploaded\n");
  }
  await evidence?.ended();
}

async function reportActiveFailure(failure) {
  const message = scrubbed(
    failure instanceof Error ? failure.message : "worker failed",
  );
  process.stderr.write(`${message}\n`);
  if (activeTask !== undefined && activeBearer !== undefined) {
    try {
      await reportWorkerFailure(
        {
          task: activeTask,
          bearer: activeBearer,
          evidence: activeEvidence,
          scrub: scrubbed,
        },
        message,
      );
    } catch {
      process.stderr.write("worker failure could not be reported\n");
    }
  }
  process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  main().catch(reportActiveFailure);
