/** Git-backed immutable repository configuration snapshots, read without a checkout. */

import { assertNever } from "../../domain/assertNever.ts";
import type {
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
} from "../../interpreter/repositoryConfiguration.ts";
import {
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
  | { readonly authorized: "Unavailable" }
  | { readonly authorized: "Refused" };

const gitRepositoryConfigurationTreeOutputBytesMax =
  (repositoryConfigurationDeclarationsMax + 1) * 512;
const gitRepositoryConfigurationBlobOutputBytesMax =
  repositoryConfigurationFileCharsMax * 4 + 1;

async function gitRepositoryConfigurationCredential(
  own: GitRepositoryConfigurationState,
  request: RepositoryConfigurationSnapshotRequest,
): Promise<GitRepositoryConfigurationAuthorization> {
  const resolved = await own.credentials.credential(request.repository);
  switch (resolved.resolved) {
    case "Credential":
      return { authorized: "Credential", credential: resolved.credential };
    case "Denied":
      return { authorized: "Refused" };
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
  credential: RepositoryCredential,
): Promise<"Fetched" | "Absent" | "Unavailable"> {
  const repository = request.repository.repository;
  const probe = await scratchRun(own.scratch, {
    repository,
    credential,
    timeoutSecsMax: own.scratch.options.remoteTimeoutSecsMax,
    argv: ["ls-remote", ...scratchRemoteArguments(repository)],
  });
  if (!gitRepositoryConfigurationExited(probe)) return "Unavailable";
  const fetched = await scratchRun(own.scratch, {
    repository,
    credential,
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
  if (ran.stdout.length > repositoryConfigurationFileCharsMax) return undefined;
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
    request,
  );
  if (authorization.authorized === "Unavailable")
    return { read: "Unavailable", unavailable: "Credential" };
  if (authorization.authorized === "Refused")
    return { read: "Refused", refused: "Credential" };
  const fetched = await gitRepositoryConfigurationFetch(
    own,
    request,
    authorization.credential,
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

export function gitRepositoryConfiguration(
  options: GitRepositoryConfigurationOptions,
): RepositoryConfigurationSnapshotPort {
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
  };
}
