/**
 * The composition root as a child process: with no fabric environment it comes
 * up serving on the stubs, and with the fabric environment naming an
 * unservable catalog it refuses to start — which is the two halves of the
 * env-gated wiring, exercised through the same entrypoint `npm start` runs.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

const composeRoot = join(import.meta.dirname, "..", "..");

const composeBaseEnv = {
  CHUGGY_OAUTH_CLIENT_ID: "client",
  CHUGGY_ADMIN_SUBJECT: "operator",
  CHUGGY_JOB_SECRET: "secret",
  CHUGGY_PORT: "0",
};

interface ComposeRun {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  output: () => string;
}

/** Boots the real entrypoint with exactly the handed environment, collecting both streams. */
function composeRun(
  t: TestContext,
  env: Readonly<Record<string, string>>,
): ComposeRun {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-compose-"));
  const child = spawn(
    process.execPath,
    ["src/compose.ts", join(dir, "chuggy.sqlite")],
    {
      cwd: composeRoot,
      env: { PATH: process.env["PATH"] ?? "", ...env },
    },
  );
  let held = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    held += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    held += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });
  t.after(async () => {
    child.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  });
  return { child, exited, output: () => held };
}

const composeTriesMax = 400;

/** Polls the child's output, bounded, so a hung boot fails the case rather than the runner. */
async function composeUntil(read: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < composeTriesMax; tries++) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waited out ${what}`);
}

test("with no fabric environment the deployment serves on the stubs", async (t) => {
  const run = composeRun(t, composeBaseEnv);
  await composeUntil(
    () => run.output().includes("the desk is serving"),
    "the stub deployment to serve",
  );
});

test("the fabric environment constructs the fabric, whose unservable catalog refuses start-up", async (t) => {
  const run = composeRun(t, {
    ...composeBaseEnv,
    CHUGGY_FABRIC_API_BASE: "http://127.0.0.1:9",
    CHUGGY_FABRIC_CATALOG: join(tmpdir(), "chuggy-compose-absent.json"),
    CHUGGY_COMPLETION_URL: "http://127.0.0.1:9/",
  });
  const code = await run.exited;
  assert.notEqual(code, 0);
  assert.match(run.output(), /the catalog at .* cannot be read/);
});
