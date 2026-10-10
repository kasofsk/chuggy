/**
 * The other processes the setup program deals with: itself started again to
 * outlive this run, a command of the machine's that opens a browser, one
 * whose answer is read, and one run to its end for what it does.
 *
 * None is given this run's output to write to, and none holds it open. The
 * one that is read and the one run to its end are each started in a session
 * of its own, with nothing to read and no terminal, so nothing either starts
 * can ask a person for a password. Each is waited on for a bounded time, and
 * at the end of the wait it is ended with everything it started in that
 * session. What started a session of its own in turn is not reached by that,
 * and nothing here ends it. A command the system would not start at all is
 * one that did not start, whether it says so at once or afterwards.
 *
 * The one that is read is read up to a bounded length and what it says of a
 * failure is dropped unread; past the length it is ended as at the end of
 * the wait, its output is let go of and the answer is that there is none.
 * The one run to its end has both its streams read to a bound and drained
 * past it, so it is never held up by a reader that stopped; and once it has
 * ended, what it left running is given a moment to let go of its output and
 * no longer.
 */

import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import type {
  SetupChildEnded,
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

/** Ends a child started in a session of its own with everything it started there. */
function ended(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function read(
  command: readonly string[],
  waitMs: number,
  bytesMax: number,
): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const child = started(command, {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const said = child?.stdout;
    if (child === undefined || said === null || said === undefined) {
      resolve(undefined);
      return;
    }
    const printed: Buffer[] = [];
    let bytes = 0;
    const answer = (answered: string | undefined): void => {
      clearTimeout(waiting);
      said.destroy();
      resolve(answered);
    };
    const cut = (): void => {
      ended(child);
      answer(undefined);
    };
    const waiting = setTimeout(cut, waitMs);
    said.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > bytesMax) cut();
      else printed.push(chunk);
    });
    child.once("error", () => {
      answer(undefined);
    });
    child.once("close", (exit) => {
      answer(exit === 0 ? Buffer.concat(printed).toString("utf8") : undefined);
    });
  });
}

type Said = NonNullable<ChildProcess["stdout"]>;

/** What a stream says, kept up to the bound and read on past it. */
function kept(said: Said, bytesMax: number): () => string {
  const printed: Buffer[] = [];
  let bytes = 0;
  said.on("data", (chunk: Buffer) => {
    const room = bytesMax - bytes;
    if (room > 0) printed.push(chunk.subarray(0, room));
    bytes += chunk.length;
  });
  said.on("error", () => undefined);
  return () => Buffer.concat(printed).toString("utf8");
}

/** How long what a child left running may hold its output open once the child itself has ended. */
const drainMs = 2_000;

function run(
  command: readonly string[],
  waitMs: number,
  bytesMax: number,
): Promise<SetupChildEnded> {
  return new Promise<SetupChildEnded>((resolve) => {
    const child = started(command, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { stdout, stderr } = child ?? { stdout: null, stderr: null };
    if (child === undefined || stdout === null || stderr === null) {
      resolve({ ended: "Unstarted" });
      return;
    }
    const out = kept(stdout, bytesMax);
    const err = kept(stderr, bytesMax);
    const timers: NodeJS.Timeout[] = [];
    const answer = (answered: SetupChildEnded): void => {
      for (const timer of timers) clearTimeout(timer);
      stdout.destroy();
      stderr.destroy();
      resolve(answered);
    };
    timers.push(
      setTimeout(() => {
        ended(child);
        answer({ ended: "Unended" });
      }, waitMs),
    );
    child.once("error", () => {
      answer({ ended: "Unstarted" });
    });
    child.once("exit", (exit) => {
      const exited = (): void => {
        answer({ ended: "Exited", exit: exit ?? 1, out: out(), err: err() });
      };
      child.once("close", exited);
      timers.push(setTimeout(exited, drainMs));
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
    run,
  };
}
