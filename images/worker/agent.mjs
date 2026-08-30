import { claudeAgent } from "./claude.mjs";
import { codexAgent } from "./codex.mjs";

export function workerAgent(task) {
  const mode = task.worker?.mode;
  if (mode === undefined && Array.isArray(task.worker?.arguments))
    return claudeAgent;
  if (mode?.type !== "SingleAgent")
    throw new Error("worker mode is not SingleAgent");
  switch (mode.agent) {
    case "Claude":
      return claudeAgent;
    case "Codex":
      return codexAgent;
    default:
      throw new Error(`worker agent ${String(mode.agent)} is not supported`);
  }
}
