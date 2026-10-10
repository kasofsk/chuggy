/**
 * The other processes the setup program deals with: itself started again to
 * outlive this run, a command of the machine's that opens a browser, and one
 * whose answer is read.
 *
 * None is given this run's output to write to, and none holds it open. The
 * one that is read is given nothing to read itself, and what it says of a
 * failure is dropped unread. It is waited on for a bounded time and read up
 * to a bounded length, and past either it is ended, its output is let go of
 * and the answer is that there is none, whatever it left running behind it.
 * A command the system would not start at all is one that did not start,
 * whether it says so at once or afterwards.
 */

import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

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

/** Starts a command, or nothing where there is none to start or the system refused before there was a process to hear from. */
function started(
  command: readonly string[],
  options: SpawnOptions,
): ChildProcess | undefined {
  const [program, ...rest] = command;
  if (program === undefined) return undefined;
  try {
    return spawn(program, rest, options);
  } catch {
    return undefined;
  }
}

function launch(
  command: readonly string[],
  waitMs: number,
): Promise<SetupLaunched> {
  return new Promise<SetupLaunched>((resolve) => {
    const child = started(command, { detached: true, stdio: "ignore" });
    if (child === undefined) {
      resolve({ launched: "Unstarted" });
      return;
    }
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

function read(
  command: readonly string[],
  waitMs: number,
  bytesMax: number,
): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const child = started(command, { stdio: ["ignore", "pipe", "ignore"] });
    const said = child?.stdout;
    if (child === undefined || said === null || said === undefined) {
      resolve(undefined);
      return;
    }
    const printed: Buffer[] = [];
    let bytes = 0;
    const ended = (answer: string | undefined): void => {
      clearTimeout(waiting);
      child.kill("SIGKILL");
      said.destroy();
      resolve(answer);
    };
    const waiting = setTimeout(() => {
      ended(undefined);
    }, waitMs);
    said.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > bytesMax) ended(undefined);
      else printed.push(chunk);
    });
    child.once("error", () => {
      ended(undefined);
    });
    child.once("close", (exit) => {
      ended(exit === 0 ? Buffer.concat(printed).toString("utf8") : undefined);
    });
  });
}

/** `script` is this program's own file, run again under the Node and the flags this run was started with. */
export function processesOf(script: string): SetupProcessPort {
  return {
    pid: process.pid,
    alive,
    detach: (argv) => {
      const child = started(
        [process.execPath, ...process.execArgv, script, ...argv],
        { detached: true, stdio: "ignore" },
      );
      child?.once("error", () => undefined);
      child?.unref();
      return child?.pid;
    },
    launch,
    read,
  };
}
