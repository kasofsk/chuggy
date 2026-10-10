/**
 * The setup program run as a person's agent runs it: a process of its own,
 * with a home directory nothing else uses and a stand-in for the browser.
 *
 * The program is the entry in the sources unless `CHUG_SETUP_PROGRAM` names a
 * built file, so one set of cases proves both. The opener it is given records
 * the address it was handed and opens nothing, and the suite then plays the
 * person. Every run is started in a folder of its home's own, so what the
 * program reads of the folder it is run in is that folder, and what a run
 * that lost its home writes there is not this checkout.
 *
 * Nothing here waits without a bound and nothing outlives its suite. A
 * process still running at its deadline, or one that wrote more than any
 * report is, is killed and is its case's failure. Every process started under
 * a home, the listener a sign-in leaves behind among them, writes its own
 * number down as it starts, in a directory beside the home that is the
 * suite's; ending a home closes that directory to newcomers, kills each
 * process named in it and removes the home only once they are gone, so none
 * is left to make it again.
 */

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { after } from "node:test";
import { setTimeout as slept } from "node:timers/promises";

import { standIn } from "./standIn.ts";
import type { StandIn } from "./standIn.ts";

export const program = resolve(
  process.env["CHUG_SETUP_PROGRAM"] ?? "ui/chuggy-ui/terminal/main.ts",
);

const pollMs = 50;
const waitMsMax = 20_000;

/** Past the longest any case has a process run, so what it ends is a hang. */
const runMsMax = 60_000;

/** Past anything a report or a racer says. */
const outputBytesMax = 65_536;

const requestMsMax = 15_000;

/** What a process that could not write its number down exits with, having run nothing. */
const unregisteredExit = 70;

export interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Ran extends Finished {
  readonly lines: readonly string[];
}

export interface Home {
  /** The directory the program is told is the person's home, which only it writes in. */
  readonly home: string;
  /** The program's own directory under this home. */
  readonly directory: string;
  /** A directory beside the home for what a case makes itself. */
  readonly beside: string;
  /** The folder every run under this home is started in, empty until a case puts something there. */
  readonly folder: string;
  /** Everything every run under this home wrote to either stream. */
  readonly written: string[];
  readonly run: (
    argv: readonly string[],
    environment?: Readonly<Record<string, string>>,
  ) => Promise<Ran>;
  /** The address the opener was last handed, once it has been. */
  readonly opened: () => Promise<string>;
  /** A file of the program's as text, or nothing where there is none. */
  readonly file: (name: string) => string | undefined;
  /** What the program's lock says: its holder's word, or nothing where nobody holds it. */
  readonly lock: () => string | undefined;
  /** Ends every process started under this home and removes it; a home already ended is left be. */
  readonly dispose: () => Promise<void>;
}

/** Waits a bounded time for `found` to answer something. */
export async function eventually<T>(found: () => T | undefined): Promise<T> {
  for (let waitedMs = 0; waitedMs < waitMsMax; waitedMs += pollMs) {
    const value = found();
    if (value !== undefined) return value;
    await slept(pollMs);
  }
  throw new Error("what was waited for did not happen");
}

/**
 * Reads a process to its end. One still running at the deadline, or one that
 * wrote past the cap, is killed with its streams closed and is the failure.
 */
export function finished(
  child: ChildProcessByStdio<null, Readable, Readable>,
): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const said = { stdout: "", stderr: "" };
    let bytes = 0;
    const abandoned = (why: string): void => {
      clearTimeout(deadline);
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(why));
    };
    const deadline = setTimeout(() => {
      abandoned("a process was still running at its deadline");
    }, runMsMax);
    const heard = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > outputBytesMax) abandoned("a process wrote past the cap");
      else said[stream] += chunk.toString("utf8");
    };
    child.stdout.on("data", heard("stdout"));
    child.stderr.on("data", heard("stderr"));
    child.once("error", (failure) => {
      clearTimeout(deadline);
      reject(failure);
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolve({ code, ...said });
    });
  });
}

async function ran(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  folder: string,
): Promise<Ran> {
  const done = await finished(
    spawn(process.execPath, [program, ...argv], {
      cwd: folder,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const lines = done.stdout.split("\n").filter((line) => line !== "");
  return { ...done, lines };
}

/** What every Node process under a home runs first: its number written where the suite will look, or nothing run at all. */
function registrar(running: string): string {
  return [
    'import { rmSync, writeFileSync } from "node:fs";',
    `const mine = ${JSON.stringify(running)} + "/" + process.pid;`,
    `try { writeFileSync(mine, ""); } catch { process.exit(${String(unregisteredExit)}); }`,
    'process.once("exit", () => { try { rmSync(mine, { force: true }); } catch {} });',
  ].join("\n");
}

/** Whether a process can run nothing more: it is not there, or it is only waiting to be collected. */
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (failure: unknown) {
    return (failure as NodeJS.ErrnoException).code === "ESRCH";
  }
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return ["Z", "X"].includes(stat.charAt(stat.lastIndexOf(")") + 2));
  } catch {
    return false;
  }
}

/** Kills a process a case left running; one that already went is what was wanted. */
export function ended(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (failure: unknown) {
    if ((failure as NodeJS.ErrnoException).code !== "ESRCH") throw failure;
  }
}

/** Ends every process that wrote its number in `running`, and answers once none can run anything more. */
async function emptied(root: string, running: string): Promise<void> {
  const closed = join(root, "ran");
  renameSync(running, closed);
  const pids = readdirSync(closed)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  for (const pid of pids) ended(pid);
  await eventually(() => (pids.every(gone) ? true : undefined));
}

function home(): Home {
  const root = mkdtempSync(join(tmpdir(), "chuggy-setup-"));
  const kept = join(root, "home");
  const beside = join(root, "beside");
  const folder = join(root, "folder");
  const running = join(root, "running");
  const directory = join(kept, ".chuggy-setup");
  const record = join(beside, "opened");
  const opener = join(beside, "opener.sh");
  for (const made of [kept, beside, folder, running]) mkdirSync(made);
  writeFileSync(join(root, "registrar.mjs"), registrar(running));
  writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > "${record}"\n`);
  chmodSync(opener, 0o755);
  const preload = `--import ${JSON.stringify(join(root, "registrar.mjs"))}`;
  const written: string[] = [];
  const file = (name: string): string | undefined =>
    existsSync(join(directory, name))
      ? readFileSync(join(directory, name), "utf8")
      : undefined;
  return {
    home: kept,
    directory,
    beside,
    folder,
    written,
    file,
    lock: () => {
      if (!existsSync(join(directory, "lock"))) return undefined;
      const said = readdirSync(join(directory, "lock"));
      return said.length === 1 && said[0] === "free" ? undefined : said.join();
    },
    run: async (argv, environment = {}) => {
      const surroundings = {
        ...process.env,
        HOME: kept,
        BROWSER: opener,
        NODE_OPTIONS: [process.env["NODE_OPTIONS"] ?? "", preload]
          .join(" ")
          .trim(),
        ...environment,
      };
      const done = await ran(argv, surroundings, folder);
      written.push(done.stdout, done.stderr);
      return done;
    },
    opened: () =>
      eventually(() => {
        if (!existsSync(record)) return undefined;
        const address = readFileSync(record, "utf8");
        rmSync(record);
        return address;
      }),
    dispose: async () => {
      if (!existsSync(root)) return;
      await emptied(root, running);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** One request of a browser's that follows nothing, so a suite reads each step. */
export async function browsed(address: string): Promise<Response> {
  return fetch(address, {
    redirect: "manual",
    signal: AbortSignal.timeout(requestMsMax),
  });
}

/** The person signing in: the page the opener was handed, the issuer, and back. */
export async function person(address: string): Promise<Response> {
  const first = await browsed(address);
  const second = await browsed(first.headers.get("location") ?? "");
  return browsed(second.headers.get("location") ?? "");
}

export interface Making {
  readonly machine: () => Home;
  readonly installation: () => Promise<StandIn>;
}

/** The homes and stand-in installations a suite makes, each ended when the suite is, and a home that could not be ended is the suite's failure. */
export function making(): Making {
  const homes: Home[] = [];
  const standIns: StandIn[] = [];
  after(async () => {
    const failures: unknown[] = [];
    for (const made of homes)
      await made.dispose().catch((failure: unknown) => failures.push(failure));
    for (const made of standIns) await made.close();
    if (failures.length > 0)
      throw new AggregateError(failures, "a home could not be ended");
  });
  return {
    machine: () => {
      const made = home();
      homes.push(made);
      return made;
    },
    installation: async () => {
      const made = await standIn();
      standIns.push(made);
      return made;
    },
  };
}
