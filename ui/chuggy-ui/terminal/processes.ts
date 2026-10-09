/**
 * The other processes the setup program deals with: itself started again to
 * outlive this run, and a command of the machine's that opens a browser.
 *
 * Neither is given this run's output to write to, and neither holds it open.
 */

import { spawn } from "node:child_process";

import type {
  SetupLaunched,
  SetupProcessPort,
} from "../app/core/setupPorts.ts";

/** Asks the system about the process without signalling it; one that is another person's is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure: unknown) {
    return (
      failure instanceof Error &&
      (failure as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

function launch(
  command: readonly string[],
  waitMs: number,
): Promise<SetupLaunched> {
  return new Promise<SetupLaunched>((resolve) => {
    const [program, ...rest] = command;
    if (program === undefined) {
      resolve({ launched: "Unstarted" });
      return;
    }
    const child = spawn(program, rest, { detached: true, stdio: "ignore" });
    const running = setTimeout(() => {
      child.unref();
      resolve({ launched: "Running" });
    }, waitMs);
    child.once("error", () => {
      clearTimeout(running);
      resolve({ launched: "Unstarted" });
    });
    child.once("exit", (exit) => {
      clearTimeout(running);
      resolve({ launched: "Ended", exit: exit ?? 1 });
    });
  });
}

/** `script` is this program's own file, run again under the Node and the flags this run was started with. */
export function processesOf(script: string): SetupProcessPort {
  return {
    pid: process.pid,
    alive,
    detach: (argv) => {
      const child = spawn(
        process.execPath,
        [...process.execArgv, script, ...argv],
        { detached: true, stdio: "ignore" },
      );
      child.once("error", () => undefined);
      child.unref();
      return child.pid;
    },
    launch,
  };
}
