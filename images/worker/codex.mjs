import { agentResult } from "./result.mjs";

const reservedCodexArguments = [
  "exec",
  "--json",
  "--output-schema",
  "--output-last-message",
  "--cd",
  "-C",
  "--ephemeral",
  "--sandbox",
  "-s",
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  "--resume",
];

function configuredArguments(task) {
  const args = task.worker?.mode?.arguments ?? [];
  for (const argument of args) {
    if (
      reservedCodexArguments.some(
        (reserved) =>
          argument === reserved || argument.startsWith(`${reserved}=`),
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
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-schema",
    paths.resultSchema,
    ...configuredArguments(task),
    task.briefing.text,
  ];
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
  credential: "openai-api-key",
  invocation: codexInvocation,
  result: codexResult,
  environment: (token) => ({ OPENAI_API_KEY: token }),
  configurationEvent: () => false,
  resultEvent: (event) => codexMessage(event) !== undefined,
  observed: codexObserved,
};
