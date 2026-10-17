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
 *
 * WHAT ELSE `.chug/` HOLDS IS A SECOND LISTING, one level deep, of the commit
 * already fetched, and only where the configuration directory declares
 * nothing. The configuration directory's own read keeps the bound it is
 * refused past, so a large `.chug/` is named in part rather than refused.
 *
 * A READ FETCHES ONE COMMIT AND ITS TREES, AND THEN EACH BLOB IT READS. The
 * commit comes shallow and without contents, so no earlier commit and no file
 * the read does not ask for is transferred, and `cat-file` fetches each blob it
 * is asked for under the credential the commit was fetched with. A blob read is
 * a read of the remote, so one that fails says the commit is not held yet
 * rather than refusing it. The remote is named and configured on each call,
 * because git takes a remote given only by its address as the promisor's name,
 * and a filesystem path is not a name it accepts.
 *
 * THE SCRATCH IS A DIRECTORY OF ITS OWN beneath the root this adapter is given.
 * git believes a shallow file wherever it finds one, and a history left shallow
 * here would be wrong for any reader answering from the whole of it.
 *
 * A REPOSITORY IS READ ONE READ AT A TIME. A fetch of a commit holds the
 * scratch's shallow lock while it transfers, and git refuses a second fetch
 * that finds the lock rather than waiting for it, so a read begun while another
 * of the same repository is in flight waits for that one to end. The wait is
 * for the whole read and not its fetch alone, because the housekeeping any
 * fetch can set off, a blob's included, rewrites the shallow file under the
 * same lock; that housekeeping is kept inside the call that set it off rather
 * than left running past it. A read's credential is resolved before it waits,
 * so what it waits on is git calls under their own bounds. A shallow lock left
 * by a fetch killed outright makes every later read of that repository a commit
 * not held yet, and such a scratch is repaired by removing its directory and
 * starting the process again, never by hand inside it.
 */

import { join } from "node:path";

import { textCodePointsCount } from "../../contract/http.ts";
import { assertNever } from "../../domain/assertNever.ts";
import type {
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
} from "../../interpreter/finalizer.ts";
import {
  repositoryActionRoot,
  type RepositoryActionSnapshotPort,
} from "../../interpreter/repositoryAction.ts";
import {
  repositoryConfigurationIgnored,
  repositoryConfigurationIgnoredField,
  repositoryConfigurationRoot,
  type RepositoryConfigurationIgnored,
  type RepositoryConfigurationReferenced,
  type RepositoryConfigurationReferencedRead,
  type RepositoryConfigurationSnapshotPort,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryDefaultBranchPort,
  type RepositoryDefaultBranchRead,
} from "../../interpreter/repositoryConfiguration.ts";
import {
  repositoryDeclarationFileCharsMax,
  repositoryDeclarationRoot,
  repositoryDeclarationsMax,
  type RepositoryDeclarationEntry,
  type RepositoryDeclarationFile,
  type RepositoryDeclarationListing,
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

/** The scratch, the credential source, and for each repository being read the end of the last read of it begun, which the next one waits for. */
interface GitRepositoryConfigurationState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly turns: Map<RepositoryId, Promise<void>>;
}

interface GitRepositoryConfigurationEntry {
  readonly mode: string;
  readonly object: string;
  readonly path: string;
}

/** One directory's JSON blobs, and the paths of the blobs beside them that are not JSON. */
interface GitRepositoryConfigurationTreeRead {
  readonly entries: readonly GitRepositoryConfigurationEntry[];
  readonly skipped: readonly string[];
}

/** One directory's read, a snapshot carrying what its tree held there that is not JSON. */
type GitRepositoryConfigurationDirectoryRead =
  | Exclude<RepositoryDeclarationSnapshotRead, { readonly read: "Snapshot" }>
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryDeclarationFile[];
      readonly skipped: readonly string[];
    };

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

/** A commit fetched into the scratch, and the credential its blobs are fetched under as they are read. */
interface GitRepositoryConfigurationCommit {
  readonly request: RepositoryDeclarationSnapshotRequest;
  readonly credential?: RepositoryCredential;
}

/** What reading one commit came to: what was found in it once fetched, or why it was not. */
type GitRepositoryConfigurationCommitRead<Found> =
  | { readonly read: "Fetched"; readonly found: Found }
  | Exclude<RepositoryDeclarationSnapshotRead, { readonly read: "Snapshot" }>;

/** What reading one blob came to: its text, past the bound it is read under, or not fetched. */
type GitRepositoryConfigurationBlobRead =
  | { readonly blob: "Text"; readonly text: string }
  | { readonly blob: "TooLarge" }
  | { readonly blob: "Unfetched" };

const gitRepositoryConfigurationTreeOutputBytesMax =
  (repositoryDeclarationsMax + 1) * 512;
const gitRepositoryConfigurationBlobOutputBytesMax =
  repositoryDeclarationFileCharsMax * 4 + 1;

/** The directory beneath the given root this adapter's scratch is opened in, which no repository's digest can name. */
const gitRepositoryConfigurationScratchDirectory = "configuration";

/** The name the repository is given as the promisor remote a read fetches from. */
const gitRepositoryConfigurationRemote = "configuration-source";

/** What a fetch leaves out of the commit, each blob being fetched only as it is read. */
const gitRepositoryConfigurationFilter = "blob:none";

/** What keeps the housekeeping a fetch sets off inside the call that set it off, said both ways because a newer git asks one setting first and an older knows only the other. */
const gitRepositoryConfigurationHousekeeping = [
  "-c",
  "gc.autoDetach=false",
  "-c",
  "maintenance.autoDetach=false",
] as const;

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

/**
 * The repository as the promisor remote of one call that fetches, configured
 * on the call and so already registered when a fetch would write it into the
 * scratch, and the housekeeping the fetch sets off kept inside the call. The
 * address is a configuration value, which a repository beginning with a dash
 * cannot turn into an option.
 */
function gitRepositoryConfigurationFetchArguments(
  repository: RepositoryId,
): readonly string[] {
  const remote = `remote.${gitRepositoryConfigurationRemote}`;
  return [
    ...gitRepositoryConfigurationHousekeeping,
    "-c",
    `${remote}.url=${repository}`,
    "-c",
    `${remote}.promisor=true`,
    "-c",
    `${remote}.partialclonefilter=${gitRepositoryConfigurationFilter}`,
  ];
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
      ...gitRepositoryConfigurationFetchArguments(repository),
      "fetch",
      "--quiet",
      "--no-tags",
      "--depth=1",
      `--filter=${gitRepositoryConfigurationFilter}`,
      gitRepositoryConfigurationRemote,
      `+${request.commit}:refs/chuggy/configuration/${request.commit}`,
    ],
  });
  return gitRepositoryConfigurationExited(fetched)
    ? { fetched: "Fetched" }
    : { fetched: "Absent" };
}

function gitRepositoryConfigurationEntries(
  stdout: string,
): GitRepositoryConfigurationTreeRead | undefined {
  const entries: GitRepositoryConfigurationEntry[] = [];
  const skipped: string[] = [];
  for (const row of stdout.split("\0")) {
    if (row === "") continue;
    const matched = /^(\d{6}) blob ([0-9a-f]+)\t([^\0]+)$/u.exec(row);
    if (matched === null) return undefined;
    const [, mode, object, path] = matched;
    if (mode === undefined || object === undefined || path === undefined)
      return undefined;
    if (!path.endsWith(".json")) {
      skipped.push(path);
      continue;
    }
    entries.push({ mode, object, path });
    if (entries.length > repositoryDeclarationsMax) return undefined;
  }
  return { entries, skipped };
}

/** One directory's entries at a fetched commit, listed without their sizes, which a scratch holding no blob would fetch every one of to print. */
async function gitRepositoryConfigurationTree(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  root: string,
): Promise<GitRepositoryConfigurationTreeRead | "Refused"> {
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["ls-tree", "-r", "-z", request.commit, "--", root],
    outputBytesMax: gitRepositoryConfigurationTreeOutputBytesMax,
  });
  if (!gitRepositoryConfigurationExited(ran)) return "Refused";
  return gitRepositoryConfigurationEntries(ran.stdout) ?? "Refused";
}

/**
 * One blob of a fetched commit, fetched from the repository as it is read
 * under the commit's credential and the local bound. A blob the scratch does
 * not hold arrives whole before `cat-file` writes any of it, so the output
 * bound says how large it is and never how much was transferred.
 */
async function gitRepositoryConfigurationBlob(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  object: string,
): Promise<GitRepositoryConfigurationBlobRead> {
  const repository = commit.request.repository.repository;
  const ran = await scratchRun(own.scratch, {
    repository,
    ...(commit.credential === undefined
      ? {}
      : { credential: commit.credential }),
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: [
      ...gitRepositoryConfigurationFetchArguments(repository),
      "cat-file",
      "blob",
      object,
    ],
    outputBytesMax: gitRepositoryConfigurationBlobOutputBytesMax,
  });
  if (ran.ran === "Stopped" && ran.stopped === "OutputCeiling")
    return { blob: "TooLarge" };
  if (!gitRepositoryConfigurationExited(ran)) return { blob: "Unfetched" };
  return textCodePointsCount(ran.stdout) > repositoryDeclarationFileCharsMax
    ? { blob: "TooLarge" }
    : { blob: "Text", text: ran.stdout };
}

async function gitRepositoryConfigurationFile(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  entry: GitRepositoryConfigurationEntry,
): Promise<RepositoryDeclarationFile | "Refused" | "Unfetched"> {
  if (
    entry.mode !== "100644" &&
    entry.mode !== "100755" &&
    entry.mode !== "120000"
  )
    return "Refused";
  const read = await gitRepositoryConfigurationBlob(own, commit, entry.object);
  switch (read.blob) {
    case "Text":
      return {
        path: entry.path,
        kind: entry.mode === "120000" ? "Symlink" : "File",
        content: read.text,
      };
    case "TooLarge":
      return "Refused";
    case "Unfetched":
      return "Unfetched";
    default:
      return assertNever(read);
  }
}

async function gitRepositoryConfigurationFiles(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  entries: readonly GitRepositoryConfigurationEntry[],
): Promise<readonly RepositoryDeclarationFile[] | "Refused" | "Unfetched"> {
  const files: RepositoryDeclarationFile[] = [];
  for (const entry of entries) {
    const file = await gitRepositoryConfigurationFile(own, commit, entry);
    if (file === "Refused" || file === "Unfetched") return file;
    files.push(file);
  }
  return files;
}

/** Runs one read of a repository once every read of it begun earlier has ended, and forgets the repository once none begun after it is waiting. */
async function gitRepositoryConfigurationInTurn<Found>(
  own: GitRepositoryConfigurationState,
  repository: RepositoryId,
  reads: () => Promise<Found>,
): Promise<Found> {
  const read = (own.turns.get(repository) ?? Promise.resolve()).then(reads);
  const ended = read.then(
    () => undefined,
    () => undefined,
  );
  own.turns.set(repository, ended);
  try {
    return await read;
  } finally {
    if (own.turns.get(repository) === ended) own.turns.delete(repository);
  }
}

/** Fetches the commit under whatever credential the source gives and reads it in the repository's turn, or says why it was not fetched. */
async function gitRepositoryConfigurationFetched<Found>(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  reads: (commit: GitRepositoryConfigurationCommit) => Promise<Found>,
): Promise<GitRepositoryConfigurationCommitRead<Found>> {
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
  const credential =
    authorization.authorized === "Credential"
      ? authorization.credential
      : undefined;
  return gitRepositoryConfigurationInTurn(
    own,
    request.repository.repository,
    async (): Promise<GitRepositoryConfigurationCommitRead<Found>> => {
      const fetched = await gitRepositoryConfigurationFetch(
        own,
        request,
        credential,
      );
      switch (fetched.fetched) {
        case "Fetched":
          return {
            read: "Fetched",
            found: await reads({
              request,
              ...(credential === undefined ? {} : { credential }),
            }),
          };
        case "Absent":
          return { read: "Absent" };
        case "Unavailable":
          return {
            read: "Unavailable",
            unavailable: "Repository",
            evidence: gitRepositoryConfigurationEvidence(
              authorization,
              fetched.evidence,
            ),
          };
        default:
          return assertNever(fetched);
      }
    },
  );
}

/** The JSON blobs a fetched commit's tree holds under `root`, which are none where it holds no such directory. */
async function gitRepositoryConfigurationDirectory(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  root: string,
): Promise<GitRepositoryConfigurationDirectoryRead> {
  const tree = await gitRepositoryConfigurationTree(own, commit.request, root);
  if (tree === "Refused") return { read: "Refused" };
  const files = await gitRepositoryConfigurationFiles(
    own,
    commit,
    tree.entries,
  );
  if (files === "Refused") return { read: "Refused" };
  if (files === "Unfetched") return { read: "Absent" };
  return { read: "Snapshot", files, skipped: tree.skipped };
}

function gitRepositoryConfigurationListingEntries(
  stdout: string,
): readonly RepositoryDeclarationEntry[] | undefined {
  const entries: RepositoryDeclarationEntry[] = [];
  for (const row of stdout.split("\0")) {
    if (row === "") continue;
    const matched = /^\d{6} (blob|tree|commit) [0-9a-f]+\t([^\0]+)$/u.exec(row);
    if (matched === null) return undefined;
    const [, type, path] = matched;
    if (type === undefined || path === undefined) return undefined;
    entries.push({ path, directory: type === "tree" });
  }
  return entries;
}

/** What one fetched commit holds directly under `.chug/`, a listing past the tree read's bound said as one. */
async function gitRepositoryConfigurationListing(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
): Promise<RepositoryDeclarationListing> {
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["ls-tree", "-z", request.commit, "--", repositoryDeclarationRoot],
    outputBytesMax: gitRepositoryConfigurationTreeOutputBytesMax,
  });
  if (ran.ran === "Stopped" && ran.stopped === "OutputCeiling")
    return { listed: "Overflowed" };
  if (!gitRepositoryConfigurationExited(ran)) return { listed: "Unlisted" };
  const entries = gitRepositoryConfigurationListingEntries(ran.stdout);
  return entries === undefined
    ? { listed: "Unlisted" }
    : { listed: "Entries", entries };
}

/**
 * One path's entry in a fetched commit, matched exactly: a request naming a
 * directory lists what it holds, none of which is the path asked for.
 */
async function gitRepositoryConfigurationReferencedEntry(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  path: string,
): Promise<GitRepositoryConfigurationEntry | "Absent" | "Refused"> {
  const ran = await scratchRun(own.scratch, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["ls-tree", "-z", request.commit, "--", path],
    outputBytesMax: gitRepositoryConfigurationTreeOutputBytesMax,
  });
  if (ran.ran === "Stopped" && ran.stopped === "OutputCeiling") return "Absent";
  if (!gitRepositoryConfigurationExited(ran)) return "Refused";
  for (const row of ran.stdout.split("\0")) {
    const matched =
      /^(\d{6}) (?:blob|tree|commit) ([0-9a-f]+)\t([^\0]+)$/u.exec(row);
    const [, mode, object, listed] = matched ?? [];
    if (mode !== undefined && object !== undefined && listed === path)
      return { mode, object, path };
  }
  return "Absent";
}

/** One referenced path as found: a regular file's text, a symbolic link, a blob past the bound, or nothing a file. */
async function gitRepositoryConfigurationReferencedFile(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  path: string,
): Promise<RepositoryConfigurationReferenced | "Refused" | "Unfetched"> {
  const entry = await gitRepositoryConfigurationReferencedEntry(
    own,
    commit.request,
    path,
  );
  if (entry === "Refused") return "Refused";
  if (entry === "Absent") return { path, found: "Absent" };
  if (entry.mode === "120000") return { path, found: "Symlink" };
  if (entry.mode !== "100644" && entry.mode !== "100755")
    return { path, found: "Absent" };
  const read = await gitRepositoryConfigurationBlob(own, commit, entry.object);
  switch (read.blob) {
    case "Text":
      return { path, found: "File", content: read.text };
    case "TooLarge":
      return { path, found: "TooLarge" };
    case "Unfetched":
      return "Unfetched";
    default:
      return assertNever(read);
  }
}

/** The files a catalog names, read from a fetched commit one path after another. */
async function gitRepositoryConfigurationReferencedFiles(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
  paths: readonly string[],
): Promise<RepositoryConfigurationReferencedRead> {
  const files: RepositoryConfigurationReferenced[] = [];
  for (const path of paths) {
    const file = await gitRepositoryConfigurationReferencedFile(
      own,
      commit,
      path,
    );
    if (file === "Refused") return { read: "Refused", refused: "Snapshot" };
    if (file === "Unfetched") return { read: "Absent", absent: "Commit" };
    files.push(file);
  }
  return { read: "Referenced", files };
}

/** The files a catalog names at the commit its snapshot was read at, fetched again under the same rule. */
async function gitRepositoryConfigurationReferenced(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  paths: readonly string[],
): Promise<RepositoryConfigurationReferencedRead> {
  const read = await gitRepositoryConfigurationFetched(own, request, (commit) =>
    gitRepositoryConfigurationReferencedFiles(own, commit, paths),
  );
  switch (read.read) {
    case "Fetched":
      return read.found;
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

/** One directory's read in the configuration port's terms, where a tree declaring none has no directory to import. */
function gitRepositoryConfigurationSnapshot(
  read: GitRepositoryConfigurationDirectoryRead,
  ignored?: RepositoryConfigurationIgnored,
): RepositoryConfigurationSnapshotRead {
  switch (read.read) {
    case "Snapshot":
      return read.files.length === 0
        ? {
            read: "Absent",
            absent: "ConfigurationDirectory",
            ...repositoryConfigurationIgnoredField(ignored),
          }
        : { read: "Snapshot", files: read.files };
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

/** A fetched commit's configuration directory, a directory declaring nothing naming what else `.chug/` holds. */
async function gitRepositoryConfigurationDeclaredFiles(
  own: GitRepositoryConfigurationState,
  commit: GitRepositoryConfigurationCommit,
): Promise<RepositoryConfigurationSnapshotRead> {
  const read = await gitRepositoryConfigurationDirectory(
    own,
    commit,
    repositoryConfigurationRoot,
  );
  if (read.read !== "Snapshot" || read.files.length > 0)
    return gitRepositoryConfigurationSnapshot(read);
  const ignored = repositoryConfigurationIgnored({
    listing: await gitRepositoryConfigurationListing(own, commit.request),
    skipped: read.skipped,
  });
  return gitRepositoryConfigurationSnapshot(read, ignored);
}

/** The configuration directory's read at one commit. */
async function gitRepositoryConfigurationDeclared(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
): Promise<RepositoryConfigurationSnapshotRead> {
  const read = await gitRepositoryConfigurationFetched(own, request, (commit) =>
    gitRepositoryConfigurationDeclaredFiles(own, commit),
  );
  return read.read === "Fetched"
    ? read.found
    : gitRepositoryConfigurationSnapshot(read);
}

/** The action directory's read at one commit, which carries nothing of what its tree holds beside it. */
async function gitRepositoryConfigurationActions(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
): Promise<RepositoryDeclarationSnapshotRead> {
  const read = await gitRepositoryConfigurationFetched(own, request, (commit) =>
    gitRepositoryConfigurationDirectory(own, commit, repositoryActionRoot),
  );
  const directory = read.read === "Fetched" ? read.found : read;
  return directory.read === "Snapshot"
    ? { read: "Snapshot", files: directory.files }
    : directory;
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
      directory: join(
        options.scratchDirectory,
        gitRepositoryConfigurationScratchDirectory,
      ),
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
    turns: new Map(),
  };
  return {
    snapshot: (request) => gitRepositoryConfigurationDeclared(own, request),
    referenced: (request, paths) =>
      gitRepositoryConfigurationReferenced(own, request, paths),
    actionSnapshot: (request) =>
      gitRepositoryConfigurationActions(own, request),
    defaultBranch: (repository) => gitRepositoryDefaultBranch(own, repository),
  };
}
