/**
 * The finalizer as a command, run the way a deployment runs it: a real child
 * process, a real git, real files and no container, cluster or database.
 *
 * A MISCONFIGURATION AND A MISSING PREREQUISITE LEAVE DIFFERENTLY, and that is
 * what most of this asserts. Every precondition this process depends on is
 * named on the way out, none of them is ever reported as readiness, and a
 * signal ends the process inside the drain it was configured with.
 *
 * NOTHING IT SAYS CARRIES A SECRET. The credential the fixture writes is
 * checked for in everything the process writes, because a diagnostic is the
 * cheapest way for one to escape.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

/** The secret the fixture stands in a file, which must reach nothing the process writes. */
const fixtureSecret = "fixture-secret-a1b2c3";

/** A database nothing answers on, so the schema precondition is refused at once. */
const refusedDatabase = "postgres://finalizer@127.0.0.1:1/chuggy";

type Environment = Readonly<Record<string, string>>;

interface Ran {
  readonly code: number | null;
  readonly stderr: string;
}

interface Fixture {
  readonly root: string;
  readonly environment: Environment;
}

function fixture(t: TestContext, overrides: Environment = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "chuggy-finalizer-root-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const credential = join(root, "credential");
  writeFileSync(credential, `${fixtureSecret}\n`);
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  return {
    root,
    environment: {
      PATH: process.env["PATH"] ?? "",
      HOME: root,
      CHUG_FINALIZER_DATABASE_URL: refusedDatabase,
      CHUG_FINALIZER_OWNER: "finalizer-1",
      CHUG_FINALIZER_RECOVERY_EPOCH: "epoch-1",
      CHUG_FINALIZER_ARTIFACT_ROOT: artifacts,
      CHUG_FINALIZER_GIT_SCRATCH_ROOT: join(root, "scratch"),
      CHUG_FINALIZER_GIT_COMMIT_NAME: "chuggy",
      CHUG_FINALIZER_GIT_COMMIT_EMAIL: "chuggy@example.invalid",
      CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
        { repository: "https://example.invalid/one.git", path: credential },
      ]),
      ...overrides,
    },
  };
}

/** A listener that accepts a connection and ends it after the wait, so a start can be caught in flight. */
async function stallingDatabase(
  t: TestContext,
  holdMilliseconds: number,
): Promise<string> {
  const held = new Set<Socket>();
  const server = createServer((socket) => {
    held.add(socket);
    const end = setTimeout(() => {
      socket.destroy();
    }, holdMilliseconds);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(end);
      held.delete(socket);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of held) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  );
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `postgres://finalizer@127.0.0.1:${String(address.port)}/chuggy`;
}

function finalizerSpawn(environment: Environment): ChildProcess {
  return spawn(
    process.execPath,
    ["--experimental-strip-types", "src/roots/finalizer.ts"],
    { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function finalizerRan(
  child: ChildProcess,
  onStarting?: () => void,
  onReady?: () => void,
): Promise<Ran> {
  return new Promise((resolve) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (chunk.includes("starting")) onStarting?.();
      if (chunk.includes("ready")) onReady?.();
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

/** Runs the command to its own end, holding everything it wrote to the secret it never says. */
async function finalizerRun(environment: Environment): Promise<Ran> {
  const ran = await finalizerRan(finalizerSpawn(environment));
  assert.equal(ran.stderr.includes(fixtureSecret), false);
  return ran;
}

/** Runs the command and signals it the moment it starts, which is while its start is in flight. */
async function finalizerInterrupted(environment: Environment): Promise<Ran> {
  const child = finalizerSpawn(environment);
  const ran = await finalizerRan(child, () => {
    child.kill("SIGTERM");
  });
  assert.equal(ran.stderr.includes(fixtureSecret), false);
  return ran;
}

test("a configuration this cannot parse names the variable and is not a prerequisite", async (t) => {
  const { environment } = fixture(t);
  const { CHUG_FINALIZER_OWNER: dropped, ...rest } = environment;
  assert.ok(dropped !== undefined);
  const ran = await finalizerRun(rest);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /CHUG_FINALIZER_OWNER is required/u);
});

test("each local prerequisite this deployment lacks is named on the way out", async (t) => {
  const { root, environment } = fixture(t);
  const empty = join(root, "empty-path");
  mkdirSync(empty);
  const locked = join(root, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  for (const [precondition, overrides] of [
    ["git-available", { PATH: empty }],
    [
      "git-scratch-writable",
      { CHUG_FINALIZER_GIT_SCRATCH_ROOT: join(locked, "scratch") },
    ],
    [
      "artifact-root-writable",
      { CHUG_FINALIZER_ARTIFACT_ROOT: join(root, "unmounted") },
    ],
    [
      "repository-credentials-available",
      {
        CHUG_FINALIZER_CREDENTIAL_SOURCES: JSON.stringify([
          {
            repository: "https://example.invalid/one.git",
            path: join(root, "unmounted-credential"),
          },
        ]),
      },
    ],
  ] as const) {
    const ran = await finalizerRun({ ...environment, ...overrides });
    assert.equal(ran.code, 2, precondition);
    assert.match(ran.stderr, new RegExp(`${precondition} is not met`, "u"));
    assert.equal(ran.stderr.includes("ready"), false, precondition);
  }
});

test("a database that is not there is a could-not-run and never a readiness", async (t) => {
  const ran = await finalizerRun(fixture(t).environment);
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /starting/u);
  assert.match(ran.stderr, /schema-compatible is not met/u);
  assert.match(ran.stderr, /stopped/u);
  assert.equal(ran.stderr.includes("ready"), false);
});

test("a signal ends a start that is still in flight", async (t) => {
  const { environment } = fixture(t, {
    CHUG_FINALIZER_DATABASE_URL: await stallingDatabase(t, 400),
  });
  const ran = await finalizerInterrupted(environment);
  assert.equal(ran.code, 0);
  assert.match(ran.stderr, /stopped/u);
  assert.equal(ran.stderr.includes("ready"), false);
});

/** A dead loop, put to the command's own run against a runtime that reports one. */
const deadLoopProgram = `
  const root = await import('./src/roots/finalizer.ts');
  const dead = { live: false, ready: false, failure: 'lost authority' };
  const runtime = {
    start: () => Promise.resolve({ started: 'Started' }),
    health: () => dead,
    settled: () => new Promise((resolve) => setTimeout(() => resolve(dead), 1)),
    stop: () => Promise.resolve({ stopped: 'Stopped' }),
  };
  await root.finalizerRun(runtime);
`;

/** A run a signal ends, which settles live and must read as no failure at all. */
const orderlyStopProgram = `
  const root = await import('./src/roots/finalizer.ts');
  let end;
  const settled = new Promise((resolve) => { end = resolve; });
  const running = setInterval(() => {}, 1000);
  const runtime = {
    start: () => Promise.resolve({ started: 'Started' }),
    health: () => ({ live: true, ready: true }),
    settled: () => settled,
    stop: () => {
      clearInterval(running);
      end({ live: true, ready: false });
      return Promise.resolve({ stopped: 'Stopped' });
    },
  };
  await root.finalizerRun(runtime);
`;

/**
 * A quantum that ignores its abort until well past the drain, driven by the
 * real runtime, which is the only way the late settlement is reached at all.
 */
const overRunningQuantumProgram = `
  const root = await import('./src/roots/finalizer.ts');
  const { serviceRuntime } = await import('./src/interpreter/serviceRuntime.ts');
  const pacing = {
    wait: (milliseconds, signal) => new Promise((resolve) => {
      const timeout = setTimeout(resolve, milliseconds);
      signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
    }),
  };
  const runtime = serviceRuntime(
    { run: () => new Promise((resolve) => setTimeout(resolve, 600)) },
    pacing,
    [],
    { idleIntervalMilliseconds: 10, shutdownDrainMilliseconds: 100 },
  );
  await root.finalizerRun(runtime);
`;

function finalizerProgram(source: string): ChildProcess {
  return spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Runs one module program and signals it the moment it reports readiness. */
function finalizerProgramSignalled(source: string): Promise<Ran> {
  const child = finalizerProgram(source);
  return finalizerRan(child, undefined, () => {
    child.kill("SIGTERM");
  });
}

test("a loop that dies leaves the failure on stderr and a non-zero status", async () => {
  const ran = await finalizerRan(finalizerProgram(deadLoopProgram));
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stderr.trimEnd().split("\n"), [
    "finalizer: starting",
    "finalizer: ready",
    "finalizer: lost authority",
    "finalizer: stopped",
  ]);
});

test("a signalled run settles live and leaves no failure and a zero status", async () => {
  const ran = await finalizerProgramSignalled(orderlyStopProgram);
  assert.equal(ran.code, 0);
  assert.deepEqual(ran.stderr.trimEnd().split("\n"), [
    "finalizer: starting",
    "finalizer: ready",
    "finalizer: stopped",
  ]);
});

test("a drain the quantum outlasts is reported once, not again when it returns", async () => {
  const ran = await finalizerProgramSignalled(overRunningQuantumProgram);
  assert.equal(ran.code, 1);
  assert.deepEqual(ran.stderr.trimEnd().split("\n"), [
    "finalizer: starting",
    "finalizer: ready",
    "finalizer: the shutdown drain expired",
  ]);
});

test("a shutdown that outlasts its drain says so rather than waiting", async (t) => {
  const { environment } = fixture(t, {
    CHUG_FINALIZER_DATABASE_URL: await stallingDatabase(t, 800),
    CHUG_FINALIZER_SHUTDOWN_DRAIN_MS: "300",
  });
  const ran = await finalizerInterrupted(environment);
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /the shutdown drain expired/u);
});
