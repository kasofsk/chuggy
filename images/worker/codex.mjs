import { agentResult } from "./result.mjs";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const codexHome = "/tmp/chuggy-codex-home";
const executeFile = promisify(execFile);

const reservedCodexArguments = [
  "exec",
  "--json",
  "--output-schema",
  "--output-last-message",
  "--cd",
  "-C",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--model",
  "-m",
  "--config",
  "-c",
  "--profile",
  "-p",
  "--oss",
  "--local-provider",
  "--sandbox",
  "-s",
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  "--resume",
];

const reservedCodexShortArguments = ["-m", "-c", "-p", "-s", "-C"];

function configuredArguments(task) {
  const args = task.worker?.mode?.arguments ?? [];
  for (const argument of args) {
    if (
      reservedCodexArguments.some(
        (reserved) =>
          argument === reserved || argument.startsWith(`${reserved}=`),
      ) ||
      reservedCodexShortArguments.some(
        (reserved) =>
          argument.startsWith(reserved) && argument.length > reserved.length,
      )
    )
      throw new Error(
        `worker configuration reserves Codex argument ${argument}`,
      );
  }
  return args;
}

export function codexInvocation(task, paths) {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--model",
    task.worker.mode.model,
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-schema",
    paths.resultSchema,
    ...configuredArguments(task),
    task.briefing.text,
  ];
}

export async function codexConfiguration(
  task,
  environment,
  execute = executeFile,
) {
  const { stdout } = await execute("codex", ["--version"], {
    env: environment,
    maxBuffer: 4096,
  });
  const version = stdout.trim();
  if (version.length === 0)
    throw new Error("Codex reported no runtime version");
  return {
    agent: "Codex",
    codexVersion: version,
    model: task.worker.mode.model,
    userConfig: "Ignored",
    projectRules: "Ignored",
  };
}

function codexMessage(event) {
  if (event?.type !== "item.completed" || event.item?.type !== "agent_message")
    return undefined;
  return event.item.text;
}

export function codexResult(events) {
  const output = events.findLast((event) => codexMessage(event) !== undefined);
  const text = codexMessage(output);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Codex returned no structured verdict");
  }
  return { output, result: agentResult(parsed, "Codex") };
}

export async function prepareCodexCredential(auth, home = codexHome) {
  let document;
  try {
    document = JSON.parse(auth);
  } catch {
    throw new Error("Codex OAuth credential is not an auth.json document");
  }
  if (document === null || typeof document !== "object")
    throw new Error("Codex OAuth credential is not an auth.json document");
  await mkdir(home, { recursive: false });
  await writeFile(`${home}/auth.json`, `${auth}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  const tokens = Object.values(document.tokens ?? {}).filter(
    (value) => typeof value === "string",
  );
  return {
    environment: { CODEX_HOME: home },
    secrets: [auth, ...tokens],
  };
}

function codexObserved(event) {
  if (event?.type !== "turn.completed") return undefined;
  return {
    usage: {
      input_tokens: event.usage?.input_tokens,
      output_tokens: event.usage?.output_tokens,
      cache_read_input_tokens: event.usage?.cached_input_tokens,
    },
    num_turns: 1,
  };
}

export const codexAgent = {
  name: "Codex",
  runtime: "Codex",
  executable: "codex",
  credential: "codex-auth",
  invocation: codexInvocation,
  result: codexResult,
  prepareCredential: prepareCodexCredential,
  configuration: codexConfiguration,
  configurationEvent: () => false,
  resultEvent: (event) => codexMessage(event) !== undefined,
  observed: codexObserved,
};
