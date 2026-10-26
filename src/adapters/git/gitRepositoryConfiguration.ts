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
 * A REPOSITORY IS READ ONE READ AT A TIME, BY A STATED COUNT OF READS AT MOST.
 * A fetch of a commit holds the scratch's shallow lock while it transfers, and
 * git refuses a second fetch that finds the lock rather than waiting for it, so
 * a read fetches only once the read of that repository before it has ended. The
 * wait is for the whole of that read and not its fetch alone, because the
 * housekeeping any fetch can set off, a blob's included, can rewrite the
 * shallow file under the same lock; that housekeeping is kept inside the call
 * that set it off rather than left running past it. The probe of the remote
 * takes no lock and is asked before the wait, so an outage stops each read at
 * its own bound. The credential the commit and its blobs are fetched under is
 * resolved once the read's turn has come, because one resolved before a long
 * wait can have expired by its end. A read begun while as many of its
 * repository's reads as may be are in flight is a commit not held yet at once,
 * with no git run. A shallow lock left by a fetch killed outright makes every
 * later read of that repository a commit not held yet, and such a scratch is
 * repaired by removing its directory and starting the process again, never by
 * hand inside it.
 *
 * A REMOTE READ THAT FAILED IS TOLD OF, AND ONE GIT DIED ON MAY BE TRIED
 * AGAIN, each only for a reader composed to. Whoever is told hears the
 * repository, the command, its code and an excerpt of what git wrote, which is
 * never part of what a read answers. A retry comes once, after a pause, under
 * the credential the read already held, and every retry of one reader together
 * takes no longer than the reader was given for them, a retry that would not
 * fit in what is left not being made.
 */

import { join } from "node:path";
import { setTimeout as gitRepositoryConfigurationPause } from "node:timers/promises";

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
  scratchObserveHeadCall,
  scratchObserveHeadRead,
  scratchOpen,
  scratchRemoteArguments,
  scratchRun,
  type GitCommitIdentity,
  type GitScratch,
  type GitScratchCall,
} from "./gitScratch.ts";
import { gitRunSaid, type GitEnvironment, type GitRan } from "./gitRun.ts";

export interface GitRepositoryConfigurationOptions {
  readonly scratchDirectory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentials: RepositoryCredentialPort;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
  /** Who is told of each remote read that failed; a reader naming nobody tells nobody. */
  readonly remoteFailed?: (
    failed: GitRepositoryConfigurationRemoteFailed,
  ) => void;
  /** How a remote read git died on is tried again; a reader given none tries each read once. */
  readonly remoteRetry?: GitRepositoryConfigurationRetry;
  readonly monotonicNowMs?: () => number;
}

export const gitRepositoryConfigurationDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 60,
  remoteTimeoutSecsMax: 300,
  monotonicNowMs: (): number => performance.now(),
} as const;

/** The git command a remote read runs. */
export type GitRepositoryConfigurationRemoteCommand =
  "ls-remote" | "fetch" | "cat-file";

/** One remote read that failed: whose repository, which command and the code it exited with, whether it is tried again, and the excerpt of what git wrote. */
export interface GitRepositoryConfigurationRemoteFailed {
  readonly repository: RepositoryBinding;
  readonly git: GitRepositoryConfigurationRemoteCommand;
  readonly exited: number;
  readonly retrying: boolean;
  readonly said: string;
}

/** How long a remote read git died on waits before it is tried again, and the most every retry of one reader takes together, pauses included. */
export interface GitRepositoryConfigurationRetry {
  readonly pauseMs: number;
  readonly elapsedMsMax: number;
}

/** One failed remote read as the words a line ends in. */
export function gitRepositoryConfigurationRemoteFailedWords(
  failed: GitRepositoryConfigurationRemoteFailed,
): string {
  return `git ${failed.git} exited ${String(failed.exited)}${failed.retrying ? ", trying again" : ""}: ${failed.said}`;
}

/** The most reads of one repository in flight at once, the one whose turn it is among them; a read begun past it waits for none of them. */
export const gitRepositoryConfigurationReadsInFlightMax = 4;

/** One repository's reads in flight, and the end of the last of them to have come to wait for its turn, which the next one waits for. */
interface GitRepositoryConfigurationTurns {
  reads: number;
  last: Promise<void>;
}

/** A reader's retries: its bounds, its clock, and how long the retries made so far took or are holding in reserve. */
interface GitRepositoryConfigurationRetries extends GitRepositoryConfigurationRetry {
  readonly monotonicNowMs: () => number;
  elapsedMs: number;
}

/** The scratch, the credential source, the reads in flight of each repository being read, and who hears of a failed remote read and how it is tried again. */
interface GitRepositoryConfigurationState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly turns: Map<RepositoryId, GitRepositoryConfigurationTurns>;
  readonly remoteFailed?: (
    failed: GitRepositoryConfigurationRemoteFailed,
  ) => void;
  readonly retries?: GitRepositoryConfigurationRetries;
}

/** One read of the remote: whose repository, the command and the call, and what of a call that exited says the read failed, which is any code but zero where it says nothing. */
interface GitRepositoryConfigurationRemoteRead {
  readonly repository: RepositoryBinding;
  readonly git: GitRepositoryConfigurationRemoteCommand;
  readonly call: GitScratchCall;
  readonly failed?: (ran: GitRepositoryConfigurationExitedRan) => boolean;
}

/** A git call that exited, with its code and what it wrote. */
type GitRepositoryConfigurationExitedRan = Extract<
  GitRan,
  { readonly ran: "Exited" }
>;

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

/** A read that could not reach the repository or a credential for it. */
type GitRepositoryConfigurationUnavailable = Extract<
  RepositoryDeclarationSnapshotRead,
  { readonly read: "Unavailable" }
>;

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
const gitRepositoryConfigurationRemoteName = "configuration-source";

/** What a fetch leaves out of the commit, each blob being fetched only as it is read. */
const gitRepositoryConfigurationFilter = "blob:none";

/** What keeps the housekeeping a fetch sets off inside the call that set it off, said both ways because a newer git asks one setting first and an older knows only the other. */
const gitRepositoryConfigurationHousekeeping = [
  "-c",
  "gc.autoDetach=false",
  "-c",
  "maintenance.autoDetach=false",
] as const;

/** The code git exits with when it dies on a fatal error, which is the one code a remote read is tried again after. */
const gitRepositoryConfigurationRetriedCode = 128;

/** The shortest bound a retried call is run under, below which no retry is made. */
const gitRepositoryConfigurationRetryTimeoutSecsMin = 1;

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

/** Whether one remote read's call exited and failed, a call stopped before it exited having written nothing to tell of. */
function gitRepositoryConfigurationRemoteFailedRan(
  read: GitRepositoryConfigurationRemoteRead,
  ran: GitRan,
): ran is GitRepositoryConfigurationExitedRan {
  if (ran.ran !== "Exited") return false;
  return read.failed === undefined ? ran.code !== 0 : read.failed(ran);
}

/** Tells whoever hears of failed remote reads of one, what git wrote said only as an excerpt the read's credential is redacted from. */
function gitRepositoryConfigurationRemoteTold(
  own: GitRepositoryConfigurationState,
  read: GitRepositoryConfigurationRemoteRead,
  ran: GitRepositoryConfigurationExitedRan,
  retrying: boolean,
): void {
  own.remoteFailed?.({
    repository: read.repository,
    git: read.git,
    exited: ran.code,
    retrying,
    said: gitRunSaid(
      ran.stderr,
      read.call.credential === undefined ? [] : [read.call.credential],
    ),
  });
}

/** The bound a retry of one call runs under, which is what the reader's retries have left once its pause is taken, or nothing where too little is left. */
function gitRepositoryConfigurationRetryTimeoutSecs(
  retries: GitRepositoryConfigurationRetries,
  call: GitScratchCall,
): number | undefined {
  const leftMs = retries.elapsedMsMax - retries.elapsedMs - retries.pauseMs;
  const timeoutSecsMax = Math.min(
    call.timeoutSecsMax,
    Math.floor(leftMs / 1000),
  );
  return timeoutSecsMax >= gitRepositoryConfigurationRetryTimeoutSecsMin
    ? timeoutSecsMax
    : undefined;
}

/**
 * Tries one remote read again after the pause, under the bound it was given.
 * Its pause and its bound are held in reserve while it runs, so retries in
 * flight together never take more than the reader has left between them.
 */
async function gitRepositoryConfigurationRetried(
  own: GitRepositoryConfigurationState,
  retries: GitRepositoryConfigurationRetries,
  read: GitRepositoryConfigurationRemoteRead,
  timeoutSecsMax: number,
): Promise<GitRan> {
  const reservedMs = retries.pauseMs + timeoutSecsMax * 1000;
  const startedMs = retries.monotonicNowMs();
  retries.elapsedMs += reservedMs;
  try {
    await gitRepositoryConfigurationPause(retries.pauseMs);
    const ran = await scratchRun(own.scratch, { ...read.call, timeoutSecsMax });
    if (gitRepositoryConfigurationRemoteFailedRan(read, ran))
      gitRepositoryConfigurationRemoteTold(own, read, ran, false);
    return ran;
  } finally {
    retries.elapsedMs += retries.monotonicNowMs() - startedMs - reservedMs;
  }
}

/** Runs one read of the remote, telling of it where it failed and trying it once more where git died on it and the reader's retries have room. */
async function gitRepositoryConfigurationRemote(
  own: GitRepositoryConfigurationState,
  read: GitRepositoryConfigurationRemoteRead,
): Promise<GitRan> {
  const ran = await scratchRun(own.scratch, read.call);
  if (!gitRepositoryConfigurationRemoteFailedRan(read, ran)) return ran;
  const retries = own.retries;
  const timeoutSecsMax =
    retries !== undefined && ran.code === gitRepositoryConfigurationRetriedCode
      ? gitRepositoryConfigurationRetryTimeoutSecs(retries, read.call)
      : undefined;
  gitRepositoryConfigurationRemoteTold(
    own,
    read,
    ran,
    timeoutSecsMax !== undefined,
  );
  return retries === undefined || timeoutSecsMax === undefined
    ? ran
    : gitRepositoryConfigurationRetried(own, retries, read, timeoutSecsMax);
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
  const remote = `remote.${gitRepositoryConfigurationRemoteName}`;
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

/** A credential the source could not answer for, as the read it comes to. */
function gitRepositoryConfigurationCredentialUnavailable(
  authorization: Extract<
    GitRepositoryConfigurationAuthorization,
    { readonly authorized: "Unavailable" }
  >,
): GitRepositoryConfigurationUnavailable {
  return {
    read: "Unavailable",
    unavailable: "Credential",
    evidence: authorization.evidence,
  };
}

/** Asks the remote for its refs under whatever credential the source gives, which takes nothing in the scratch, and says why where it did not answer. */
async function gitRepositoryConfigurationProbe(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
): Promise<"Answered" | GitRepositoryConfigurationUnavailable> {
  const authorization = await gitRepositoryConfigurationCredential(
    own,
    request.repository,
  );
  if (authorization.authorized === "Unavailable")
    return gitRepositoryConfigurationCredentialUnavailable(authorization);
  const repository = request.repository.repository;
  const probe = await gitRepositoryConfigurationRemote(own, {
    repository: request.repository,
    git: "ls-remote",
    call: {
      repository,
      ...(authorization.authorized === "Credential"
        ? { credential: authorization.credential }
        : {}),
      timeoutSecsMax: own.scratch.options.remoteTimeoutSecsMax,
      argv: ["ls-remote", ...scratchRemoteArguments(repository)],
    },
  });
  if (gitRepositoryConfigurationExited(probe)) return "Answered";
  return {
    read: "Unavailable",
    unavailable: "Repository",
    evidence: gitRepositoryConfigurationEvidence(
      authorization,
      scratchGitEvidence("ls-remote", probe),
    ),
  };
}

/** Fetches one commit, shallow and without its blobs, answering whether it is held now. */
async function gitRepositoryConfigurationFetch(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  credential: RepositoryCredential | undefined,
): Promise<boolean> {
  const repository = request.repository.repository;
  const fetched = await gitRepositoryConfigurationRemote(own, {
    repository: request.repository,
    git: "fetch",
    call: {
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
        gitRepositoryConfigurationRemoteName,
        `+${request.commit}:refs/chuggy/configuration/${request.commit}`,
      ],
    },
  });
  return gitRepositoryConfigurationExited(fetched);
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
  const ran = await gitRepositoryConfigurationRemote(own, {
    repository: commit.request.repository,
    git: "cat-file",
    call: {
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
    },
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

/** Counts one read of a repository in, or answers nothing where as many of its reads as may be are in flight already. */
function gitRepositoryConfigurationBegun(
  own: GitRepositoryConfigurationState,
  repository: RepositoryId,
): GitRepositoryConfigurationTurns | undefined {
  const turns = own.turns.get(repository) ?? {
    reads: 0,
    last: Promise.resolve(),
  };
  if (turns.reads >= gitRepositoryConfigurationReadsInFlightMax)
    return undefined;
  turns.reads += 1;
  own.turns.set(repository, turns);
  return turns;
}

/** Counts one read of a repository out however it ended, forgetting the repository once none of its reads is in flight. */
function gitRepositoryConfigurationEnded(
  own: GitRepositoryConfigurationState,
  repository: RepositoryId,
  turns: GitRepositoryConfigurationTurns,
): void {
  turns.reads -= 1;
  if (turns.reads === 0) own.turns.delete(repository);
}

/** Runs one read once the read of its repository that came to wait before it has ended, however that one ended. */
function gitRepositoryConfigurationInTurn<Found>(
  turns: GitRepositoryConfigurationTurns,
  reads: () => Promise<Found>,
): Promise<Found> {
  const read = turns.last.then(reads);
  turns.last = read.then(
    () => undefined,
    () => undefined,
  );
  return read;
}

/** Fetches the commit under the credential the source gives once the read's turn has come, and reads it. */
async function gitRepositoryConfigurationFetchedInTurn<Found>(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  reads: (commit: GitRepositoryConfigurationCommit) => Promise<Found>,
): Promise<GitRepositoryConfigurationCommitRead<Found>> {
  const authorization = await gitRepositoryConfigurationCredential(
    own,
    request.repository,
  );
  if (authorization.authorized === "Unavailable")
    return gitRepositoryConfigurationCredentialUnavailable(authorization);
  const credential =
    authorization.authorized === "Credential"
      ? authorization.credential
      : undefined;
  if (!(await gitRepositoryConfigurationFetch(own, request, credential)))
    return { read: "Absent" };
  return {
    read: "Fetched",
    found: await reads({
      request,
      ...(credential === undefined ? {} : { credential }),
    }),
  };
}

/**
 * Probes the remote, then fetches the commit and reads it in the repository's
 * turn, or says why it was not fetched. A read begun past the count in flight
 * is a commit not held yet, with no credential resolved and no git run.
 */
async function gitRepositoryConfigurationFetched<Found>(
  own: GitRepositoryConfigurationState,
  request: RepositoryDeclarationSnapshotRequest,
  reads: (commit: GitRepositoryConfigurationCommit) => Promise<Found>,
): Promise<GitRepositoryConfigurationCommitRead<Found>> {
  const repository = request.repository.repository;
  const turns = gitRepositoryConfigurationBegun(own, repository);
  if (turns === undefined) return { read: "Absent" };
  try {
    const probed = await gitRepositoryConfigurationProbe(own, request);
    if (probed !== "Answered") return probed;
    return await gitRepositoryConfigurationInTurn(turns, () =>
      gitRepositoryConfigurationFetchedInTurn(own, request, reads),
    );
  } finally {
    gitRepositoryConfigurationEnded(own, repository, turns);
  }
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
  const observed = scratchObserveHeadRead(
    await gitRepositoryConfigurationRemote(own, {
      repository,
      git: "ls-remote",
      call: scratchObserveHeadCall(
        own.scratch,
        repository.repository,
        authorization.authorized === "Credential"
          ? authorization.credential
          : undefined,
      ),
      failed: (ran) => scratchObserveHeadRead(ran).read === "Unreachable",
    }),
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

/** The retries a reader is given, refusing at construction a bound that is not a count of milliseconds. */
function gitRepositoryConfigurationRetriesOf(
  options: GitRepositoryConfigurationOptions,
): { readonly retries?: GitRepositoryConfigurationRetries } {
  const retry = options.remoteRetry;
  if (retry === undefined) return {};
  for (const ms of [retry.pauseMs, retry.elapsedMsMax])
    if (!Number.isSafeInteger(ms) || ms < 0)
      throw new RangeError(
        "git repository configuration: a retry bound is not a count of milliseconds",
      );
  return {
    retries: {
      pauseMs: retry.pauseMs,
      elapsedMsMax: retry.elapsedMsMax,
      monotonicNowMs:
        options.monotonicNowMs ??
        gitRepositoryConfigurationDefaults.monotonicNowMs,
      elapsedMs: 0,
    },
  };
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
    ...(options.remoteFailed === undefined
      ? {}
      : { remoteFailed: options.remoteFailed }),
    ...gitRepositoryConfigurationRetriesOf(options),
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
