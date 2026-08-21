/**
 * The bare scratch repository this adapter works in — one per repository
 * identity — and the git verbs run against it.
 *
 * THE SCRATCH IS A PLAIN BARE REPOSITORY, NOT A `--mirror` CLONE. A mirror
 * configured remote refuses refspec pushes outright, and the one push this
 * adapter makes is a single-ref refspec; fetching the one ref a preparation
 * pinned gives the same always-current view of that ref without buying the
 * refusal.
 *
 * NOTHING IS EVER CHECKED OUT. A tree is written by reading the observed commit
 * into a temporary index, adding the artifacts' blobs to that index and writing
 * the tree back out, and `merge-tree --write-tree` merges two commits into a
 * tree the same way — so there is no half-written working tree to abort and the
 * scratch is consistent after any failure by construction rather than by
 * cleanup. A conflict is an exit code here, not prose to parse.
 *
 * THE REPOSITORY IDENTITY IS THE REMOTE ADDRESS. Any remote git accepts is one,
 * a filesystem path to a bare repository included, which is what lets a suite
 * exercise every behaviour relied on here with no network and no server. It is
 * never a path segment: the scratch names each repository's directory by a
 * digest, because an opaque identity is not safe in a path.
 *
 * WHAT THE SCRATCH KEEPS ALIVE IT KEEPS BY A REF. A commit is unreachable the
 * moment it is written and an unreachable object is a collectable one, so every
 * commit written here is given a ref under `refs/chuggy/` before it is returned
 * to a caller that may only promote it after a crash and a restart.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  asGitObjectId,
  asGitRefName,
  conflictPathsMax,
  gitObjectIdPattern,
  type GitObjectId,
  type GitRefName,
  type ObservedTarget,
  type RepositoryCredential,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import {
  gitCredentialArguments,
  gitCredentialHelperText,
  gitRun,
  gitRunAssertVersion,
  gitRunEnvironment,
  type GitEnvironment,
  type GitRan,
} from "./gitRun.ts";

/** The name and address every commit this adapter writes is attributed to. */
export interface GitCommitIdentity {
  readonly name: string;
  readonly email: string;
}

/** Everything one scratch is opened over, each value an operational choice. */
export interface GitScratchOptions {
  readonly directory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentialUsername: string;
  readonly localTimeoutSecsMax: number;
  readonly remoteTimeoutSecsMax: number;
  readonly promotionTimeoutSecsMax: number;
}

/** One opened scratch: its options, the helper git asks for a credential through, and what it has initialised. */
export interface GitScratch {
  readonly options: GitScratchOptions;
  readonly helperPath: string;
  readonly initialised: Set<string>;
}

/** One bounded git call against one repository's scratch. */
export interface GitScratchCall {
  readonly repository: RepositoryId;
  readonly argv: readonly string[];
  readonly timeoutSecsMax: number;
  readonly credential?: RepositoryCredential;
  readonly indexFile?: string;
  readonly input?: Uint8Array | string;
}

/** One path and the blob that is to stand at it. */
export interface GitScratchEntry {
  readonly path: string;
  readonly blob: GitObjectId;
}

/** What one read of a remote found, so a caller says in its own vocabulary what each of them means. */
export type ScratchRead<Value> =
  | { readonly read: "Value"; readonly value: Value }
  | { readonly read: "Absent" }
  | { readonly read: "Unreachable" };

/** What merging two commits into a tree found. */
export type ScratchMerged =
  | { readonly merged: "Tree"; readonly tree: GitObjectId }
  | {
      readonly merged: "Conflicted";
      readonly paths: readonly string[];
      readonly truncated: boolean;
    }
  | { readonly merged: "Failed" };

/** What the one irreversible act came to, read off the porcelain flag rather than off prose. */
export type ScratchPushed =
  | { readonly pushed: "Advanced" }
  | { readonly pushed: "Refused" }
  | { readonly pushed: "TimedOut" }
  | { readonly pushed: "Unknown" };

/** What `ls-remote --exit-code` exits with when the remote answered and named no such ref. */
const scratchNoMatchingRefCode = 2;

/** The mode the credential helper is written with, which is the one file here that must not be read by another user. */
const scratchHelperMode = 0o700;

/** The digest a value is given before it is put in a path or a ref name. */
export function scratchDigestOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Opens the scratch, refusing at construction what no later call could work around. */
export function scratchOpen(options: GitScratchOptions): GitScratch {
  for (const secs of [
    options.localTimeoutSecsMax,
    options.remoteTimeoutSecsMax,
    options.promotionTimeoutSecsMax,
  ]) {
    if (!Number.isSafeInteger(secs) || secs <= 0) {
      throw new RangeError(
        "git scratch: a timeout is not a positive count of seconds",
      );
    }
  }
  gitRunAssertVersion(options.environment);
  mkdirSync(options.directory, { recursive: true });
  const helperPath = join(options.directory, "credential-helper");
  writeFileSync(helperPath, gitCredentialHelperText, {
    mode: scratchHelperMode,
  });
  chmodSync(helperPath, scratchHelperMode);
  return { options, helperPath, initialised: new Set() };
}

/** The bare repository this identity's work happens in, initialised once per process and re-initialised harmlessly after a restart. */
export function scratchRepositoryDirectory(
  scratch: GitScratch,
  repository: RepositoryId,
): string {
  const directory = join(
    scratch.options.directory,
    scratchDigestOf(repository),
  );
  if (!scratch.initialised.has(directory)) {
    mkdirSync(directory, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", directory], {
      env: scratch.options.environment,
    });
    scratch.initialised.add(directory);
  }
  return directory;
}

/** Runs one bounded git call in a repository's scratch, a credential reaching git through the helper alone. */
export function scratchRun(
  scratch: GitScratch,
  call: GitScratchCall,
): Promise<GitRan> {
  const directory = scratchRepositoryDirectory(scratch, call.repository);
  const resolved = gitRunEnvironment(
    scratch.options.environment,
    scratch.options.credentialUsername,
    call.credential,
  );
  const environment =
    call.indexFile === undefined
      ? resolved
      : { ...resolved, GIT_INDEX_FILE: call.indexFile };
  const prefix =
    call.credential === undefined
      ? []
      : gitCredentialArguments(scratch.helperPath);
  return gitRun({
    directory,
    argv: [...prefix, ...call.argv],
    timeoutSecsMax: call.timeoutSecsMax,
    environment,
    input: call.input ?? "",
  });
}

/** Reads an object identity out of git's own output, refusing a width git addresses no object at. */
function scratchObjectIdOf(value: string | undefined): GitObjectId | undefined {
  if (value === undefined) return undefined;
  if (!new RegExp(gitObjectIdPattern(), "u").test(value)) return undefined;
  return asGitObjectId(value);
}

/** The one line of stdout a plumbing command that writes an object produces. */
function scratchWrittenObjectOf(ran: GitRan): GitObjectId | undefined {
  if (ran.ran === "Stopped" || ran.code !== 0) return undefined;
  return scratchObjectIdOf(ran.stdout.trim());
}

/** The branch the remote's own HEAD names and the commit it stands at, read from the remote rather than remembered. */
export async function scratchObserveHead(
  scratch: GitScratch,
  repository: RepositoryId,
  credential: RepositoryCredential,
): Promise<ScratchRead<ObservedTarget>> {
  const ran = await scratchRun(scratch, {
    repository,
    credential,
    timeoutSecsMax: scratch.options.remoteTimeoutSecsMax,
    argv: ["ls-remote", "--symref", "--exit-code", repository, "HEAD"],
  });
  if (ran.ran === "Stopped") return { read: "Unreachable" };
  if (ran.code === scratchNoMatchingRefCode) return { read: "Absent" };
  if (ran.code !== 0) return { read: "Unreachable" };
  const named = /^ref: (refs\/[^\t\n]+)\tHEAD$/mu.exec(ran.stdout);
  const stood = /^([0-9a-f]+)\tHEAD$/mu.exec(ran.stdout);
  const commit = scratchObjectIdOf(stood?.[1]);
  const ref: string | undefined = named?.[1];
  if (ref === undefined || commit === undefined) return { read: "Absent" };
  return { read: "Value", value: { ref: asGitRefName(ref), commit } };
}

/** What the remote currently says one ref stands at, which is the read a promotion is answered against. */
export async function scratchReadRef(
  scratch: GitScratch,
  repository: RepositoryId,
  credential: RepositoryCredential,
  ref: GitRefName,
): Promise<ScratchRead<GitObjectId>> {
  const ran = await scratchRun(scratch, {
    repository,
    credential,
    timeoutSecsMax: scratch.options.remoteTimeoutSecsMax,
    argv: ["ls-remote", "--exit-code", repository, ref],
  });
  if (ran.ran === "Stopped") return { read: "Unreachable" };
  if (ran.code === scratchNoMatchingRefCode) return { read: "Absent" };
  if (ran.code !== 0) return { read: "Unreachable" };
  const stood = /^([0-9a-f]+)\t/mu.exec(ran.stdout);
  const commit = scratchObjectIdOf(stood?.[1]);
  if (commit === undefined) return { read: "Absent" };
  return { read: "Value", value: commit };
}

/** Brings one ref's objects into the scratch under a name derived from it, so nothing opaque reaches a ref. */
export async function scratchFetchRef(
  scratch: GitScratch,
  repository: RepositoryId,
  credential: RepositoryCredential,
  ref: GitRefName,
): Promise<boolean> {
  const ran = await scratchRun(scratch, {
    repository,
    credential,
    timeoutSecsMax: scratch.options.remoteTimeoutSecsMax,
    argv: [
      "fetch",
      "--quiet",
      "--no-tags",
      repository,
      `+${ref}:refs/chuggy/target/${scratchDigestOf(ref)}`,
    ],
  });
  return ran.ran === "Exited" && ran.code === 0;
}

/** Whether the scratch holds one commit, which is what makes an ancestry question answerable at all. */
export async function scratchHasCommit(
  scratch: GitScratch,
  repository: RepositoryId,
  commit: GitObjectId,
): Promise<boolean> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutSecsMax: scratch.options.localTimeoutSecsMax,
    argv: ["cat-file", "-e", `${commit}^{commit}`],
  });
  return ran.ran === "Exited" && ran.code === 0;
}

/** Whether one commit is reachable from another, and `undefined` where git could not answer. */
export async function scratchIsAncestor(
  scratch: GitScratch,
  repository: RepositoryId,
  candidate: GitObjectId,
  tip: GitObjectId,
): Promise<boolean | undefined> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutSecsMax: scratch.options.localTimeoutSecsMax,
    argv: ["merge-base", "--is-ancestor", candidate, tip],
  });
  if (ran.ran === "Stopped") return undefined;
  if (ran.code === 0) return true;
  if (ran.code === 1) return false;
  return undefined;
}

/** Writes one artifact's bytes into the scratch as a blob. */
export async function scratchWriteBlob(
  scratch: GitScratch,
  repository: RepositoryId,
  content: Uint8Array,
): Promise<GitObjectId | undefined> {
  return scratchWrittenObjectOf(
    await scratchRun(scratch, {
      repository,
      timeoutSecsMax: scratch.options.localTimeoutSecsMax,
      argv: ["hash-object", "-w", "--stdin"],
      input: content,
    }),
  );
}

/**
 * Writes the tree one commit's tree becomes once the entries stand in it. The
 * index is temporary and named per call, so two preparations in one scratch
 * cannot write each other's trees.
 */
export async function scratchWriteTree(
  scratch: GitScratch,
  repository: RepositoryId,
  base: GitObjectId,
  entries: readonly GitScratchEntry[],
): Promise<GitObjectId | undefined> {
  const directory = scratchRepositoryDirectory(scratch, repository);
  const indexFile = join(directory, `chuggy-index-${randomUUID()}`);
  const timeoutSecsMax = scratch.options.localTimeoutSecsMax;
  try {
    const read = await scratchRun(scratch, {
      repository,
      timeoutSecsMax,
      indexFile,
      argv: ["read-tree", base],
    });
    if (read.ran === "Stopped" || read.code !== 0) return undefined;
    const added = await scratchRun(scratch, {
      repository,
      timeoutSecsMax,
      indexFile,
      argv: ["update-index", "--index-info"],
      input: entries
        .map((entry) => `100644 ${entry.blob}\t${entry.path}\n`)
        .join(""),
    });
    if (added.ran === "Stopped" || added.code !== 0) return undefined;
    return scratchWrittenObjectOf(
      await scratchRun(scratch, {
        repository,
        timeoutSecsMax,
        indexFile,
        argv: ["write-tree"],
      }),
    );
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/** Writes the commit for an already-written tree, attributed to the identity the scratch was opened with. */
export async function scratchCommitTree(
  scratch: GitScratch,
  repository: RepositoryId,
  tree: GitObjectId,
  parents: readonly GitObjectId[],
  message: string,
): Promise<GitObjectId | undefined> {
  const { name, email } = scratch.options.identity;
  return scratchWrittenObjectOf(
    await scratchRun(scratch, {
      repository,
      timeoutSecsMax: scratch.options.localTimeoutSecsMax,
      argv: [
        "-c",
        `user.name=${name}`,
        "-c",
        `user.email=${email}`,
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        message,
      ],
    }),
  );
}

/** Gives one written commit a ref, because an unreachable object is a collectable one. */
export async function scratchKeepCommit(
  scratch: GitScratch,
  repository: RepositoryId,
  commit: GitObjectId,
): Promise<boolean> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutSecsMax: scratch.options.localTimeoutSecsMax,
    argv: ["update-ref", `refs/chuggy/candidate/${commit}`, commit],
  });
  return ran.ran === "Exited" && ran.code === 0;
}

/** The conflicted paths one merge reported, taken from the NUL-separated section so no path shape can hide one. */
function scratchConflictedPaths(stdout: string): ScratchMerged {
  const fields = stdout.split("\0");
  const paths: string[] = [];
  for (const field of fields.slice(1)) {
    if (field === "") break;
    if (paths.length === conflictPathsMax) {
      return { merged: "Conflicted", paths, truncated: true };
    }
    paths.push(field);
  }
  return { merged: "Conflicted", paths, truncated: false };
}

/** Merges two commits into a tree object, reading clean and conflicted off the exit code. */
export async function scratchMergeTree(
  scratch: GitScratch,
  repository: RepositoryId,
  into: GitObjectId,
  from: GitObjectId,
): Promise<ScratchMerged> {
  const ran = await scratchRun(scratch, {
    repository,
    timeoutSecsMax: scratch.options.localTimeoutSecsMax,
    argv: ["merge-tree", "--write-tree", "-z", "--name-only", into, from],
  });
  if (ran.ran === "Stopped") return { merged: "Failed" };
  if (ran.code === 1) return scratchConflictedPaths(ran.stdout);
  if (ran.code !== 0) return { merged: "Failed" };
  const tree = scratchObjectIdOf(ran.stdout.split("\0")[0]?.trim());
  return tree === undefined ? { merged: "Failed" } : { merged: "Tree", tree };
}

/**
 * The one ref movement this adapter makes: a single-refspec push the receiving
 * repository applies atomically and refuses when it is not a fast-forward. A
 * refusal is a porcelain flag, and everything else that stopped the push is
 * unknown rather than refused.
 */
export async function scratchPush(
  scratch: GitScratch,
  repository: RepositoryId,
  credential: RepositoryCredential,
  candidate: GitObjectId,
  ref: GitRefName,
): Promise<ScratchPushed> {
  const ran = await scratchRun(scratch, {
    repository,
    credential,
    timeoutSecsMax: scratch.options.promotionTimeoutSecsMax,
    argv: [
      "push",
      "--porcelain",
      "--atomic",
      repository,
      `${candidate}:${ref}`,
    ],
  });
  if (ran.ran === "Stopped") {
    return ran.stopped === "Timeout"
      ? { pushed: "TimedOut" }
      : { pushed: "Unknown" };
  }
  if (ran.code === 0) return { pushed: "Advanced" };
  const refused = ran.stdout.split("\n").some((line) => line.startsWith("!\t"));
  return refused ? { pushed: "Refused" } : { pushed: "Unknown" };
}
