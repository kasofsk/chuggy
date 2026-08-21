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
 * A CREDENTIAL TRAVELS IN THE CHILD'S ENVIRONMENT AND NOWHERE ELSE. An argument
 * is in the process list of every user on the host, so the credential is never
 * one; git asks the helper below for it, and the helper reads it from the
 * environment it was started with. The floor is the oldest git whose
 * `merge-tree` writes trees, refused at construction rather than mid-promotion.
 */

import { execFile, execFileSync } from "node:child_process";

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
  | { readonly ran: "Stopped"; readonly stopped: "Timeout" | "OutputCeiling" };

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

/** Runs one bounded git call, resolving a non-zero exit and rejecting only a git that could not start. */
export function gitRun(call: GitCall): Promise<GitRan> {
  const argv = ["-C", call.directory, ...call.argv];
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      argv,
      {
        encoding: "utf8",
        timeout: call.timeoutSecsMax * 1000,
        maxBuffer: call.outputBytesMax ?? gitOutputBytesMax,
        env: call.environment,
      },
      (failure, stdout, stderr) => {
        if (failure === null) {
          resolve({ ran: "Exited", code: 0, stdout, stderr });
        } else if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({ ran: "Stopped", stopped: "OutputCeiling" });
        } else if (
          failure.killed === true ||
          typeof failure.signal === "string"
        ) {
          resolve({ ran: "Stopped", stopped: "Timeout" });
        } else if (typeof failure.code === "number") {
          resolve({ ran: "Exited", code: failure.code, stdout, stderr });
        } else {
          reject(new Error(`git ${call.argv[0] ?? ""}: ${failure.message}`));
        }
      },
    );
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

/** Refuses the one precondition for serving this kind of work at all, at construction rather than mid-promotion. */
export function gitRunAssertVersion(environment: GitEnvironment): void {
  const version = execFileSync("git", ["--version"], {
    encoding: "utf8",
    env: environment,
  });
  if (!gitVersionAdmits(version)) {
    throw new Error(
      `git: ${version.trim()} cannot write merge trees; ${String(gitVersionMin.major)}.${String(gitVersionMin.minor)} is the floor`,
    );
  }
}

/**
 * The environment one git child is given. The credential is written into it and
 * cleared from it when there is none, so an ambient value cannot stand in for a
 * resolved one.
 */
export function gitRunEnvironment(
  base: GitEnvironment,
  username: string,
  credential?: RepositoryCredential,
): GitEnvironment {
  return {
    ...base,
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
