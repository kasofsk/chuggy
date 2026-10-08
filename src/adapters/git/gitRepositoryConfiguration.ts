/**
 * Git-backed immutable snapshots of the directories a repository declares in,
 * read without a checkout, and where the repository's own HEAD points.
 *
 * THE READS SHARE ONE SCRATCH AND ONE CREDENTIAL RULE, because the head is
 * what a snapshot is asked at: a caller holding no commit reads the head to
 * get one. A remote that answers the head and refuses the fetch is the same
 * remote, so a second scratch would be a second set of bounds to keep in step.
 *
 * ONE READ SERVES EVERY DIRECTORY, and only what an empty one means differs:
 * a tree declaring no configuration has no configuration directory to import,
 * and a tree declaring no action declares none.
 */

import { textCodePointsCount } from "../../contract/http.ts";
import { assertNever } from "../../domain/assertNever.ts";
import type {
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
} from "../../interpreter/finalizer.ts";
import {
  repositoryActionRoot,
  type RepositoryActionSnapshotPort,
} from "../../interpreter/repositoryAction.ts";
import {
  repositoryConfigurationRoot,
  type RepositoryConfigurationSnapshotPort,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryDefaultBranchPort,
  type RepositoryDefaultBranchRead,
} from "../../interpreter/repositoryConfiguration.ts";
import {
  repositoryDeclarationFileCharsMax,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "../../interpreter/repositoryDeclaration.ts";
import type {
  RepositoryDeclarationSnapshotRead,
  RepositoryDeclarationSnapshotRequest,
} from "../../interpreter/repositoryDeclarationSnapshot.ts";
import type {
  CredentialMintEvidence,
  RepositoryCredentialEvidence,
  RepositoryCredentialRefusal,
  RepositoryGitEvidence,
  RepositoryReadEvidence,
} from "../../interpreter/repositoryReadEvidence.ts";
import {
  scratchGitEvidence,
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
  | {
      readonly authorized: "NoCredential";
      readonly evidence: RepositoryCredentialEvidence;
    }
  | {
      readonly authorized: "Unavailable";
      readonly evidence: RepositoryCredentialEvidence;
    };

/** What a fetch of one commit came to, a probe that failed saying how. */
type GitRepositoryConfigurationFetched =
  | { readonly fetched: "Fetched" }
  | { readonly fetched: "Absent" }
  | {
      readonly fetched: "Unavailable";
      readonly evidence: RepositoryGitEvidence;
    };

const gitRepositoryConfigurationTreeOutputBytesMax =
  (repositoryDeclarationsMax + 1) * 512;
const gitRepositoryConfigurationBlobOutputBytesMax =
  repositoryDeclarationFileCharsMax * 4 + 1;

/** A credential that resolved to none, as evidence: which way, and the mint's cause where it gave one. */
function gitRepositoryConfigurationCredentialEvidence(
  credential: RepositoryCredentialRefusal,
  evidence: CredentialMintEvidence | undefined,
): RepositoryCredentialEvidence {
  return { credential, ...evidence };
}

async function gitRepositoryConfigurationCredential(
  own: GitRepositoryConfigurationState,
  repository: RepositoryBinding,
): Promise<GitRepositoryConfigurationAuthorization> {
  const resolved = await own.credentials.credential(repository);
  switch (resolved.resolved) {
    case "Credential":
      return { authorized: "Credential", credential: resolved.credential };
    case "Denied":
      return {
        authorized: "NoCredential",
        evidence: gitRepositoryConfigurationCredentialEvidence(
          "Denied",
          resolved.evidence,
        ),
      };
    case "Unavailable":
      return {
        authorized: "Unavailable",
        evidence: gitRepositoryConfigurationCredentialEvidence(
          "Unavailable",
          resolved.evidence,
        ),
      };
    default:
      return assertNever(resolved);
  }
}

/** What git did after a credential was resolved, said beside the denial where git ran with none. */
function gitRepositoryConfigurationEvidence(
  authorization: GitRepositoryConfigurationAuthorization,
  git: RepositoryGitEvidence,
): RepositoryReadEvidence {
  return authorization.authorized === "NoCredential"
    ? { ...authorization.evidence, ...git }
    : git;
}

function gitRepositoryConfigurationExited(
  ran: GitRan,
): ran is Extract<GitRan, { readonly ran: "Exited" }> {
  return ran.ran === "Exited" && ran.code === 0;
}

async function gitRepositoryConfigurationFetch(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  credential: RepositoryCredential | undefined,
): Promise<GitRepositoryConfigurationFetched> {
  const repository = request.repository.repository;
  const probe = await scratchRun(own.scratch, {
    repository,
    ...(credential === undefined ? {} : { credential }),
    timeoutSecsMax: own.scratch.options.remoteTimeoutSecsMax,
    argv: ["ls-remote", ...scratchRemoteArguments(repository)],
  });
  if (!gitRepositoryConfigurationExited(probe))
    return {
      fetched: "Unavailable",
      evidence: scratchGitEvidence("ls-remote", probe),
    };
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
  return gitRepositoryConfigurationExited(fetched)
    ? { fetched: "Fetched" }
    : { fetched: "Absent" };
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
    if (entries.length > repositoryDeclarationsMax) return undefined;
  }
  return entries;
}

async function gitRepositoryConfigurationTree(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  root: string,
): Promise<readonly GitRepositoryConfigurationEntry[] | "Refused"> {
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["ls-tree", "-r", "-z", "--long", request.commit, "--", root],
    outputBytesMax: gitRepositoryConfigurationTreeOutputBytesMax,
  });
  if (!gitRepositoryConfigurationExited(ran)) return "Refused";
  return gitRepositoryConfigurationEntries(ran.stdout) ?? "Refused";
}

async function gitRepositoryConfigurationFile(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  entry: GitRepositoryConfigurationEntry,
): Promise<RepositoryDeclarationFile | undefined> {
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
  if (textCodePointsCount(ran.stdout) > repositoryDeclarationFileCharsMax)
    return undefined;
  return {
    path: entry.path,
    kind: entry.mode === "120000" ? "Symlink" : "File",
    content: ran.stdout,
  };
}

async function gitRepositoryConfigurationFiles(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  entries: readonly GitRepositoryConfigurationEntry[],
): Promise<readonly RepositoryDeclarationFile[] | undefined> {
  const files: RepositoryDeclarationFile[] = [];
  for (const entry of entries) {
    const file = await gitRepositoryConfigurationFile(own, request, entry);
    if (file === undefined) return undefined;
    files.push(file);
  }
  return files;
}

/** The JSON blobs one commit's tree holds under `root`, which are none where it holds no such directory. */
async function gitRepositoryConfigurationDirectory(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  root: string,
): Promise<RepositoryDeclarationSnapshotRead> {
  const authorization = await gitRepositoryConfigurationCredential(
    own,
    request.repository,
  );
  if (authorization.authorized === "Unavailable")
    return {
      read: "Unavailable",
      unavailable: "Credential",
      evidence: authorization.evidence,
    };
  const fetched = await gitRepositoryConfigurationFetch(
    own,
    request,
    authorization.authorized === "Credential"
      ? authorization.credential
      : undefined,
  );
  if (fetched.fetched === "Unavailable")
    return {
      read: "Unavailable",
      unavailable: "Repository",
      evidence: gitRepositoryConfigurationEvidence(
        authorization,
        fetched.evidence,
      ),
    };
  if (fetched.fetched === "Absent") return { read: "Absent" };
  const entries = await gitRepositoryConfigurationTree(own, request, root);
  if (entries === "Refused") return { read: "Refused" };
  const files = await gitRepositoryConfigurationFiles(own, request, entries);
  return files === undefined
    ? { read: "Refused" }
    : { read: "Snapshot", files };
}

/** One directory's read in the configuration port's terms, where a tree declaring none has no directory to import. */
function gitRepositoryConfigurationSnapshot(
  read: RepositoryDeclarationSnapshotRead,
): RepositoryConfigurationSnapshotRead {
  switch (read.read) {
    case "Snapshot":
      return read.files.length === 0
        ? { read: "Absent", absent: "ConfigurationDirectory" }
        : read;
    case "Absent":
      return { read: "Absent", absent: "Commit" };
    case "Unavailable":
      return read;
    case "Refused":
      return { read: "Refused", refused: "Snapshot" };
    default:
      return assertNever(read);
  }
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
    return { read: "Unavailable", evidence: authorization.evidence };
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
      return observed.evidence === undefined
        ? { read: "Unavailable" }
        : {
            read: "Unavailable",
            evidence: gitRepositoryConfigurationEvidence(
              authorization,
              observed.evidence,
            ),
          };
    default:
      return assertNever(observed);
  }
}

export function gitRepositoryConfiguration(
  options: GitRepositoryConfigurationOptions,
): RepositoryConfigurationSnapshotPort &
  RepositoryActionSnapshotPort &
  RepositoryDefaultBranchPort {
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
    snapshot: async (request) =>
      gitRepositoryConfigurationSnapshot(
        await gitRepositoryConfigurationDirectory(
          own,
          request,
          repositoryConfigurationRoot,
        ),
      ),
    actionSnapshot: (request) =>
      gitRepositoryConfigurationDirectory(own, request, repositoryActionRoot),
    defaultBranch: (repository) => gitRepositoryDefaultBranch(own, repository),
  };
}
