/**
 * The setup program run as a person's agent runs it: a process of its own,
 * with a home directory nothing else uses and a stand-in for the browser.
 *
 * The program is the entry in the sources unless `CHUG_SETUP_PROGRAM` names a
 * built file, so one set of cases proves both. The opener it is given records
 * the address it was handed and opens nothing, and the suite then plays the
 * person. A listener a case leaves waiting is ended with its home.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { setTimeout as slept } from "node:timers/promises";

import { standIn } from "./standIn.ts";
import type { StandIn } from "./standIn.ts";

export const program =
  process.env["CHUG_SETUP_PROGRAM"] ??
  join(process.cwd(), "ui/chuggy-ui/terminal/main.ts");

const pollMs = 50;
const waitMsMax = 20_000;

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
}

export interface Home {
  readonly home: string;
  /** The program's own directory under this home. */
  readonly directory: string;
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
  readonly dispose: () => void;
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

function ran(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [program, ...argv], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const lines = stdout.split("\n").filter((line) => line !== "");
      resolve({ code, stdout, stderr, lines });
    });
  });
}

function listenerPid(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const note = JSON.parse(text) as { readonly pid?: number };
  return note.pid;
}

/** Ends a listener a case left waiting; one that already went is what was wanted. */
function ended(pid: number): void {
  try {
    process.kill(pid);
  } catch (failure: unknown) {
    if ((failure as NodeJS.ErrnoException).code !== "ESRCH") throw failure;
  }
}

function home(): Home {
  const root = mkdtempSync(join(tmpdir(), "chuggy-setup-"));
  const directory = join(root, ".chuggy-setup");
  const record = join(root, "opened");
  const opener = join(root, "opener.sh");
  writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > "${record}"\n`);
  chmodSync(opener, 0o755);
  const written: string[] = [];
  const file = (name: string): string | undefined =>
    existsSync(join(directory, name))
      ? readFileSync(join(directory, name), "utf8")
      : undefined;
  return {
    home: root,
    directory,
    written,
    file,
    run: async (argv, environment = {}) => {
      const done = await ran(argv, {
        ...process.env,
        HOME: root,
        BROWSER: opener,
        ...environment,
      });
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
    dispose: () => {
      const pid = listenerPid(file("sign-in.json"));
      if (pid !== undefined) ended(pid);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** One request of a browser's that follows nothing, so a suite reads each step. */
export async function browsed(address: string): Promise<Response> {
  return fetch(address, { redirect: "manual" });
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

/** The homes and stand-in installations a suite makes, each ended when the suite is. */
export function making(): Making {
  const homes: Home[] = [];
  const standIns: StandIn[] = [];
  after(async () => {
    for (const made of homes) made.dispose();
    for (const made of standIns) await made.close();
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
