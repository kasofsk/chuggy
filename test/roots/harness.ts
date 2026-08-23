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

export async function signalledCommandRun(
  program: string,
  ready: (stdout: string) => boolean,
): Promise<SignalledRun> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let running!: () => void;
  const started = new Promise<void>((resolve) => {
    running = resolve;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (ready(stdout)) running();
  });
  await started;
  child.kill("SIGTERM");
  const [code] = (await once(child, "exit")) as [number];
  return { code, stdout };
}
