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

function configuredArguments(task) {
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

export function claudeInvocation(task) {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    resultSchema,
    "--permission-mode",
    "bypassPermissions",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    ...configuredArguments(task),
    task.briefing.text,
  ];
}
