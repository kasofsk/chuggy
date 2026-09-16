import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Ajv2020 } from "ajv/dist/2020.js";

import { prepare_commit } from "./commitHooks.ts";

interface TicketWorkerEnvelope {
  readonly taskKey: string;
  readonly callbackUrl: string;
  readonly bearer: string;
  readonly workspace: string;
  readonly timeoutSecsMax: number;
  readonly outputBytesMax: number;
  readonly transportUrl: string;
  readonly providerCredentialFile?: string;
  readonly view: {
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
  };
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

function safeView(held: TicketWorkerEnvelope): TicketWorkerEnvelope["view"] {
  return held.view;
}

function workerEvidence(held: TicketWorkerEnvelope, evidence: string): string {
  let scrubbed = evidence.replaceAll(held.bearer, "[REDACTED]");
  try {
    const url = new URL(held.transportUrl);
    for (const secret of [url.username, url.password])
      if (secret.length > 0)
        scrubbed = scrubbed.replaceAll(secret, "[REDACTED]");
  } catch {
    return scrubbed;
  }
  return scrubbed;
}

function envelope(value: unknown): TicketWorkerEnvelope {
  const found = record(value, "envelope");
  const view = record(found["view"], "view");
  for (const name of [
    "taskKey",
    "callbackUrl",
    "bearer",
    "workspace",
    "transportUrl",
  ])
    if (typeof found[name] !== "string" || found[name].length === 0)
      throw new TypeError(`ticket worker ${name} is invalid`);
  for (const name of ["repository", "commit", "access"])
    if (typeof view[name] !== "string" || view[name].length === 0)
      throw new TypeError(`ticket worker view ${name} is invalid`);
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
  taskKey: string,
  workload: Record<string, unknown>,
  inputs: unknown,
  context: TicketWorkerEnvelope["view"]["context"],
): string {
  return [
    optionalString(workload, "prompt", ""),
    `Task: ${taskKey}`,
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

async function checkout(held: TicketWorkerEnvelope): Promise<void> {
  await mkdir(held.workspace, { recursive: true });
  await git(["init", "--quiet"], held.workspace, held);
  await git(
    ["remote", "add", "origin", held.transportUrl],
    held.workspace,
    held,
  );
  await git(
    ["fetch", "--quiet", "--depth=1", "origin", held.view.commit],
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
        CHUG_INPUTS: JSON.stringify(held.view.inputs),
        CHUG_TASK: JSON.stringify(safeView(held)),
      },
    };
  }
  const control = await mkdtemp(join(tmpdir(), "chug-ticket-agent-"));
  await writeFile(
    join(control, "schema.json"),
    JSON.stringify(held.view.resultContract),
  );
  const agent = await ticketWorkerAgentCommand(
    {
      ...workload,
      prompt: ticketWorkerPrompt(
        held.taskKey,
        workload,
        held.view.inputs,
        held.view.context,
      ),
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
      CHUG_TASK: JSON.stringify(safeView(held)),
      CHUG_CONTEXT: JSON.stringify(held.view.context),
    },
    control,
  };
}

async function invocationCleanup(control: string | undefined): Promise<void> {
  if (control !== undefined)
    await rm(control, { recursive: true, force: true });
}

async function publishedResult(
  held: TicketWorkerEnvelope,
  workload: Record<string, unknown>,
  manifest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (held.view.access === "ReadRepository")
    return { type: "result", manifest, outputs: [] };
  const commit = await prepare_commit(
    held.workspace,
    held.view.commit,
    workload,
    () => {},
    childEnvironment(),
    "Complete ticket task",
  );
  await git(
    ["push", "--quiet", "origin", `${commit}:refs/chuggy/results/${commit}`],
    held.workspace,
    held,
  );
  return {
    type: "result",
    manifest,
    outputs: [{ repository: held.view.repository, commit }],
  };
}

async function execute(
  held: TicketWorkerEnvelope,
): Promise<Record<string, unknown>> {
  await checkout(held);
  const workload = record(held.view.workload, "workload");
  const invocation = await workloadInvocation(held, workload);
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
          held,
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
  return publishedResult(held, workload, manifest);
}

export async function ticketWorkerMain(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const source = environment["CHUG_TICKET_WORKER_TASK"];
  if (source === undefined)
    throw new Error("CHUG_TICKET_WORKER_TASK is required");
  const held = envelope(JSON.parse(source) as unknown);
  let outcome: Record<string, unknown>;
  try {
    outcome = await execute(held);
  } catch (error) {
    outcome = {
      type: "process_failed",
      evidence: workerEvidence(
        held,
        error instanceof Error ? error.message : "worker failed",
      ),
    };
  }
  const response = await fetch(held.callbackUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${held.bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ taskKey: held.taskKey, outcome }),
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
