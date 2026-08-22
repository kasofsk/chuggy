/**
 * The process boundary this adapter reaches git through. Every call is an argv
 * array handed to `execFile`, so no shell ever parses one and nothing here is
 * quotable.
 *
 * A NON-ZERO EXIT IS A VALUE. The exit code is carried back for a caller to
 * read, and the one thing that raises is git failing to start at all — the
 * answer no caller can decide its way around. A call stopped by its own timeout
 * or output ceiling is a third arm rather than an exit, because neither says
 * anything about what the command did.
 *
 * EVERY CALL IS BOUNDED IN BOTH DIRECTIONS: a timeout the caller names, and an
 * output ceiling past which the child is stopped unread. Standard input is
 * closed on every call, because a plumbing command that reads it would
 * otherwise wait for a writer that never comes and turn a bound into a wedge.
 *
 * THE BOUND IS THIS ADAPTER'S OWN AND NOT THE RUNTIME'S. A call is answered on
 * its deadline whatever the child is doing, because a grandchild that inherited
 * the output pipes — an askpass helper, an `ssh` — holds them open after git is
 * gone and would otherwise hold the answer with them. The child leads its own
 * process group so that stopping it stops what it started, and it is asked to
 * stop before it is killed outright.
 *
 * A CREDENTIAL TRAVELS IN THE CHILD'S ENVIRONMENT AND NOWHERE ELSE. An argument
 * is in the process list of every user on the host, so the credential is never
 * one; git asks the helper below for it, and the helper reads it from the
 * environment it was started with. The floor is the oldest git whose
 * `merge-tree` writes trees, refused at construction rather than mid-promotion.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type { RepositoryCredential } from "../../interpreter/finalizer.ts";

/** The environment a git child is given, which the composition root supplies because `src/` reads none. */
export type GitEnvironment = Readonly<Record<string, string | undefined>>;

/** The oldest git whose `merge-tree` writes trees, below which this adapter refuses to run. */
const gitVersionMin: { readonly major: number; readonly minor: number } = {
  major: 2,
  minor: 38,
};

/** The most output one git call may produce before it is stopped unread. */
const gitOutputBytesMax = 4 * 1024 * 1024;

/** The bound on the two synchronous calls this adapter makes, neither of which reaches a remote. */
export const gitRunSetupTimeoutSecsMax = 30;

/** How long the output of a call is waited for once the process that produced it is gone. */
const gitRunDrainSecs = 1;

/** How long a stopped call's process group is given to end on its own before it is killed outright. */
const gitRunKillGraceSecs = 5;

/** The variables an ambient environment would otherwise point a call at another repository, another index or another object store with. */
const gitRunAmbientOverrides: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

/** The environment name the credential helper reads the user from. */
const gitCredentialUserVariable = "CHUGGY_GIT_USERNAME";

/** The environment name the credential helper reads the secret from. */
const gitCredentialSecretVariable = "CHUGGY_GIT_CREDENTIAL";

/**
 * What git runs to be told a credential: a helper reading it from its own
 * environment and printing it to git alone. Nothing is interpolated into it, so
 * the text is fixed at build time and carries no value of any kind.
 */
export const gitCredentialHelperText = [
  "#!/bin/sh",
  '[ "${1:-}" = get ] || exit 0',
  `printf 'username=%s\\npassword=%s\\n' "$${gitCredentialUserVariable}" "$${gitCredentialSecretVariable}"`,
  "",
].join("\n");

/** What one git call came to; only git failing to start at all raises instead. */
export type GitRan =
  | {
      readonly ran: "Exited";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly ran: "Stopped";
      readonly stopped: "Timeout" | "OutputCeiling" | "Killed";
    };

/** One git invocation, bounded in time and in output before it is made. */
export interface GitCall {
  readonly directory: string;
  readonly argv: readonly string[];
  readonly timeoutSecsMax: number;
  readonly environment: GitEnvironment;
  readonly outputBytesMax?: number;
  readonly input?: Uint8Array | string;
}

const gitRunIgnored = (): void => undefined;

/** Signals one call's whole process group, which is where a grandchild holding its output pipes lives. */
function gitRunStop(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    return;
  }
}

/** Drops one call's own end of the pipes and stops whatever is still running under it. */
function gitRunEnd(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  gitRunStop(child, "SIGTERM");
  setTimeout(() => {
    gitRunStop(child, "SIGKILL");
  }, gitRunKillGraceSecs * 1000).unref();
  child.unref();
}

/** Collects one stream under its own ceiling, calling back once the call has produced more than it may. */
function gitRunCollect(
  stream: Readable | null,
  chunks: Buffer[],
  bytesMax: number,
  exceeded: () => void,
): void {
  let bytes = 0;
  stream?.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > bytesMax) {
      exceeded();
      return;
    }
    chunks.push(chunk);
  });
  stream?.on("error", gitRunIgnored);
}

/** What a call that ran to its own end came to, a death by signal kept apart from the deadline that would have stopped it. */
function gitRunExited(
  code: number | null,
  stdout: readonly Buffer[],
  stderr: readonly Buffer[],
): GitRan {
  if (code === null) return { ran: "Stopped", stopped: "Killed" };
  return {
    ran: "Exited",
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

/** Runs one bounded git call, resolving a non-zero exit and rejecting only a git that could not start. */
export function gitRun(call: GitCall): Promise<GitRan> {
  const argv = ["-C", call.directory, ...call.argv];
  return new Promise((resolve, reject) => {
    const child = spawn("git", argv, {
      env: call.environment,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let drain: NodeJS.Timeout | undefined;
    let settled = false;
    const settle = (answer: GitRan): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(drain);
      gitRunEnd(child);
      resolve(answer);
    };
    const deadline = setTimeout(() => {
      settle({ ran: "Stopped", stopped: "Timeout" });
    }, call.timeoutSecsMax * 1000);
    const ceiling = (): void => {
      settle({ ran: "Stopped", stopped: "OutputCeiling" });
    };
    const bytesMax = call.outputBytesMax ?? gitOutputBytesMax;
    gitRunCollect(child.stdout, stdout, bytesMax, ceiling);
    gitRunCollect(child.stderr, stderr, bytesMax, ceiling);
    child.on("exit", (code) => {
      if (settled) return;
      drain = setTimeout(() => {
        settle(gitRunExited(code, stdout, stderr));
      }, gitRunDrainSecs * 1000);
    });
    child.on("close", (code) => {
      settle(gitRunExited(code, stdout, stderr));
    });
    child.on("error", (failure: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(drain);
      reject(new Error(`git ${call.argv[0] ?? ""}: ${failure.message}`));
    });
    child.stdin?.on("error", gitRunIgnored);
    child.stdin?.end(call.input ?? "");
  });
}

/** Whether a `git --version` line names a git new enough to write merge trees. */
export function gitVersionAdmits(version: string): boolean {
  const parsed = /(\d+)\.(\d+)/u.exec(version);
  if (parsed === null) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  return (
    major > gitVersionMin.major ||
    (major === gitVersionMin.major && minor >= gitVersionMin.minor)
  );
}

/**
 * Runs one synchronous setup call, killed outright at its bound rather than
 * left to hang. Nothing here reaches a remote, and a synchronous call that
 * hangs wedges the whole process rather than one promotion.
 */
export function gitRunSetup(
  argv: readonly string[],
  environment: GitEnvironment,
  timeoutSecsMax: number = gitRunSetupTimeoutSecsMax,
): string {
  return execFileSync("git", [...argv], {
    encoding: "utf8",
    env: environment,
    timeout: timeoutSecsMax * 1000,
    killSignal: "SIGKILL",
  });
}

/** Refuses the one precondition for serving this kind of work at all, at construction rather than mid-promotion. */
export function gitRunAssertVersion(environment: GitEnvironment): void {
  const version = gitRunSetup(["--version"], environment);
  if (!gitVersionAdmits(version)) {
    throw new Error(
      `git: ${version.trim()} cannot write merge trees; ${String(gitVersionMin.major)}.${String(gitVersionMin.minor)} is the floor`,
    );
  }
}

/**
 * The environment one git child is given. The credential is written into it and
 * cleared from it when there is none, and so is every ambient variable that
 * would otherwise choose the repository, the index or the configuration a call
 * is answered against.
 */
export function gitRunEnvironment(
  base: GitEnvironment,
  username: string,
  credential?: RepositoryCredential,
): GitEnvironment {
  return {
    ...base,
    ...Object.fromEntries(
      gitRunAmbientOverrides.map((name) => [name, undefined]),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    [gitCredentialUserVariable]:
      credential === undefined ? undefined : username,
    [gitCredentialSecretVariable]: credential,
  };
}

/** The arguments making the helper the only credential source, every ambient one cleared first. */
export function gitCredentialArguments(helperPath: string): readonly string[] {
  return ["-c", "credential.helper=", "-c", `credential.helper=${helperPath}`];
}
