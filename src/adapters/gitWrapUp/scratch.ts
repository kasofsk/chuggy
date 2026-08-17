/**
 * The git operations the wrap-up performer runs against its scratch, each an
 * argv array handed to `execFile` — no shell ever parses these, so nothing
 * here is quotable.
 *
 * THE SCRATCH IS A PLAIN BARE REPOSITORY, NOT A `--mirror` CLONE. A remote
 * configured as a mirror refuses refspec pushes outright, and the one push
 * this adapter makes is a single-ref refspec; fetching every head by explicit
 * refspec gives the same always-current mirror of the branches without buying
 * that refusal.
 *
 * THE MERGE IS PLUMBING, WHICH IS DOC 010'S OWN WORD FOR IT. `merge-tree
 * --write-tree` merges two commits into a tree object without a working tree,
 * so there is no half-merged checkout to abort and the scratch is consistent
 * after a conflict by construction rather than by cleanup; the conflict itself
 * is an exit code, not prose to parse. The tree becomes a two-parent commit
 * via `commit-tree`, and one refspec push moves the default branch — a
 * single-ref push the receiving repository applies atomically and refuses when
 * it is not a fast-forward.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/** The name and address a commit is attributed to. */
export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/** How a plumbing merge resolved: a tree to commit, or the conflict that stopped it. */
export type ScratchMerge =
  | { readonly merged: "MClean"; readonly tree: string }
  | { readonly merged: "MConflict"; readonly detail: string };

/** What one git invocation came back with; a non-zero exit is a value here, not a throw. */
interface ScratchRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The oldest git whose `merge-tree` writes trees; the code below refuses anything older. */
export const scratchGitVersionMin = { major: 2, minor: 38 };

/** Runs git in the scratch, rejecting only when git itself could not run; a handed environment adds to the process's own. */
function scratchGit(
  scratchDirectory: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Promise<ScratchRun> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", scratchDirectory, ...args],
      { env: env === undefined ? process.env : { ...process.env, ...env } },
      (failure, stdout, stderr) => {
        if (failure === null) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof failure.code === "number") {
          resolve({ code: failure.code, stdout, stderr });
        } else {
          reject(new Error(`git ${args[0] ?? ""}: ${failure.message}`));
        }
      },
    );
  });
}

/** Runs git in the scratch and requires it clean, folding stderr into the failure. */
async function scratchGitOk(
  scratchDirectory: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): Promise<string> {
  const ran = await scratchGit(scratchDirectory, args, env);
  if (ran.code !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} exited ${String(ran.code)}: ${ran.stderr.trim()}`,
    );
  }
  return ran.stdout;
}

/**
 * The construction-time preconditions for serving this kind of work at all: a
 * git new enough to write merge trees, and the scratch initialised bare —
 * `git init` on an existing repository re-initialises harmlessly.
 */
export function scratchPrepare(scratchDirectory: string): void {
  const version = execFileSync("git", ["--version"], { encoding: "utf8" });
  const parsed = /(\d+)\.(\d+)/.exec(version);
  const major = Number(parsed?.[1]);
  const minor = Number(parsed?.[2]);
  const { major: majorMin, minor: minorMin } = scratchGitVersionMin;
  if (
    parsed === null ||
    major < majorMin ||
    (major === majorMin && minor < minorMin)
  ) {
    throw new Error(
      `gitWrapUp: ${version.trim()} cannot write merge trees; ${String(majorMin)}.${String(minorMin)} is the floor`,
    );
  }
  mkdirSync(scratchDirectory, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", scratchDirectory]);
}

/** Brings every branch of the remote into the scratch, force-updated and pruned, so the scratch mirrors the heads. */
export async function scratchFetchHeads(
  scratchDirectory: string,
  remote: string,
): Promise<void> {
  await scratchGitOk(scratchDirectory, [
    "fetch",
    "-q",
    "--prune",
    remote,
    "+refs/heads/*:refs/heads/*",
  ]);
}

/** The branch the remote's own HEAD names, read from the remote rather than remembered. */
export async function scratchDefaultBranch(
  scratchDirectory: string,
  remote: string,
): Promise<string> {
  const listed = await scratchGitOk(scratchDirectory, [
    "ls-remote",
    "--symref",
    remote,
    "HEAD",
  ]);
  const symref = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(listed);
  if (symref?.[1] === undefined) {
    throw new Error(`the remote ${remote} names no default branch`);
  }
  return symref[1];
}

/** The branch's tip in the scratch, or nothing where the branch does not exist. */
export async function scratchTipOf(
  scratchDirectory: string,
  branch: string,
): Promise<string | undefined> {
  const ran = await scratchGit(scratchDirectory, [
    "rev-parse",
    "-q",
    "--verify",
    `refs/heads/${branch}`,
  ]);
  if (ran.code === 0) return ran.stdout.trim();
  if (ran.code === 1) return undefined;
  throw new Error(
    `git rev-parse exited ${String(ran.code)}: ${ran.stderr.trim()}`,
  );
}

/** Whether `candidate` is already reachable from `tip`, which is the wrap-up's idempotence question. */
export async function scratchIsAncestor(
  scratchDirectory: string,
  candidate: string,
  tip: string,
): Promise<boolean> {
  const ran = await scratchGit(scratchDirectory, [
    "merge-base",
    "--is-ancestor",
    candidate,
    tip,
  ]);
  if (ran.code === 0) return true;
  if (ran.code === 1) return false;
  throw new Error(
    `git merge-base exited ${String(ran.code)}: ${ran.stderr.trim()}`,
  );
}

/** Merges `from` into `into` as a tree object, reading clean and conflicted off the exit code. */
export async function scratchMergeTree(
  scratchDirectory: string,
  into: string,
  from: string,
): Promise<ScratchMerge> {
  const ran = await scratchGit(scratchDirectory, [
    "merge-tree",
    "--write-tree",
    into,
    from,
  ]);
  if (ran.code === 0) {
    const tree = ran.stdout.trim().split("\n")[0];
    if (tree === undefined || tree === "") {
      throw new Error("git merge-tree exited clean but wrote no tree");
    }
    return { merged: "MClean", tree };
  }
  if (ran.code === 1) {
    const conflicts = ran.stdout
      .split("\n")
      .filter((line) => line.startsWith("CONFLICT"));
    return {
      merged: "MConflict",
      detail: conflicts.length > 0 ? conflicts.join("; ") : "merge conflict",
    };
  }
  throw new Error(
    `git merge-tree exited ${String(ran.code)}: ${ran.stderr.trim()}`,
  );
}

/** Writes the merge commit for an already-written tree, attributing author and committer separately through git's own environment. */
export async function scratchCommitMerge(
  scratchDirectory: string,
  author: GitIdentity,
  committer: GitIdentity,
  tree: string,
  parents: readonly string[],
  message: string,
): Promise<string> {
  const written = await scratchGitOk(
    scratchDirectory,
    [
      "commit-tree",
      tree,
      ...parents.flatMap((parent) => ["-p", parent]),
      "-m",
      message,
    ],
    {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: committer.name,
      GIT_COMMITTER_EMAIL: committer.email,
    },
  );
  return written.trim();
}

/** The one ref movement this adapter makes: a single-refspec push of `sha` onto the remote's branch. */
export async function scratchPush(
  scratchDirectory: string,
  remote: string,
  sha: string,
  branch: string,
): Promise<void> {
  await scratchGitOk(scratchDirectory, [
    "push",
    "-q",
    remote,
    `${sha}:refs/heads/${branch}`,
  ]);
}
