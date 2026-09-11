/**
 * Git-backed immutable repository configuration snapshots, read without a
 * checkout, and where the repository's own HEAD points.
 *
 * THE TWO READS SHARE ONE SCRATCH AND ONE CREDENTIAL RULE, because the second
 * is what the first is asked at: a caller holding no commit reads the head to
 * get one. A remote that answers the head and refuses the fetch is the same
 * remote, so a second scratch would be a second set of bounds to keep in step.
 */

import { textCodePointsCount } from "../../contract/http.ts";
import { assertNever } from "../../domain/assertNever.ts";
import type {
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
} from "../../interpreter/finalizer.ts";
import {
  repositoryConfigurationDeclarationsMax,
  repositoryConfigurationFileCharsMax,
  repositoryConfigurationRoot,
  type RepositoryConfigurationFile,
  type RepositoryConfigurationSnapshotPort,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryConfigurationSnapshotRequest,
  type RepositoryDefaultBranchPort,
  type RepositoryDefaultBranchRead,
} from "../../interpreter/repositoryConfiguration.ts";
import {
  scratchObserveHead,
  scratchOpen,
  scratchRemoteArguments,
  scratchRun,
  type GitCommitIdentity,
  type GitScratch,
} from "./gitScratch.ts";
import type { GitEnvironment, GitRan } from "./gitRun.ts";

export interface GitRepositoryConfigurationOptions {
  readonly scratchDirectory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentials: RepositoryCredentialPort;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
}

export const gitRepositoryConfigurationDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 60,
  remoteTimeoutSecsMax: 300,
} as const;

interface GitRepositoryConfigurationState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
}

interface GitRepositoryConfigurationEntry {
  readonly mode: string;
  readonly object: string;
  readonly path: string;
}

type GitRepositoryConfigurationAuthorization =
  | {
      readonly authorized: "Credential";
      readonly credential: RepositoryCredential;
    }
  | { readonly authorized: "NoCredential" }
  | { readonly authorized: "Unavailable" };

const gitRepositoryConfigurationTreeOutputBytesMax =
  (repositoryConfigurationDeclarationsMax + 1) * 512;
const gitRepositoryConfigurationBlobOutputBytesMax =
  repositoryConfigurationFileCharsMax * 4 + 1;

async function gitRepositoryConfigurationCredential(
  own: GitRepositoryConfigurationState,
  repository: RepositoryBinding,
): Promise<GitRepositoryConfigurationAuthorization> {
  const resolved = await own.credentials.credential(repository);
  switch (resolved.resolved) {
    case "Credential":
      return { authorized: "Credential", credential: resolved.credential };
    case "Denied":
      return { authorized: "NoCredential" };
    case "Unavailable":
      return { authorized: "Unavailable" };
    default:
      return assertNever(resolved);
  }
}

function gitRepositoryConfigurationExited(
  ran: GitRan,
): ran is Extract<GitRan, { readonly ran: "Exited" }> {
  return ran.ran === "Exited" && ran.code === 0;
}

async function gitRepositoryConfigurationFetch(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
  credential: RepositoryCredential | undefined,
): Promise<"Fetched" | "Absent" | "Unavailable"> {
  const repository = request.repository.repository;
  const probe = await scratchRun(own.scratch, {
    repository,
    ...(credential === undefined ? {} : { credential }),
    timeoutSecsMax: own.scratch.options.remoteTimeoutSecsMax,
    argv: ["ls-remote", ...scratchRemoteArguments(repository)],
  });
  if (!gitRepositoryConfigurationExited(probe)) return "Unavailable";
  const fetched = await scratchRun(own.scratch, {
    repository,
    ...(credential === undefined ? {} : { credential }),
    timeoutSecsMax: own.scratch.options.remoteTimeoutSecsMax,
    argv: [
      "fetch",
      "--quiet",
      "--no-tags",
      ...scratchRemoteArguments(
        repository,
        `+${request.commit}:refs/chuggy/configuration/${request.commit}`,
      ),
    ],
  });
  return gitRepositoryConfigurationExited(fetched) ? "Fetched" : "Absent";
}

function gitRepositoryConfigurationEntries(
  stdout: string,
): readonly GitRepositoryConfigurationEntry[] | undefined {
  const entries: GitRepositoryConfigurationEntry[] = [];
  for (const row of stdout.split("\0")) {
    if (row === "") continue;
    const matched = /^(\d{6}) blob ([0-9a-f]+) +\d+\t([^\0]+)$/u.exec(row);
    if (matched === null) return undefined;
    const [, mode, object, path] = matched;
    if (mode === undefined || object === undefined || path === undefined)
      return undefined;
    if (!path.endsWith(".json")) continue;
    entries.push({ mode, object, path });
    if (entries.length > repositoryConfigurationDeclarationsMax)
      return undefined;
  }
  return entries;
}

async function gitRepositoryConfigurationTree(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
): Promise<readonly GitRepositoryConfigurationEntry[] | "Refused"> {
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: [
      "ls-tree",
      "-r",
      "-z",
      "--long",
      request.commit,
      "--",
      repositoryConfigurationRoot,
    ],
    outputBytesMax: gitRepositoryConfigurationTreeOutputBytesMax,
  });
  if (!gitRepositoryConfigurationExited(ran)) return "Refused";
  return gitRepositoryConfigurationEntries(ran.stdout) ?? "Refused";
}

async function gitRepositoryConfigurationFile(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
  entry: GitRepositoryConfigurationEntry,
): Promise<RepositoryConfigurationFile | undefined> {
  if (
    entry.mode !== "100644" &&
    entry.mode !== "100755" &&
    entry.mode !== "120000"
  )
    return undefined;
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["cat-file", "blob", entry.object],
    outputBytesMax: gitRepositoryConfigurationBlobOutputBytesMax,
  });
  if (!gitRepositoryConfigurationExited(ran)) return undefined;
  if (textCodePointsCount(ran.stdout) > repositoryConfigurationFileCharsMax)
    return undefined;
  return {
    path: entry.path,
    kind: entry.mode === "120000" ? "Symlink" : "File",
    content: ran.stdout,
  };
}

async function gitRepositoryConfigurationFiles(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
  entries: readonly GitRepositoryConfigurationEntry[],
): Promise<readonly RepositoryConfigurationFile[] | undefined> {
  const files: RepositoryConfigurationFile[] = [];
  for (const entry of entries) {
    const file = await gitRepositoryConfigurationFile(own, request, entry);
    if (file === undefined) return undefined;
    files.push(file);
  }
  return files;
}

async function gitRepositoryConfigurationSnapshot(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
): Promise<RepositoryConfigurationSnapshotRead> {
  const authorization = await gitRepositoryConfigurationCredential(
    own,
    request.repository,
  );
  if (authorization.authorized === "Unavailable")
    return { read: "Unavailable", unavailable: "Credential" };
  const fetched = await gitRepositoryConfigurationFetch(
    own,
    request,
    authorization.authorized === "Credential"
      ? authorization.credential
      : undefined,
  );
  if (fetched === "Unavailable")
    return { read: "Unavailable", unavailable: "Repository" };
  if (fetched === "Absent") return { read: "Absent", absent: "Commit" };
  const entries = await gitRepositoryConfigurationTree(own, request);
  if (entries === "Refused") return { read: "Refused", refused: "Snapshot" };
  if (entries.length === 0)
    return { read: "Absent", absent: "ConfigurationDirectory" };
  const files = await gitRepositoryConfigurationFiles(own, request, entries);
  return files === undefined
    ? { read: "Refused", refused: "Snapshot" }
    : { read: "Snapshot", files };
}

/**
 * Where the remote's own HEAD points. A credential the source refuses is read
 * as none rather than as a refusal, exactly as the snapshot reads one, so a
 * public repository answers without one and a private one is unreachable.
 */
async function gitRepositoryDefaultBranch(
  own: GitRepositoryConfigurationState,
  repository: RepositoryBinding,
): Promise<RepositoryDefaultBranchRead> {
  const authorization = await gitRepositoryConfigurationCredential(
    own,
    repository,
  );
  if (authorization.authorized === "Unavailable")
    return { read: "Unavailable" };
  const observed = await scratchObserveHead(
    own.scratch,
    repository.repository,
    authorization.authorized === "Credential"
      ? authorization.credential
      : undefined,
  );
  switch (observed.read) {
    case "Value":
      return {
        read: "Branch",
        branch: observed.value.ref,
        commit: observed.value.commit,
      };
    case "Absent":
      return { read: "Absent" };
    case "Unreachable":
      return { read: "Unavailable" };
    default:
      return assertNever(observed);
  }
}

export function gitRepositoryConfiguration(
  options: GitRepositoryConfigurationOptions,
): RepositoryConfigurationSnapshotPort & RepositoryDefaultBranchPort {
  const own: GitRepositoryConfigurationState = {
    scratch: scratchOpen({
      directory: options.scratchDirectory,
      identity: options.identity,
      environment: options.environment,
      credentialUsername:
        options.credentialUsername ??
        gitRepositoryConfigurationDefaults.credentialUsername,
      localTimeoutSecsMax:
        options.localTimeoutSecsMax ??
        gitRepositoryConfigurationDefaults.localTimeoutSecsMax,
      remoteTimeoutSecsMax:
        options.remoteTimeoutSecsMax ??
        gitRepositoryConfigurationDefaults.remoteTimeoutSecsMax,
      promotionTimeoutSecsMax:
        options.remoteTimeoutSecsMax ??
        gitRepositoryConfigurationDefaults.remoteTimeoutSecsMax,
    }),
    credentials: options.credentials,
  };
  return {
    snapshot: (request) => gitRepositoryConfigurationSnapshot(own, request),
    defaultBranch: (repository) => gitRepositoryDefaultBranch(own, repository),
  };
}
