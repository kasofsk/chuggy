/**
 * The setup program run as a person's agent runs it: a process of its own,
 * with a home directory nothing else uses and a stand-in for the browser.
 *
 * The program is the entry in the sources unless `CHUG_SETUP_PROGRAM` names a
 * built file, so one set of cases proves both. The opener it is given records
 * the address it was handed and opens nothing, and the suite then plays the
 * person. Every run is started in a folder of its home's own, so what the
 * program reads of the folder it is run in is that folder, and what a run
 * that lost its home writes there is not this checkout. A case that wants the
 * folder to be a git checkout has the harness make it one, and git is told to
 * look no higher than the home's own root, so a folder that is no checkout is
 * none wherever the suite itself was started.
 *
 * A run is given nothing of the suite's own surroundings. Its environment is
 * the few names a home sets and what its case adds, and the only programs it
 * finds by name are the ones in its home's own directory of them: a link to
 * the real git, and whatever a case puts there. So nothing a run starts is
 * this machine's service manager, container engine or package manager, and
 * nothing it looks for under a configuration directory is this person's. A
 * case may say the machine is another kind than the one the suite runs on,
 * and the user another than the one the suite runs as.
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

import assert from "node:assert/strict";
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
  symlinkSync,
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
  /** The one directory a run finds programs in by name, unless its case names another. */
  readonly bin: string;
  /** The folder every run under this home is started in, empty until a case puts something there. */
  readonly folder: string;
  /** Everything every run under this home wrote to either stream. */
  readonly written: string[];
  /** Makes the folder a git checkout whose `origin` is the address given, or one with no remote where none is. */
  readonly checkout: (origin?: string) => Promise<void>;
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

/** One helper process of a suite's own, read to its end under the same bounds as the program, and a failure where it did not end well. */
async function helped(
  command: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const [program = "", ...rest] = command;
  const done = await finished(
    spawn(program, rest, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(done.code, 0, `${command.join(" ")}: ${done.stderr}`);
  return done.stdout;
}

/**
 * A command the program printed, split into words by the shell an agent
 * would hand it to. The words are printed and nothing is run, so what comes
 * back is what the program would be given as its arguments.
 */
export async function shellWords(command: string): Promise<readonly string[]> {
  const printed = await helped(
    ["/bin/sh", "-c", `set -- ${command}\nprintf '%s\\0' "$@"`],
    tmpdir(),
    {},
  );
  return printed.split("\0").slice(0, -1);
}

const line = /^(site|found|step|did|tell|ask|rule|next): \S.*$/u;

/** What every run prints: lines of the dialect, one `next:` and it last, and nothing on the other stream. */
export function dialect(done: Ran, said: string): void {
  assert.equal(done.stderr, "", said);
  assert.ok(done.stdout.endsWith("\n"), said);
  assert.ok(done.lines.length > 0, said);
  for (const text of done.lines) assert.match(text, line, said);
  assert.deepEqual(
    done.lines.filter((text) => text.startsWith("next: ")),
    [done.lines.at(-1)],
    said,
  );
}

/** The name a case gives the kind of machine a run is to take itself for, where that is not the suite's own. */
export const platformSaid = "CHUG_STAND_IN_PLATFORM";

/** The name a case gives the user a run is to take itself for, by number, where that is not the one the suite runs as. */
export const userSaid = "CHUG_STAND_IN_USER";

/** What every Node process under a home runs first: its number written where the suite will look, or nothing run at all; and the kind of machine and the user its case says it is. */
function registrar(running: string): string {
  return [
    'import { rmSync, writeFileSync } from "node:fs";',
    `const mine = ${JSON.stringify(running)} + "/" + process.pid;`,
    `try { writeFileSync(mine, ""); } catch { process.exit(${String(unregisteredExit)}); }`,
    'process.once("exit", () => { try { rmSync(mine, { force: true }); } catch {} });',
    `const platform = process.env[${JSON.stringify(platformSaid)}];`,
    'if (platform !== undefined) Object.defineProperty(process, "platform", { value: platform });',
    `const user = process.env[${JSON.stringify(userSaid)}];`,
    'if (user !== undefined) Object.defineProperty(process, "getuid", { value: () => Number(user) });',
  ].join("\n");
}

/** The first program of this name the suite itself finds, which is the real one. */
function real(name: string): string {
  const found = (process.env["PATH"] ?? "")
    .split(":")
    .filter((directory) => directory.startsWith("/"))
    .map((directory) => join(directory, name))
    .find((path) => existsSync(path));
  if (found === undefined) throw new Error(`the suite found no ${name}`);
  return found;
}

/** Whether a process can run nothing more: it is not there, or it is only waiting to be collected. */
export function gone(pid: number): boolean {
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

/** Makes `folder` a git checkout of the suite's own making, whose `origin` is the address given where one is. */
async function checkedOut(
  folder: string,
  kept: string,
  origin: string | undefined,
): Promise<void> {
  const quiet = { PATH: process.env["PATH"], HOME: kept };
  await helped(["git", "init", "--quiet"], folder, quiet);
  if (origin !== undefined)
    await helped(["git", "config", "remote.origin.url", origin], folder, quiet);
}

function home(): Home {
  const root = mkdtempSync(join(tmpdir(), "chuggy-setup-"));
  const kept = join(root, "home");
  const beside = join(root, "beside");
  const folder = join(root, "folder");
  const running = join(root, "running");
  const bin = join(root, "bin");
  const directory = join(kept, ".chuggy-setup");
  const record = join(beside, "opened");
  const opener = join(beside, "opener.sh");
  for (const made of [kept, beside, folder, running, bin]) mkdirSync(made);
  symlinkSync(real("git"), join(bin, "git"));
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
    bin,
    folder,
    written,
    file,
    checkout: (origin) => checkedOut(folder, kept, origin),
    lock: () => {
      if (!existsSync(join(directory, "lock"))) return undefined;
      const said = readdirSync(join(directory, "lock"));
      return said.length === 1 && said[0] === "free" ? undefined : said.join();
    },
    run: async (argv, environment = {}) => {
      const surroundings = {
        HOME: kept,
        PATH: bin,
        GIT_CEILING_DIRECTORIES: root,
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
export async function browsed(
  address: string,
  method = "GET",
): Promise<Response> {
  return fetch(address, {
    method,
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

/** Runs `sign-in` and plays `played` in the browser it opens, answering what the command said. */
export async function signedIn(
  installation: StandIn,
  machine: Home,
  played: (address: string) => Promise<unknown> = person,
): Promise<Ran> {
  const running = machine.run(["sign-in", "--site", installation.site]);
  await played(await machine.opened());
  return running;
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
