/**
 * The worker plane command: which routes a composed plane actually answers, and
 * what it says about an environment it cannot start under.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. `src/roots/` is the
 * graph's executable roots and `.dependency-cruiser.cjs` forbids importing one,
 * so the command is run and then asked over its own socket.
 *
 * THE SESSION HALF IS PROVED BY ASKING FOR IT, not by reading the composition.
 * `createWorkerPlaneApp` registers the session routes only where the service
 * carries a session plane, so a route that answers at all is the root having
 * composed one — and a route that answers `401` is that route standing in front
 * of an authority rather than a stray catch-all. The unregistered path beside
 * them is what makes the distinction discriminating: it is the answer these
 * would give if the field were absent.
 *
 * NO DATABASE IS REACHED. Every probe below is refused before its authority is
 * consulted, so the plane's pool never has to be a real server.
 */

import assert from "node:assert/strict";
import { execFile, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "chuggy-worker-plane-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A port nothing is listening on, which is the only way to hand the root one. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const listening = server.address();
  const port =
    typeof listening === "object" && listening !== null ? listening.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  assert.notEqual(port, 0, "no ephemeral port was offered");
  return port;
}

/** The complete environment, so a case can make one variable at a time the subject. */
function planeEnvironment(port: number): Readonly<Record<string, string>> {
  return {
    CHUG_WORKER_PLANE_DATABASE_URL:
      "postgres://chuggy_worker_plane@127.0.0.1:1/chuggy",
    CHUG_WORKER_PLANE_ARTIFACT_ROOT: root,
    CHUG_WORKER_PLANE_PORT: String(port),
  };
}

/** Every variable the command refuses to start without. */
const required = [
  "CHUG_WORKER_PLANE_DATABASE_URL",
  "CHUG_WORKER_PLANE_ARTIFACT_ROOT",
];

/** How many times a started plane is asked whether it is listening yet. */
const readyPollsMax = 100;
const readyPollMs = 50;

function planeProcess(named: Readonly<Record<string, string>>): ChildProcess {
  return execFile(
    process.execPath,
    ["--experimental-strip-types", "src/roots/workerPlane.ts"],
    { cwd: process.cwd(), env: { ...process.env, ...named } },
  );
}

/** Whether the plane is listening yet, a socket nothing holds being the usual answer. */
async function planeLive(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${String(port)}/health/live`)).ok;
  } catch {
    return false;
  }
}

/** Waits for that liveness, which is the only readiness the plane owes without a database. */
async function planeListening(
  port: number,
  child: ChildProcess,
): Promise<void> {
  for (let poll = 0; poll < readyPollsMax; poll += 1) {
    if (child.exitCode !== null)
      throw new Error(`the plane exited ${String(child.exitCode)}`);
    if (await planeLive(port)) return;
    await new Promise((resolve) => setTimeout(resolve, readyPollMs));
  }
  throw new Error("the plane never listened");
}

/** What one probe of a started plane answered. */
interface Probed {
  readonly path: string;
  readonly status: number;
}

async function planeProbes(
  port: number,
  paths: readonly string[],
): Promise<readonly Probed[]> {
  const probed: Probed[] = [];
  for (const path of paths) {
    const answered = await fetch(`http://127.0.0.1:${String(port)}${path}`);
    probed.push({ path, status: answered.status });
  }
  return probed;
}

/** The command's own exit and what it left on stderr, which is where a refusal lands. */
interface PlaneRefused {
  readonly code: number | null;
  readonly stderr: string;
}

/**
 * How long a refusal is waited for. A command that starts instead of refusing
 * listens forever, so the wait is bounded and the case fails rather than hangs.
 */
const refusalMsMax = 30_000;

async function planeRefusal(
  named: Readonly<Record<string, string>>,
): Promise<PlaneRefused> {
  const child = planeProcess(named);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const gaveUp = setTimeout(() => child.kill("SIGKILL"), refusalMsMax);
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  clearTimeout(gaveUp);
  return { code, stderr };
}

test("a started plane answers its session routes and refuses each without a bearer", async () => {
  const port = await freePort();
  const child = planeProcess(planeEnvironment(port));
  try {
    await planeListening(port, child);
    const probed = await planeProbes(port, [
      "/v1/session",
      "/v1/session/turn",
      "/v1/session/store",
      "/v1/session/composed-by-nothing",
    ]);
    assert.deepEqual(probed, [
      { path: "/v1/session", status: 401 },
      { path: "/v1/session/turn", status: 401 },
      { path: "/v1/session/store", status: 401 },
      { path: "/v1/session/composed-by-nothing", status: 404 },
    ]);
  } finally {
    child.kill("SIGKILL");
  }
});

test("every prerequisite variable is refused by its own name", async () => {
  const port = await freePort();
  for (const name of required) {
    const named = Object.fromEntries(
      Object.entries(planeEnvironment(port)).filter(([each]) => each !== name),
    );
    const refused = await planeRefusal({ ...named, [name]: "" });
    assert.equal(refused.code, 1, name);
    assert.match(refused.stderr, new RegExp(`${name} is required`, "u"), name);
  }
});

test("a session bound that is not a positive integer is refused by its own name", async () => {
  const port = await freePort();
  for (const name of [
    "CHUG_WORKER_PLANE_SESSION_HEARTBEAT_LEASE_SECS",
    "CHUG_WORKER_PLANE_SESSION_TURN_POLL_INTERVAL_MS",
    "CHUG_WORKER_PLANE_SESSION_TURN_POLL_SECS_MAX",
    "CHUG_WORKER_PLANE_SESSION_POLLS_MAX",
  ]) {
    const refused = await planeRefusal({
      ...planeEnvironment(port),
      [name]: "0",
    });
    assert.equal(refused.code, 1, name);
    assert.match(
      refused.stderr,
      new RegExp(`${name} must be a positive integer`, "u"),
      name,
    );
  }
});
