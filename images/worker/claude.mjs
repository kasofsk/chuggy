import { agentResult, agentResultSchema } from "./result.mjs";

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

function configuredArguments(task) {
  const args = task.worker?.mode?.arguments ?? task.worker?.arguments ?? [];
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

export function claudeInvocation(task) {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(agentResultSchema),
    "--permission-mode",
    "bypassPermissions",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    ...configuredArguments(task),
    task.briefing.text,
  ];
}

export function claudeResult(events) {
  const output = events.findLast(
    (event) =>
      event?.type === "result" && event.structured_output !== undefined,
  );
  const result = agentResult(output?.structured_output, "Claude Code");
  return { output, result };
}

export const claudeAgent = {
  name: "Claude",
  runtime: "Claude Code",
  executable: "claude",
  credential: "claude-code",
  invocation: claudeInvocation,
  result: claudeResult,
  environment: (token) => ({ CLAUDE_CODE_OAUTH_TOKEN: token }),
  configurationEvent: (event) =>
    event?.type === "system" && event.subtype === "init",
  resultEvent: (event) => event?.type === "result",
  observed: (event) => (event?.type === "result" ? event : undefined),
};
