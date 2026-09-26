/**
 * What one work attempt is given, what runs it, and what it leaves behind.
 *
 * THE CARRIER IS THE MODE AND THE CANDIDATE IS THE TASK KIND. Whether an agent
 * or a list of commands runs the attempt is the worker mode the task carries;
 * whether what ran leaves a branch behind is the task's kind and its verdict.
 * Neither is read from the other, so a Work task carrying commands runs them
 * with no agent and still pushes the candidate a passing run leaves.
 *
 * THE COMMANDS' EXIT STATUS IS THE WORK'S SUCCESS. Where an agent ran the
 * attempt there is an account of the run to take a verdict from; where commands
 * ran it there is nothing but what they exited with, and nothing else is asked
 * for.
 *
 * AN EMPTY DIFF IS STILL A CANDIDATE IN THIS WORKER'S WORK MODE, because the
 * commit it makes is `--allow-empty`: an attempt whose commands changed nothing
 * declares the commit anyway. That is this worker's rule and not a property of
 * the platform, so a configuration read across to another runner cannot assume
 * it; a repository that wants an empty attempt to fail says so in a command.
 *
 * A POOL HANDS ITS POD AN ENVELOPE, AND THE TASK IS FETCHED. Where a launcher
 * writes the task document itself, a pool writes only the plane to fetch it
 * from, the bearer to fetch it under, and what the pool itself mounted. What
 * the plane answers is the document less that plane, so the plane is joined
 * back on and the attempt runs from admission onwards exactly as a pushed one.
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

import {
  sessionTaskVariable,
  workerCredentialFilesVariable,
  workerRepositoriesVariable,
  workerTaskVariable,
  workerWorkspaceVariable,
} from "@chuggy/worker-contract/workerEnvironment";
import {
  contractVersionRefusalSchema,
  contractVersionRefusalStatus,
  workerContractRelease,
} from "@chuggy/worker-contract/workerContract";
import {
  workerPlaneAnswers,
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
} from "@chuggy/worker-contract/workerPlane";
import {
  filesystemAccesses,
  poolEnvelopeSchema,
  workTaskAnswerSchema,
  workTaskDocumentSchema,
  workerTaskAnswerSchema,
} from "@chuggy/worker-contract/workerTask";

import { workerAgent } from "./agent.mjs";
import {
  runChecks,
  workerCheckCommands,
  workerStageEnvironment,
} from "./checks.mjs";
import { keepWorkerLease } from "./lease.mjs";
import { planeCredential, workerCredentialPath } from "./planeCredential.mjs";
import { attemptDatabase } from "./postgres.mjs";
import {
  workerRepositories,
  workerRepository,
  workerRepositoryUrl,
} from "./repository.mjs";
import {
  credentialScrub,
  credentialScrubbing,
  runEvidenceRecorder,
} from "./runEvidence.mjs";
import { runConfigurationSnapshot } from "./snapshot.mjs";
import { commitAndPushSource, resultDocument } from "./source.mjs";
import { workerRequest } from "./transport.mjs";
import { agentResultSchema } from "./result.mjs";
import { answeredWith, rosterLabel, routePath } from "./wire.mjs";

const executeFile = promisify(execFile);
const agentResultSchemaFile = "/tmp/chuggy-agent-result-schema.json";
const agentDiagnosticPath = ".chuggy/agent-result.json";
const checkDiagnosticPath = ".chuggy/check-output.json";
const workerCredentialFilesMax = 64;
const workspaceWrite = rosterLabel(filesystemAccesses, "WriteWorkspace");
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

/**
 * A site map this pod may run without. A minted credential reaches a repository
 * at its own identity, so a deployment that mints names nothing here; a
 * deployment that mounts still does, and the mounted arm refuses a repository
 * the map leaves out exactly as before.
 */
function optionalRepositories(name) {
  const value = process.env[name];
  return value === undefined || value.length === 0
    ? {}
    : workerRepositories(value);
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

/** The files and the setup lines a worker block asks for, in the workspace it runs in. */
export async function prepareWorker(task, directory) {
  for (const file of task.worker?.files ?? []) {
    const target = workspaceFile(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
  for (const setup of task.worker?.setup ?? []) {
    await command("/bin/sh", ["-eu", "-c", setup], {
      cwd: directory,
      env: workerStageEnvironment(process.env),
    });
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
  await request(task, bearer, routePath(workerPlaneRoutes.artifact, path), {
    method: "PUT",
    headers: { "content-type": workerPlaneBytesMediaType },
    body: content,
  });
  return artifact(path, content);
}

async function workSource(task, workspace, verdict, run = command) {
  if (task.taskKind !== "Work" || verdict !== "Pass") return undefined;
  return commitAndPushSource({ task, ...workspace, command: run });
}

/**
 * One mint from the plane, its password kept out of everything this pod writes
 * before anything reaches a remote with it. Nothing where this deployment mints
 * no credential for the attempt's repository.
 */
async function workerMinted({ task, bearer, keepSecret, request, write }) {
  const minted = await planeCredential({
    task,
    bearer,
    path: workerCredentialPath,
    ...(request === undefined ? {} : { request }),
    ...(write === undefined ? {} : { write }),
  });
  if (minted !== undefined) keepSecret(minted.password);
  return minted;
}

/**
 * A fresh mint immediately before the push. A minted token expires and an
 * attempt may outlive one, so the credential the clone used is not the one the
 * push presents. The plane refusing here is this attempt's failure: a clone that
 * minted and a push that cannot is a deployment mid-change, and reaching the
 * remote with something else is exactly what a minted credential is for.
 */
async function workerRefreshed(asked) {
  const minted = await workerMinted(asked);
  if (minted === undefined)
    throw new Error("the worker plane mints no credential to push with");
  return minted.environment;
}

/** The credential this attempt's launcher mounted, and the authority that must name it. */
function workerMounted(task, repositories, credentialFiles, repositoryId) {
  const mounted = workerRepository(repositories, credentialFiles, repositoryId);
  if (!task.authority.credentials.includes(mounted.credential))
    throw new Error(`worker authority does not grant ${mounted.credential}`);
  return { repository: mounted.repository, environment: mounted.environment };
}

/**
 * The remote one attempt reaches and the askpass environment it reaches it
 * with. The plane's mint answers where there is one, and the launcher's mount
 * where there is not — which is what answered before this plane minted
 * anything, the attempt's own credential roster included. `refresh` comes back
 * only from the minted arm, there being nothing to take again in the other.
 */
export async function workerCredential(asked) {
  const { task, repositories, credentialFiles, repositoryId } = asked;
  const minted = await workerMinted(asked);
  return minted === undefined
    ? workerMounted(task, repositories, credentialFiles, repositoryId)
    : {
        repository: workerRepositoryUrl(repositories, repositoryId),
        environment: minted.environment,
        refresh: () => workerRefreshed(asked),
      };
}

/**
 * What one attempt works in: the repository its own bundle pinned, cloned with
 * the credential this pod resolved, and that credential's `refresh` where the
 * plane minted it. `seams` names the plane, the clone, the file the password
 * is written to and the directory cloned into, this module's own and the
 * image's `CHUG_WORKER_WORKSPACE` where it names none.
 */
export async function workerWorkspace(
  task,
  repositories,
  credentialFiles,
  bearer,
  keepSecret,
  seams = {},
) {
  const {
    request = workerRequest,
    clone = cloneRepository,
    write,
    workspace,
  } = seams;
  const input = await (
    await request(task, bearer, workerPlaneRoutes.input.path)
  ).json();
  const repositoryId = oneReference(input, "Repository");
  const { repository, environment, refresh } = await workerCredential({
    task,
    bearer,
    repositories,
    credentialFiles,
    repositoryId,
    keepSecret,
    request,
    ...(write === undefined ? {} : { write }),
  });
  const base = oneReference(input, "TargetCommit");
  const directory = await clone(
    repository,
    base,
    workspace ?? required(workerWorkspaceVariable),
    environment,
  );
  return {
    repositoryId,
    repository,
    base,
    directory,
    environment,
    ...(refresh === undefined ? {} : { refresh }),
  };
}

async function diagnostic(context, path, result) {
  const content = Buffer.from(
    context.scrub(`${JSON.stringify(result, null, 2)}\n`),
  );
  return upload(context.task, context.bearer, path, content, context.request);
}

async function report(context, manifest) {
  await context.request(
    context.task,
    context.bearer,
    workerPlaneRoutes.report.path,
    {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: JSON.stringify(resultDocument(manifest)),
    },
  );
}

function reportSummary(summary) {
  return summary.replace(/\s+/gu, " ").trim();
}

async function credentialValues(mounted) {
  const values = [];
  for (const path of mounted.slice(0, workerCredentialFilesMax)) {
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

/**
 * What a run is set up with: the agent's environment, the evidence recorder,
 * and the scrub over every secret this pod holds — the agent's own, the bearer,
 * and each file in `mounted`, which is every credential this pod's launcher
 * mounted whether or not the map names it.
 */
export async function workerRun({
  task,
  bearer,
  credentialFiles,
  mounted,
  agent,
}) {
  const prepared =
    agent === undefined
      ? { environment: {}, secrets: [] }
      : await agentCredential(credentialFiles, agent);
  const { scrub, keepSecret } = credentialScrubbing([
    ...prepared.secrets,
    bearer,
    ...(await credentialValues(mounted)),
  ]);
  activeScrub = scrub;
  const evidence = runEvidenceRecorder(task, bearer, scrub);
  activeEvidence = evidence;
  return {
    agentEnvironment: prepared.environment,
    scrub,
    keepSecret,
    evidence,
  };
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
  if (!task.authority.network || task.authority.filesystem !== workspaceWrite)
    throw new Error(
      "development worker requires network and workspace write authority",
    );
}

/** What ran and what it found: one agent's result, or one check stage's. */
export async function runWorkerTask(context, commands) {
  if (commands === undefined) return runAgent(context);
  const run = await runChecks({ directory: context.directory }, commands, {
    scrub: context.scrub,
  });
  return { ...run, diagnosticPath: checkDiagnosticPath };
}

/** What a plane older than the task route answers it with: the framework's own, which no answer map describes. */
const taskRouteAbsent = 404;

/** The status the task route answers a task with, and the kind a work task is told from a session's by. */
const [taskAnswered] = answeredWith(
  workerPlaneAnswers.task,
  workerTaskAnswerSchema,
);
const workKind = workTaskAnswerSchema.shape.kind.value;

/** A reason there is no task to run, and whether the plane can still take this attempt's end. */
function envelopeTaskRefused(refused, settles) {
  return { refused, settles };
}

/**
 * The task the task route answered, less its kind, or why there is none to
 * run. The plane cannot take the end where it refuses this pod's release, since
 * it then refuses every route alike, nor where the bearer is a session's, which
 * the job plane never takes; the task route's own stop shares the status the
 * release refusal comes on.
 */
async function envelopeTaskRead(response) {
  if (response.status === taskRouteAbsent)
    return envelopeTaskRefused(
      "the worker plane predates the task route",
      true,
    );
  const body = await response.json().catch(() => undefined);
  if (response.status === contractVersionRefusalStatus) {
    const version = contractVersionRefusalSchema.safeParse(body);
    if (version.success)
      return envelopeTaskRefused(
        `the worker plane serves contract ${version.data.accepted.min} to ${version.data.accepted.max}, and this pod speaks ${workerContractRelease}`,
        false,
      );
    const stopped =
      workerPlaneAnswers.task[contractVersionRefusalStatus].safeParse(body);
    return envelopeTaskRefused(
      `the worker plane holds no task for this attempt${stopped.success ? `: ${stopped.data.reason}` : ""}`,
      true,
    );
  }
  const answer = workerTaskAnswerSchema.safeParse(body);
  if (response.status !== taskAnswered || !answer.success)
    return envelopeTaskRefused(
      "the worker plane answered a task this pod cannot read",
      true,
    );
  const { kind, ...task } = answer.data;
  if (kind !== workKind)
    return envelopeTaskRefused(
      `the worker plane answered a ${kind} session's task, which an envelope's pod does not run`,
      false,
    );
  return { task };
}

/** One refused attempt ended as a crashed run's is, with the refusal as its error text. */
async function envelopeTaskSettled(plane, bearer, request, message) {
  const scrub = credentialScrub([bearer]);
  try {
    await reportWorkerFailure(
      {
        task: plane,
        bearer,
        evidence: runEvidenceRecorder(plane, bearer, scrub, { request }),
        request,
        scrub,
      },
      message,
    );
  } catch {
    process.stderr.write("the refused attempt could not be ended\n");
  }
}

/**
 * The task a pool's envelope stands for: fetched from the plane it names under
 * the bearer it carries, with that plane joined back on as the one field a
 * pushed document carries and the answer does not.
 *
 * A REFUSAL ENDS THE ATTEMPT NOW RATHER THAN AT ITS LEASE. A pod that only
 * exited would leave the attempt running until its lease lapsed and the reaper
 * lost it; so where the plane can still take the end, it is settled here.
 */
export async function envelopeTask(envelope, request = workerRequest) {
  const plane = { workerPlane: { url: envelope.callbackUrl } };
  const read = await envelopeTaskRead(
    await request(
      plane,
      envelope.bearer,
      workerPlaneRoutes.task.path,
      {},
      { settled: [taskRouteAbsent, contractVersionRefusalStatus] },
    ),
  );
  if (read.task !== undefined) return { ...read.task, ...plane };
  if (read.settles)
    await envelopeTaskSettled(plane, envelope.bearer, request, read.refused);
  throw new Error(read.refused);
}

/**
 * The credential map an envelope stands for: the provider credential the pool
 * mounted, in the slot the task's agent reads it from. With no file, or no
 * agent, it is empty, and an agent then finds its credential unmounted exactly
 * as a pushed pod's does.
 */
export function envelopeCredentialFiles(envelope, agent) {
  return envelope.providerCredentialFile === undefined || agent === undefined
    ? {}
    : { [agent.credential]: envelope.providerCredentialFile };
}

/**
 * What the push path's launcher hands a pod beside its task document: the
 * credential map in its own variable and the bearer in the file the document
 * names, each read only once the attempt has been admitted.
 */
function documentLaunch(document) {
  return {
    task: async () => document,
    given: async () => {
      const credentialFiles = workerRepositories(
        required(workerCredentialFilesVariable),
      );
      return {
        credentialFiles,
        mounted: Object.values(credentialFiles),
        bearer: (
          await readFile(document.workerPlane.capabilityFile, "utf8")
        ).trim(),
      };
    },
  };
}

/**
 * What a pool's envelope stands for in their place. Its `timeoutSecsMax` is
 * the pool's to enforce, as a Kubernetes pool does at its pod's deadline, and
 * its `outputBytesMax` names no channel, every one this pod writes to the
 * plane being bounded by the contract already; so neither is read here.
 */
export function envelopeLaunch(envelope) {
  return {
    task: () => envelopeTask(envelope),
    given: async (agent) => ({
      credentialFiles: envelopeCredentialFiles(envelope, agent),
      mounted:
        envelope.providerCredentialFile === undefined
          ? []
          : [envelope.providerCredentialFile],
      bearer: envelope.bearer,
      workspace: envelope.workspace,
    }),
  };
}

/** One attempt, run from its task onwards the same whichever carrier brought it. */
async function workerAttempt(launch) {
  const task = await launch.task();
  activeTask = task;
  const commands = workerCheckCommands(task);
  const agent = commands === undefined ? workerAgent(task) : undefined;
  await admitWorkerTask(task, agent);
  const repositories = optionalRepositories(workerRepositoriesVariable);
  const {
    credentialFiles,
    mounted,
    bearer,
    workspace: into,
  } = await launch.given(agent);
  activeBearer = bearer;
  const { agentEnvironment, scrub, keepSecret, evidence } = await workerRun({
    task,
    bearer,
    credentialFiles,
    mounted,
    agent,
  });
  const stopLease = keepWorkerLease(task, bearer);
  try {
    const workspace = await workerWorkspace(
      task,
      repositories,
      credentialFiles,
      bearer,
      keepSecret,
      { workspace: into },
    );
    attemptDatabase(process.env);
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
    await stopLease();
  }
}

/**
 * What a finished run leaves behind, in the order it has to leave it: the run's
 * totals reach the plane before the report that terminalizes the execution, so
 * a settled task never carries figures nothing wrote. `context.command` is the
 * seam a passing work attempt's push runs through, this module's own where it
 * is absent.
 */
export async function publishWorkerResult(
  context,
  workspace,
  { output, result, diagnosticPath },
) {
  await context.evidence.finish();
  const source = await workSource(
    context.task,
    workspace,
    result.verdict,
    context.command,
  );
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

/**
 * Which mode the pod was launched in. Exactly one task document must be set:
 * neither leaves the pod with nothing to do, and both would let a launcher's
 * environment decide which of two authorities the pod acts under.
 */
export function workerMode(environment) {
  const named = (name) => {
    const value = environment[name];
    return typeof value === "string" && value.length > 0;
  };
  const work = named(workerTaskVariable);
  const session = named(sessionTaskVariable);
  if (work && session)
    throw new Error(
      `a pod is launched with ${workerTaskVariable} or ${sessionTaskVariable}, never both`,
    );
  if (work) return "Work";
  if (session) return "Session";
  throw new Error(
    `a pod needs one of ${workerTaskVariable} and ${sessionTaskVariable}`,
  );
}

/**
 * What `CHUG_WORKER_TASK` carries: a task document, which is what the push
 * path's launcher writes, or a pool's envelope naming where to fetch one. It is
 * told by the fields each schema names, so a value naming fields of both, or of
 * neither, is refused rather than read as whichever it resembles more.
 */
export function workerTaskCarrier(value) {
  const names = (schema) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(schema.shape).some((field) => Object.hasOwn(value, field));
  const document = names(workTaskDocumentSchema);
  const envelope = names(poolEnvelopeSchema);
  if (document && envelope)
    throw new Error(
      `${workerTaskVariable} carries a task document and a pool envelope at once`,
    );
  if (document) return "Document";
  if (envelope) return "Envelope";
  throw new Error(
    `${workerTaskVariable} carries neither a task document nor a pool envelope`,
  );
}

/** The envelope a pool launched this pod with, refused naming the fields this pod cannot read. */
function envelopeRead(value) {
  const envelope = poolEnvelopeSchema.safeParse(value);
  if (!envelope.success)
    throw new Error(
      `${workerTaskVariable} carries a pool envelope this pod cannot read: ${envelope.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return envelope.data;
}

async function main() {
  const carried = parsed(workerTaskVariable);
  await workerAttempt(
    workerTaskCarrier(carried) === "Document"
      ? documentLaunch(carried)
      : envelopeLaunch(envelopeRead(carried)),
  );
}

async function run() {
  if (workerMode(process.env) === "Work") return main();
  const { sessionMain } = await import("./session.mjs");
  process.exitCode = await sessionMain();
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
  run().catch(reportActiveFailure);
