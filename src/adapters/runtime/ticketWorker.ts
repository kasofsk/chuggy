import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Ajv2020 } from "ajv/dist/2020.js";

import { prepare_commit } from "./commitHooks.ts";

/**
 * What the launcher hands this process, which is only what no callback could:
 * where to call and what to call as. Everything else about the task, the git
 * credential included, is fetched from the callback, so a pool that placed
 * this process carries a token and a URL and nothing confidential at all.
 */
interface TicketWorkerEnvelope {
  readonly callbackUrl: string;
  readonly bearer: string;
  readonly workspace: string;
  readonly timeoutSecsMax: number;
  readonly outputBytesMax: number;
  readonly providerCredentialFile?: string;
}

/** One git credential as the plane mints it, and when the plane says it stops working. */
interface TicketWorkerCredential {
  readonly username: string;
  readonly password: string;
  readonly expiresAtMs: number;
}

/**
 * What this attempt reaches its repository under: the envelope it was launched
 * with and the credential it has been minted so far. The credential is held
 * only in this process and never written into the workspace's own git
 * configuration, so a workload reads it from neither.
 */
interface TicketWorkerTransport {
  readonly held: TicketWorkerEnvelope;
  credential?: TicketWorkerCredential;
}

/**
 * A mint the plane could not perform, which is not a mint it refused. An
 * outage ends the attempt as unavailable and is tried again; a refusal is this
 * attempt's own evidence and settles it.
 */
class TicketWorkerUnavailable extends Error {}

/**
 * How long before a credential's stated end it is minted again rather than
 * used. A work task may run longer than one token lives, and a push that fails
 * on an expired token throws away the work that earned it.
 */
const ticketWorkerCredentialMarginMs = 60_000;

/**
 * How often the workload says it is still going. It is the harness's own
 * signal and not its pool's, so it is sent while the workload runs and stops
 * the moment it does.
 */
const ticketWorkerHeartbeatMs = 30_000;

interface TicketWorkerView {
  readonly workload: unknown;
  readonly inputs: unknown;
  readonly resultContract: unknown;
  readonly requiredCapabilities: readonly string[];
  readonly context: readonly {
    readonly reference: number;
    readonly value: unknown;
  }[];
  readonly repository: string;
  readonly commit: string;
  readonly access: "ReadRepository" | "PublishRepositoryResult";
}

/** Where the callback answers this attempt's own routes. */
function ticketWorkerRoute(held: TicketWorkerEnvelope, route: string): string {
  return new URL(route, `${held.callbackUrl}/`).toString();
}

/** The resolved view this attempt runs against, fetched under its own bearer. */
async function ticketWorkerView(
  held: TicketWorkerEnvelope,
): Promise<TicketWorkerView> {
  const response = await fetch(ticketWorkerRoute(held, "view"), {
    headers: { authorization: `Bearer ${held.bearer}` },
  });
  if (!response.ok)
    throw new Error(
      `ticket worker view was refused with ${String(response.status)}`,
    );
  const view = record(await response.json(), "view");
  for (const name of ["repository", "commit", "access"])
    if (typeof view[name] !== "string" || String(view[name]).length === 0)
      throw new TypeError(`ticket worker view ${name} is invalid`);
  return view as unknown as TicketWorkerView;
}

/**
 * One mint on the callback, refused for this repository or not reached at all.
 * Only a refusal naming the repository is settled: everything else leaves the
 * attempt unavailable, because a plane that answered nothing has decided
 * nothing about this ticket.
 */
async function ticketWorkerCredentialMinted(
  held: TicketWorkerEnvelope,
): Promise<TicketWorkerCredential> {
  const response = await fetch(ticketWorkerRoute(held, "credentials"), {
    method: "POST",
    headers: { authorization: `Bearer ${held.bearer}` },
  }).catch(() => undefined);
  if (response === undefined)
    throw new TicketWorkerUnavailable(
      "the repository credential mint could not be reached",
    );
  if (response.status === 404) {
    const refusal = record(await response.json(), "credential refusal");
    if (refusal["reason"] === "NotMinted")
      throw new Error("the repository credential was denied");
    throw new TicketWorkerUnavailable(
      "the plane mints no repository credential",
    );
  }
  if (!response.ok)
    throw new TicketWorkerUnavailable(
      `the repository credential mint answered ${String(response.status)}`,
    );
  return ticketWorkerCredentialOf(await response.json());
}

/** One minted credential as the plane wrote it, refused here rather than by git. */
function ticketWorkerCredentialOf(value: unknown): TicketWorkerCredential {
  const found = record(value, "credential");
  for (const name of ["username", "password"])
    if (typeof found[name] !== "string" || found[name].length === 0)
      throw new TypeError(`ticket worker credential ${name} is invalid`);
  if (!Number.isSafeInteger(found["expiresAtMs"]))
    throw new TypeError("ticket worker credential expiry is invalid");
  return found as unknown as TicketWorkerCredential;
}

/**
 * The credential this attempt works under, minted once and again only once the
 * held one is spent. One mint covers every git call of an attempt because the
 * scope is the attempt's own and identical for each of them, so minting per
 * call would widen nothing and only multiply the ways an attempt can fail.
 */
async function ticketWorkerCredential(
  transport: TicketWorkerTransport,
  nowMs: number = Date.now(),
): Promise<TicketWorkerCredential> {
  const held = transport.credential;
  if (
    held !== undefined &&
    held.expiresAtMs - nowMs > ticketWorkerCredentialMarginMs
  )
    return held;
  const minted = await ticketWorkerCredentialMinted(transport.held);
  transport.credential = minted;
  return minted;
}

/**
 * The remote one git call is made against. It is built for the call and passed
 * as an argument, so the credential never lands in the workspace's own git
 * configuration for the workload to read.
 */
async function ticketWorkerRemote(
  transport: TicketWorkerTransport,
  repository: string,
): Promise<string> {
  const credential = await ticketWorkerCredential(transport);
  const remote = new URL(repository);
  if (remote.protocol !== "https:")
    throw new TypeError("ticket repository must use HTTPS");
  if (remote.username !== "" || remote.password !== "")
    throw new TypeError("ticket repository URL must carry no credentials");
  remote.username = credential.username;
  remote.password = credential.password;
  return remote.href;
}

interface Ran {
  readonly code: number | null;
  readonly stopped: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment["CHUG_TICKET_WORKER_TASK"];
  return environment;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`ticket worker ${what} must be an object`);
  return value as Record<string, unknown>;
}

function workerEvidence(
  transport: TicketWorkerTransport,
  evidence: string,
): string {
  let scrubbed = evidence.replaceAll(transport.held.bearer, "[REDACTED]");
  for (const secret of [
    transport.credential?.username,
    transport.credential?.password,
  ])
    if (secret !== undefined && secret.length > 0)
      scrubbed = scrubbed.replaceAll(secret, "[REDACTED]");
  return scrubbed;
}

function envelope(value: unknown): TicketWorkerEnvelope {
  const found = record(value, "envelope");
  for (const name of ["callbackUrl", "bearer", "workspace"])
    if (typeof found[name] !== "string" || found[name].length === 0)
      throw new TypeError(`ticket worker ${name} is invalid`);
  for (const name of ["timeoutSecsMax", "outputBytesMax"])
    if (!Number.isSafeInteger(found[name]) || Number(found[name]) < 1)
      throw new TypeError(`ticket worker ${name} is invalid`);
  return found as unknown as TicketWorkerEnvelope;
}

function scriptCommand(workload: Record<string, unknown>): readonly string[] {
  const selected = workload["command"];
  if (
    !Array.isArray(selected) ||
    selected.length === 0 ||
    !selected.every((part) => typeof part === "string" && part.length > 0)
  )
    throw new TypeError("ticket worker command is invalid");
  return selected.map((part) => String(part));
}

function strings(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string"))
    throw new TypeError(`ticket worker ${what} must be an array of strings`);
  return value;
}

function optionalString(
  workload: Record<string, unknown>,
  name: string,
  fallback: string,
): string {
  const value = workload[name] ?? fallback;
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`ticket worker ${name} is invalid`);
  return value;
}

export function ticketWorkerPrompt(
  workload: Record<string, unknown>,
  inputs: unknown,
  context: TicketWorkerView["context"],
): string {
  return [
    optionalString(workload, "prompt", ""),
    `Inputs:\n${JSON.stringify(inputs, null, 2)}`,
    `Context:\n${context
      .map(
        ({ reference, value }) =>
          `${String(reference)}:\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`,
      )
      .join("\n\n")}`,
    "Complete the task, then call submit_result exactly once with a result matching its schema.",
  ].join("\n\n");
}

const ticketWorkerPath =
  process.env["CHUG_TICKET_WORKER_ENTRYPOINT"] ??
  fileURLToPath(new URL("../../roots/ticketWorker.ts", import.meta.url));

function resultMcpArguments(schema: string, result: string): readonly string[] {
  return [
    ticketWorkerPath,
    "--result-mcp",
    "--schema",
    schema,
    "--result",
    result,
  ];
}

export async function ticketWorkerAgentCommand(
  workload: Record<string, unknown>,
  workspace: string,
  control: string,
  providerCredential?: string,
): Promise<{
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}> {
  const runner = workload["runner"];
  const prompt = optionalString(workload, "prompt", "");
  const schema = join(control, "schema.json");
  const result = join(control, "result.json");
  const mcp = resultMcpArguments(schema, result);
  if (runner === "codex")
    return codexAgentCommand(
      workload,
      workspace,
      control,
      mcp,
      prompt,
      providerCredential,
    );
  if (runner === "claude")
    return claudeAgentCommand(
      workload,
      control,
      mcp,
      prompt,
      providerCredential,
    );
  throw new TypeError("ticket worker agent is invalid");
}

async function codexAgentCommand(
  workload: Record<string, unknown>,
  workspace: string,
  control: string,
  mcp: readonly string[],
  prompt: string,
  providerCredential: string | undefined,
): Promise<{
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}> {
  if (providerCredential === undefined)
    throw new TypeError("ticket worker codex credential is unavailable");
  await writeFile(join(control, "auth.json"), providerCredential, {
    mode: 0o600,
  });
  const sandbox = optionalString(
    workload,
    "permission_mode",
    "workspace-write",
  );
  await writeFile(
    join(control, "config.toml"),
    `approval_policy = "never"\nsandbox_mode = ${JSON.stringify(sandbox)}\n` +
      `[mcp_servers.chug]\ncommand = ${JSON.stringify(process.execPath)}\n` +
      `args = ${JSON.stringify(mcp)}\nrequired = true\n` +
      'enabled_tools = ["submit_result"]\ndefault_tools_approval_mode = "approve"\n' +
      (workload["network_access"] === true
        ? "[sandbox_workspace_write]\nnetwork_access = true\n"
        : ""),
  );
  const argv = [
    "codex",
    "exec",
    "--json",
    "--sandbox",
    sandbox,
    "--cd",
    workspace,
  ];
  if (typeof workload["model"] === "string")
    argv.push("--model", workload["model"]);
  argv.push(prompt);
  return { argv, environment: { ...childEnvironment(), CODEX_HOME: control } };
}

async function claudeAgentCommand(
  workload: Record<string, unknown>,
  control: string,
  mcp: readonly string[],
  prompt: string,
  providerCredential: string | undefined,
): Promise<{
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}> {
  if (providerCredential === undefined)
    throw new TypeError("ticket worker claude credential is unavailable");
  await writeFile(join(control, ".credentials.json"), providerCredential, {
    mode: 0o600,
  });
  const config = join(control, "mcp.json");
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        chug: { type: "stdio", command: process.execPath, args: mcp },
      },
    }),
  );
  await writeFile(
    join(control, "settings.json"),
    JSON.stringify({ autoCompactEnabled: true, autoCompactWindow: 420_000 }),
  );
  const tools = [
    ...strings(workload["allowed_tools"] ?? [], "allowed_tools"),
    "mcp__chug__submit_result",
  ];
  const argv = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    optionalString(workload, "permission_mode", "default"),
    "--mcp-config",
    config,
    "--strict-mcp-config",
    "--allowedTools",
    tools.join(","),
  ];
  if (typeof workload["model"] === "string")
    argv.push("--model", workload["model"]);
  if (typeof workload["effort"] === "string")
    argv.push("--effort", workload["effort"]);
  if (typeof workload["max_budget_usd"] === "number")
    argv.push("--max-budget-usd", String(workload["max_budget_usd"]));
  return {
    argv,
    environment: { ...childEnvironment(), CLAUDE_CONFIG_DIR: control },
  };
}

function run(
  argv: readonly string[],
  directory: string,
  environment: NodeJS.ProcessEnv,
  timeoutSecsMax: number,
  outputBytesMax: number,
): Promise<Ran> {
  const executable = argv[0];
  if (executable === undefined)
    throw new TypeError("ticket worker command is empty");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv.slice(1), {
      cwd: directory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let stopped = false;
    const stop = (): void => {
      stopped = true;
      if (child.pid !== undefined && child.exitCode === null)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
    };
    const timer = setTimeout(stop, timeoutSecsMax * 1_000);
    timer.unref();
    const collect = (target: Buffer[], chunk: Buffer): void => {
      bytes += chunk.byteLength;
      if (bytes > outputBytesMax) stop();
      else target.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      collect(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      collect(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stopped,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function git(
  argv: readonly string[],
  directory: string,
  held: TicketWorkerEnvelope,
): Promise<string> {
  const ran = await run(
    ["git", ...argv],
    directory,
    childEnvironment(),
    held.timeoutSecsMax,
    held.outputBytesMax,
  );
  if (ran.stopped || ran.code !== 0)
    throw new Error(ran.stderr.trim() || "git failed");
  return ran.stdout.trim();
}

async function checkout(
  transport: TicketWorkerTransport,
  view: TicketWorkerView,
): Promise<void> {
  const held = transport.held;
  const remote = await ticketWorkerRemote(transport, view.repository);
  await mkdir(held.workspace, { recursive: true });
  await git(["init", "--quiet"], held.workspace, held);
  await git(
    ["fetch", "--quiet", "--depth=1", remote, view.commit],
    held.workspace,
    held,
  );
  await git(
    ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
    held.workspace,
    held,
  );
}

async function workloadInvocation(
  held: TicketWorkerEnvelope,
  view: TicketWorkerView,
  workload: Record<string, unknown>,
): Promise<{
  readonly command: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly control?: string;
}> {
  if (workload["runner"] === "script") {
    const authored = record(workload["environment"] ?? {}, "environment");
    if (!Object.values(authored).every((value) => typeof value === "string"))
      throw new TypeError("ticket worker environment values must be strings");
    return {
      command: scriptCommand(workload),
      environment: {
        ...childEnvironment(),
        ...(authored as Record<string, string>),
        CHUG_INPUTS: JSON.stringify(view.inputs),
        CHUG_TASK: JSON.stringify(view),
      },
    };
  }
  const control = await mkdtemp(join(tmpdir(), "chug-ticket-agent-"));
  await writeFile(
    join(control, "schema.json"),
    JSON.stringify(view.resultContract),
  );
  const agent = await ticketWorkerAgentCommand(
    {
      ...workload,
      prompt: ticketWorkerPrompt(workload, view.inputs, view.context),
    },
    held.workspace,
    control,
    held.providerCredentialFile === undefined
      ? undefined
      : await readFile(held.providerCredentialFile, "utf8"),
  );
  return {
    command: agent.argv,
    environment: {
      ...agent.environment,
      CHUG_TASK: JSON.stringify(view),
      CHUG_CONTEXT: JSON.stringify(view.context),
    },
    control,
  };
}

async function invocationCleanup(control: string | undefined): Promise<void> {
  if (control !== undefined)
    await rm(control, { recursive: true, force: true });
}

async function publishedResult(
  transport: TicketWorkerTransport,
  view: TicketWorkerView,
  workload: Record<string, unknown>,
  manifest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (view.access === "ReadRepository")
    return { type: "result", manifest, outputs: [] };
  const held = transport.held;
  const commit = await prepare_commit(
    held.workspace,
    view.commit,
    workload,
    () => {},
    childEnvironment(),
    "Complete ticket task",
  );
  await git(
    [
      "push",
      "--quiet",
      await ticketWorkerRemote(transport, view.repository),
      `${commit}:refs/chuggy/results/${commit}`,
    ],
    held.workspace,
    held,
  );
  return {
    type: "result",
    manifest,
    outputs: [{ repository: view.repository, commit, base: view.commit }],
  };
}

async function execute(
  transport: TicketWorkerTransport,
  view: TicketWorkerView,
): Promise<Record<string, unknown>> {
  const held = transport.held;
  await checkout(transport, view);
  const workload = record(view.workload, "workload");
  const invocation = await workloadInvocation(held, view, workload);
  let ran: Ran;
  try {
    ran = await run(
      invocation.command,
      held.workspace,
      invocation.environment,
      held.timeoutSecsMax,
      held.outputBytesMax,
    );
  } catch (error) {
    if (invocation.control !== undefined)
      await rm(invocation.control, { recursive: true, force: true });
    throw error;
  }
  if (ran.stopped)
    return (
      await invocationCleanup(invocation.control),
      {
        type: "execution_unavailable",
        evidence: "workload exceeded its operational bound",
      }
    );
  if (ran.code !== 0)
    return (
      await invocationCleanup(invocation.control),
      {
        type: "process_failed",
        evidence: workerEvidence(
          transport,
          ran.stderr.trim() || `workload exited ${String(ran.code)}`,
        ),
      }
    );
  let manifest: Record<string, unknown>;
  try {
    manifest = record(
      JSON.parse(
        invocation.control === undefined
          ? ran.stdout
          : await readFile(join(invocation.control, "result.json"), "utf8"),
      ) as unknown,
      "result",
    );
  } finally {
    if (invocation.control !== undefined)
      await rm(invocation.control, { recursive: true, force: true });
  }
  return publishedResult(transport, view, workload, manifest);
}

/**
 * Says the workload is still going until told to stop saying it. A refusal ends
 * the beating and nothing else: the attempt this harness holds may have been
 * fenced, and the terminal it is about to write is what settles that.
 */
function ticketWorkerHeartbeat(held: TicketWorkerEnvelope): () => void {
  const timer = setInterval(() => {
    void fetch(ticketWorkerRoute(held, "heartbeat"), {
      method: "POST",
      headers: { authorization: `Bearer ${held.bearer}` },
    }).catch(() => undefined);
  }, ticketWorkerHeartbeatMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

export async function ticketWorkerMain(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const source = environment["CHUG_TICKET_WORKER_TASK"];
  if (source === undefined)
    throw new Error("CHUG_TICKET_WORKER_TASK is required");
  const held = envelope(JSON.parse(source) as unknown);
  const transport: TicketWorkerTransport = { held };
  const beating = ticketWorkerHeartbeat(held);
  let outcome: Record<string, unknown>;
  try {
    outcome = await execute(transport, await ticketWorkerView(held));
  } catch (error) {
    outcome = {
      type:
        error instanceof TicketWorkerUnavailable
          ? "execution_unavailable"
          : "process_failed",
      evidence: workerEvidence(
        transport,
        error instanceof Error ? error.message : "worker failed",
      ),
    };
  }
  beating();
  const response = await fetch(ticketWorkerRoute(held, "terminal"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${held.bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ outcome }),
  });
  if (!response.ok)
    throw new Error(
      `ticket worker terminal was refused with ${String(response.status)}`,
    );
}

function resultMcpOption(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value.length === 0)
    throw new TypeError(`ticket result MCP ${name} is required`);
  return value;
}

function resultMcpReply(
  id: unknown,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

async function resultMcpSchema(path: string): Promise<{
  readonly schema: Record<string, unknown>;
  readonly validate: ReturnType<Ajv2020["compile"]>;
}> {
  const schema = record(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    "result contract",
  );
  if (schema["type"] !== "object")
    throw new TypeError("ticket result contract must declare an object");
  const validate = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
  }).compile(schema);
  return { schema, validate };
}

export async function ticketWorkerResultMcpMain(
  argv: readonly string[],
  input: NodeJS.ReadableStream = process.stdin,
): Promise<void> {
  const { schema, validate } = await resultMcpSchema(
    resultMcpOption(argv, "--schema"),
  );
  const resultPath = resultMcpOption(argv, "--result");
  for await (const line of createInterface({ input })) {
    const request = record(JSON.parse(line) as unknown, "result MCP request");
    const id = request["id"];
    if (id === undefined || id === null) continue;
    let response: Record<string, unknown>;
    if (request["method"] === "initialize")
      response = resultMcpReply(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "chug-result-submission", version: "1" },
        instructions:
          "Call submit_result exactly once when the task is complete.",
      });
    else if (request["method"] === "tools/list")
      response = resultMcpReply(id, {
        tools: [
          {
            name: "submit_result",
            description: "Submit the final task result.",
            inputSchema: schema,
          },
        ],
      });
    else if (request["method"] === "tools/call") {
      const params = record(request["params"], "result MCP parameters");
      const value = record(params["arguments"], "submitted result");
      if (params["name"] !== "submit_result" || !validate(value))
        response = resultMcpReply(id, {
          content: [
            {
              type: "text",
              text: `result contract violation: ${validate.errors?.[0]?.message ?? "invalid result"}`,
            },
          ],
          isError: true,
        });
      else {
        await writeFile(resultPath, JSON.stringify(value), {
          flag: "wx",
          mode: 0o600,
        });
        response = resultMcpReply(id, {
          content: [{ type: "text", text: "Result accepted." }],
          structuredContent: { accepted: true },
        });
      }
    } else
      response = {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "method not found" },
      };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
