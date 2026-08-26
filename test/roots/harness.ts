/**
 * Drives a command's module in a child process until it reports itself running,
 * signals it, and returns what it wrote and how it exited.
 *
 * A SIGNAL NEEDS A LIVE PROCESS. The handler under test is installed on
 * `process`, so a suite that called the command's loop directly would be
 * asserting against its own signal handlers rather than the command's.
 *
 * READINESS IS THE CALLER'S PREDICATE. Each command marks itself running in its
 * own way, and a fixed marker here would make this harness a second place a
 * command's output format is written down.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

export interface SignalledRun {
  readonly code: number;
  readonly stdout: string;
}

const diagnosticBytesMax = 16_384;
const readinessTimeoutMsDefault = 5_000;

function appendDiagnostic(current: Buffer, chunk: Buffer): Buffer {
  if (current.byteLength >= diagnosticBytesMax) return current;
  return Buffer.concat([current, chunk]).subarray(0, diagnosticBytesMax);
}

export async function signalledCommandRun(
  program: string,
  ready: (stdout: string) => boolean,
  readinessTimeoutMs: number = readinessTimeoutMsDefault,
): Promise<SignalledRun> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr: Buffer = Buffer.alloc(0);
  let running!: () => void;
  const started = new Promise<void>((resolve) => {
    running = resolve;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (ready(stdout)) running();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendDiagnostic(stderr, chunk);
  });
  const exited = once(child, "exit") as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  let timeout: NodeJS.Timeout | undefined;
  const readiness = await Promise.race([
    started.then(() => ({ outcome: "Ready" }) as const),
    exited.then(
      ([code, signal]) => ({ outcome: "Exited", code, signal }) as const,
    ),
    once(child, "error").then(([failure]) => {
      throw failure instanceof Error
        ? failure
        : new Error("command process emitted an unknown error");
    }),
    new Promise<{ readonly outcome: "TimedOut" }>((resolve) => {
      timeout = setTimeout(() => {
        resolve({ outcome: "TimedOut" });
      }, readinessTimeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (readiness.outcome === "Exited") {
    throw new Error(
      `command exited before readiness: code=${String(readiness.code)} signal=${String(readiness.signal)} stderr=${stderr.toString("utf8")}`,
    );
  }
  if (readiness.outcome === "TimedOut") {
    child.kill("SIGKILL");
    await exited;
    throw new Error(
      `command readiness exceeded ${readinessTimeoutMs}ms: stderr=${stderr.toString("utf8")}`,
    );
  }
  child.kill("SIGTERM");
  const [code] = await exited;
  if (code === null)
    throw new Error("command exited by signal after readiness");
  return { code, stdout };
}
