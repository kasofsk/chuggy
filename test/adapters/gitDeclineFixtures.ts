/**
 * The ways a bare repository on disk declines a push the way a forge does,
 * shared by the suites that drive a declined promotion over a real remote.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The reason GitHub declines a workflow change with, where the credential lacks the permission. */
export const gitDeclineWorkflowsReason =
  "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission";

/**
 * Installs a `proc-receive` hook in the bare repository at `remote` answering
 * every branch it is handed with the reason given. This is how a repository on
 * disk declines with a reason of its own rather than the way a hook's exit does.
 */
export function gitDeclineByProcReceive(remote: string, reason: string): void {
  execFileSync("git", [
    "-C",
    remote,
    "config",
    "receive.procReceiveRefs",
    "refs/heads",
  ]);
  const hook = join(remote, "hooks", "proc-receive");
  writeFileSync(
    hook,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      "let pending = Buffer.alloc(0);",
      "function more() {",
      "  const chunk = Buffer.alloc(65536);",
      "  const read = fs.readSync(0, chunk);",
      "  if (read === 0) process.exit(1);",
      "  pending = Buffer.concat([pending, chunk.subarray(0, read)]);",
      "}",
      "function section() {",
      "  const lines = [];",
      "  for (;;) {",
      "    while (pending.length < 4) more();",
      "    const size = parseInt(pending.subarray(0, 4).toString(), 16);",
      "    if (size === 0) { pending = pending.subarray(4); return lines; }",
      "    while (pending.length < size) more();",
      "    lines.push(pending.subarray(4, size).toString().trim());",
      "    pending = pending.subarray(size);",
      "  }",
      "}",
      "function write(lines) {",
      '  const said = lines.map((line) => (Buffer.byteLength(line) + 5).toString(16).padStart(4, "0") + line + "\\n");',
      '  fs.writeSync(1, said.join("") + "0000");',
      "}",
      "section();",
      'write(["version=1"]);',
      `write(section().map((command) => "ng " + command.split(" ")[2] + " " + ${JSON.stringify(reason)}));`,
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o700);
}
