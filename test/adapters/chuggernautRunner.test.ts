import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { prepare_commit } from "../../src/adapters/runtime/commitHooks.ts";

const executeFile = promisify(execFile);

test("adopted publishing strips comments and runs bounded hooks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "chug-hooks-"));
  try {
    await executeFile("git", ["init", "--quiet"], { cwd: workspace });
    await writeFile(join(workspace, "task.js"), "export const value = 1;\n");
    await executeFile("git", ["add", "task.js"], { cwd: workspace });
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
        "base",
      ],
      { cwd: workspace },
    );
    const { stdout } = await executeFile("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
    });
    await writeFile(
      join(workspace, "task.js"),
      "// remove me\nexport const value = 2;\n",
    );
    const commit = await prepare_commit(
      workspace,
      stdout.trim(),
      {
        pre_commit_hooks: [
          [
            process.execPath,
            "-e",
            "require('fs').writeFileSync('hooked','yes')",
          ],
        ],
      },
      () => {},
      process.env,
      "result",
    );
    assert.match(commit, /^[0-9a-f]{40}$/u);
    assert.equal(await readFile(join(workspace, "hooked"), "utf8"), "yes");
    assert.equal(
      await readFile(join(workspace, "task.js"), "utf8"),
      "export const value = 2;\n",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
