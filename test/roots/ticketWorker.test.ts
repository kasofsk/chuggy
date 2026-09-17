import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  ticketWorkerAgentCommand,
  ticketWorkerMain,
  ticketWorkerPrompt,
} from "../../src/adapters/runtime/ticketWorker.ts";

const executeFile = promisify(execFile);

function executeResultMcp(
  argv: readonly string[],
  input: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(`result MCP exited ${String(code)}`));
    });
    child.stdin.end(input);
  });
}

async function ticketRepository(root: string): Promise<{
  readonly remote: string;
  readonly commit: string;
}> {
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  await executeFile("git", ["init", "--bare", "--quiet", remote]);
  await executeFile("git", ["init", "--quiet", source]);
  await writeFile(join(source, "README.md"), "source\n");
  await executeFile("git", ["add", "README.md"], { cwd: source });
  await executeFile(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@invalid",
      "commit",
      "--quiet",
      "-m",
      "source",
    ],
    { cwd: source },
  );
  const { stdout } = await executeFile("git", ["rev-parse", "HEAD"], {
    cwd: source,
  });
  await executeFile("git", ["remote", "add", "origin", remote], {
    cwd: source,
  });
  await executeFile("git", ["push", "--quiet", "origin", "HEAD:main"], {
    cwd: source,
  });
  return { remote, commit: stdout.trim() };
}

test("Codex receives the adopted model, prompt, sandbox, network, and result MCP", async () => {
  const control = await mkdtemp(join(tmpdir(), "ticket-codex-"));
  try {
    const command = await ticketWorkerAgentCommand(
      {
        runner: "codex",
        model: "gpt-codex",
        prompt: "implement the ticket",
        permission_mode: "workspace-write",
        network_access: true,
      },
      "/workspace",
      control,
      '{"tokens":{"access_token":"codex-token"}}',
    );
    assert.deepEqual(command.argv, [
      "codex",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/workspace",
      "--model",
      "gpt-codex",
      "implement the ticket",
    ]);
    assert.equal(command.environment["CODEX_HOME"], control);
    assert.equal(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(control, "auth.json"), "utf8"),
      ),
      '{"tokens":{"access_token":"codex-token"}}',
    );
    const config = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(control, "config.toml"), "utf8"),
    );
    assert.match(config, /enabled_tools = \["submit_result"\]/u);
    assert.match(config, /network_access = true/u);
  } finally {
    await rm(control, { recursive: true, force: true });
  }
});

test("the agent argv carries authored context and rework inputs", async () => {
  const control = await mkdtemp(join(tmpdir(), "ticket-briefing-"));
  try {
    const prompt = ticketWorkerPrompt(
      "work:3:2",
      { runner: "codex", prompt: "implement" },
      { rework: [{ finding: "restore validation" }] },
      [
        { reference: 11, value: "Authored title" },
        { reference: 12, value: "Authored instructions" },
      ],
    );
    const command = await ticketWorkerAgentCommand(
      { runner: "codex", prompt },
      "/workspace",
      control,
      "{}",
    );
    assert.equal(command.argv.at(-1), prompt);
    assert.match(prompt, /Authored instructions/u);
    assert.match(prompt, /restore validation/u);
    assert.match(prompt, /submit_result exactly once/u);
  } finally {
    await rm(control, { recursive: true, force: true });
  }
});

test("the executable root serves result MCP initialize, list, and call", async () => {
  const control = await mkdtemp(join(tmpdir(), "ticket-result-mcp-"));
  try {
    const schema = join(control, "schema.json");
    const result = join(control, "result.json");
    await writeFile(
      schema,
      JSON.stringify({
        type: "object",
        properties: { verdict: { const: "pass" } },
        required: ["verdict"],
      }),
    );
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "submit_result", arguments: { verdict: "pass" } },
      },
    ];
    const output = await executeResultMcp(
      [
        "--experimental-strip-types",
        new URL("../../src/roots/ticketWorker.ts", import.meta.url).pathname,
        "--result-mcp",
        "--schema",
        schema,
        "--result",
        result,
      ],
      `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    );
    const replies = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(
      replies.map((reply) => reply["id"]),
      [1, 2, 3],
    );
    assert.equal(await readFile(result, "utf8"), '{"verdict":"pass"}');
  } finally {
    await rm(control, { recursive: true, force: true });
  }
});

test("Claude receives the adopted tools, model, effort, budget, prompt, and result MCP", async () => {
  const control = await mkdtemp(join(tmpdir(), "ticket-claude-"));
  try {
    const command = await ticketWorkerAgentCommand(
      {
        runner: "claude",
        model: "claude-model",
        prompt: "review the ticket",
        effort: "high",
        permission_mode: "acceptEdits",
        allowed_tools: ["Read", "Grep"],
        max_budget_usd: 2.5,
      },
      "/workspace",
      control,
      '{"claudeAiOauth":{"accessToken":"claude-token"}}',
    );
    assert.deepEqual(command.argv, [
      "claude",
      "-p",
      "review the ticket",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--mcp-config",
      join(control, "mcp.json"),
      "--strict-mcp-config",
      "--allowedTools",
      "Read,Grep,mcp__chug__submit_result",
      "--model",
      "claude-model",
      "--effort",
      "high",
      "--max-budget-usd",
      "2.5",
    ]);
    assert.equal(command.environment["CLAUDE_CONFIG_DIR"], control);
    assert.equal(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(control, ".credentials.json"), "utf8"),
      ),
      '{"claudeAiOauth":{"accessToken":"claude-token"}}',
    );
  } finally {
    await rm(control, { recursive: true, force: true });
  }
});

test("the adopted script worker checks out, executes, and reports through its callback", async () => {
  const root = await mkdtemp(join(tmpdir(), "ticket-worker-"));
  const { remote, commit } = await ticketRepository(root);
  const workspace = join(root, "workspace");
  const prior = globalThis.fetch;
  const priorTask = process.env["CHUG_TICKET_WORKER_TASK"];
  let reported: unknown;
  globalThis.fetch = (_input, init) => {
    if (typeof init?.body !== "string")
      throw new Error("callback body is absent");
    reported = JSON.parse(init.body) as unknown;
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  process.env["CHUG_TICKET_WORKER_TASK"] = JSON.stringify({
    taskKey: "work:1:1",
    callbackUrl: "https://callback.invalid/terminal",
    bearer: "attempt-secret",
    workspace,
    timeoutSecsMax: 10,
    outputBytesMax: 4096,
    transportUrl: remote,
    view: {
      workload: {
        runner: "script",
        command: [
          process.execPath,
          "-e",
          'const task=JSON.parse(process.env.CHUG_TASK); console.log(JSON.stringify({verdict:"arbitrary",findings:"opaque",launcher:process.env.CHUG_TICKET_WORKER_TASK,leaked:Object.hasOwn(task,"bearer")}))',
        ],
      },
      inputs: {},
      resultContract: { type: "object" },
      requiredCapabilities: [],
      context: [],
      repository: remote,
      commit,
      access: "ReadRepository",
    },
  });
  try {
    await ticketWorkerMain(process.env);
    assert.deepEqual(reported, {
      taskKey: "work:1:1",
      outcome: {
        type: "result",
        manifest: {
          verdict: "arbitrary",
          findings: "opaque",
          leaked: false,
        },
        outputs: [],
      },
    });
  } finally {
    globalThis.fetch = prior;
    if (priorTask === undefined) delete process.env["CHUG_TICKET_WORKER_TASK"];
    else process.env["CHUG_TICKET_WORKER_TASK"] = priorTask;
    await rm(root, { recursive: true, force: true });
  }
});
