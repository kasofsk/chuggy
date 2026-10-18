/**
 * One directory of a repository's tree at one commit, and where its HEAD
 * points, answered from a bare scratch with no checkout.
 *
 * A COMMIT IS FETCHED SHALLOW AND WITHOUT ITS FILES. The fetch brings the
 * commit and its trees and nothing else, so a listing transfers no file's
 * contents and no earlier commit. That makes the scratch shallow, so it is a
 * directory of its own beneath the root this adapter is given: git believes a
 * shallow file wherever it finds one, and a reader answering from the whole of
 * a history must never find this one.
 *
 * A COMMIT IS HELD ONLY BY THE REF ITS OWN COMPLETED FETCH WROTE, which git
 * writes once everything the commit's trees name has arrived. A commit whose
 * object alone stands is fetched again.
 *
 * ONE DIRECTORY IS LISTED PER READ, never recursively. The path is resolved
 * against the commit before it is listed, so a path naming a file, a symbolic
 * link, a submodule or nothing is no directory, and a symbolic link is never
 * followed. A listing past the read's output bound is answered with no entries
 * and said to be cut short.
 *
 * A REPOSITORY IS FETCHED FOR ONE COMMIT AT A TIME, AND A STATED COUNT OF
 * REPOSITORIES AT ONCE, as `./gitCommitAncestry.ts` fetches: every asker of the
 * commit in flight waits on that one fetch, an asker of another commit waits
 * for it to end before beginning its own, and so no two shallow fetches meet
 * in one repository's scratch. The askers waiting on one fetch are held to a
 * stated count, and one past it, or one asking while as many repositories as
 * may be are being fetched, is a commit not held at once. A head read is a
 * flight of its own on the same terms, and counts toward the same bound.
 *
 * THE ASKER'S WAIT IS BOUNDED AND THE FETCH IS NOT STOPPED FOR IT. An asker
 * whose bound passes is answered that the commit is not held, and the fetch
 * runs on under the remote bound, so a later read finds it held.
 *
 * A FETCH OR A HEAD READ THAT FAILED IS NOT TRIED AGAIN UNTIL A STATED WAIT HAS
 * PASSED, and an ask inside the wait is answered what that failure was with no
 * credential resolved and nothing asked of the remote, so a page being polled
 * does not ask again of a remote that has just refused. The waits kept are
 * held to a stated count, and the one begun first is forgotten for one more.
 *
 * NOTHING GIT WRITES REACHES AN ANSWER. Each read is said in this adapter's own
 * words, from exit codes and from what git prints on its output stream.
 */

import { join } from "node:path";

import { repositoryTreeEntriesAnsweredMax } from "../../contract/http.ts";
import { assertNever } from "../../domain/assertNever.ts";
import type {
  GitObjectId,
  RepositoryBinding,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { RepositoryDefaultBranchRead } from "../../interpreter/repositoryConfiguration.ts";
import type {
  RepositoryTreeEntry,
  RepositoryTreeRead,
  RepositoryTreeRequest,
  RepositoryTreeSource,
} from "../../interpreter/repositoryTree.ts";
import {
  gitCommitAncestryDefaults,
  type GitCommitAncestryOptions,
} from "./gitCommitAncestry.ts";
import type { GitRan } from "./gitRun.ts";
import {
  scratchObserveHead,
  scratchOpen,
  scratchRemoteArguments,
  scratchRun,
  type GitScratch,
  type GitScratchCall,
} from "./gitScratch.ts";

/** What the adapter is composed over, which are the bounds of the ancestry reader's own on-demand fetch. */
export type GitRepositoryTreeOptions = GitCommitAncestryOptions;

/** The ancestry reader's defaults, but for a shorter wait after a failure, because a person browsing a tree asks again soon after fixing what failed. */
export const gitRepositoryTreeDefaults = {
  ...gitCommitAncestryDefaults,
  refetchWaitSecs: 60,
} as const;

/** The most output one directory's listing may produce before it is stopped unread. */
export const gitRepositoryTreeListingBytesMax = 4 * 1024 * 1024;

/** The directory beneath the given root this adapter's scratch is opened in, which no repository's digest can name. */
const gitRepositoryTreeScratchDirectory = "tree";

/** The name the repository is given as the promisor remote a fetch reads from. */
const gitRepositoryTreeRemote = "tree-source";

/** What a fetch leaves out of the commit, which is every file's contents. */
const gitRepositoryTreeFilter = "blob:none";

/** What keeps the housekeeping a fetch sets off inside the call that set it off, said both ways because git has asked each in turn. */
const gitRepositoryTreeHousekeeping = [
  "-c",
  "gc.autoDetach=false",
  "-c",
  "maintenance.autoDetach=false",
] as const;

/** A bound as whoever waits under it sees it: it resolves once the bound has passed. */
type GitRepositoryTreeBound = Promise<undefined>;

/** What a fetch came to: the commit held, the remote not reached, or the commit not fetched from a remote that answered. */
type GitRepositoryTreeFetched = "Held" | "Unreachable" | "Unheld";

/** What a failed fetch or head read is remembered as while its wait lasts. */
type GitRepositoryTreeRefused = Exclude<GitRepositoryTreeFetched, "Held">;

/** One asker waiting on a flight: how it is told what the flight came to, and how it is told the flight raised. */
interface GitRepositoryTreeWaiter<Ended> {
  readonly ended: (ended: Ended) => void;
  readonly raised: (failure: unknown) => void;
}

/** The one fetch or head read a repository has in flight: what it is for, and the askers still waiting for it. */
interface GitRepositoryTreeFlight<Ended> {
  readonly target: string;
  readonly waiters: Set<GitRepositoryTreeWaiter<Ended>>;
}

/** A failure's wait: the reading of the clock it ends at, and what the failure was. */
interface GitRepositoryTreeRefetchWait {
  readonly endsMs: number;
  readonly refused: GitRepositoryTreeRefused;
}

/** What the adapter holds across asks: its scratch, its credential source, what is in flight, the waits, and its bounds. */
interface GitRepositoryTreeState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly fetches: Map<
    RepositoryId,
    GitRepositoryTreeFlight<GitRepositoryTreeFetched>
  >;
  readonly heads: Map<
    RepositoryId,
    GitRepositoryTreeFlight<RepositoryDefaultBranchRead>
  >;
  readonly refetchWaits: Map<string, GitRepositoryTreeRefetchWait>;
  readonly fetchesInFlightMax: number;
  readonly fetchWaitersMax: number;
  readonly answerTimeoutSecsMax: number;
  readonly refetchWaitSecs: number;
  readonly refetchWaitsMax: number;
  readonly monotonicNowMs: () => number;
}

/** What resolving the directory asked for found: its tree, no directory, or nothing read. */
type GitRepositoryTreeResolved =
  | { readonly resolved: "Tree"; readonly tree: string }
  | { readonly resolved: "NotDirectory" }
  | { readonly resolved: "Unread" };

/** The head target a flight and a wait are kept under, which no commit's hex can spell. */
const gitRepositoryTreeHeadTarget = "HEAD";

/** Runs one wait under a bound of its own, which the wait is handed so that it can give way to it. */
async function gitRepositoryTreeBounded<Value>(
  timeoutSecsMax: number,
  waits: (bound: GitRepositoryTreeBound) => Promise<Value>,
): Promise<Value> {
  const bound = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => {
    bound.resolve(undefined);
  }, timeoutSecsMax * 1000);
  try {
    return await waits(bound.promise);
  } finally {
    clearTimeout(timer);
  }
}

/** What a call came to for an asker still waiting, and `undefined` once its bound has passed first. */
function gitRepositoryTreeRead<Value>(
  asker: GitRepositoryTreeBound,
  found: Promise<Value>,
): Promise<Value | undefined> {
  return Promise.race([found, asker]);
}

/** Runs one git call in the repository's scratch, a git that could not be run at all being `undefined`. */
async function gitRepositoryTreeRun(
  own: GitRepositoryTreeState,
  call: GitScratchCall,
): Promise<GitRan | undefined> {
  try {
    return await scratchRun(own.scratch, call);
  } catch {
    return undefined;
  }
}

function gitRepositoryTreeExited(
  ran: GitRan | undefined,
): ran is Extract<GitRan, { readonly ran: "Exited" }> {
  return ran?.ran === "Exited" && ran.code === 0;
}

/** The ref a completed fetch of one commit writes. */
function gitRepositoryTreeHeldRef(commit: GitObjectId): string {
  return `refs/chuggy/tree/${commit}`;
}

/** What a target's wait is kept under: the target and then its repository. */
function gitRepositoryTreeRefetchKey(
  target: string,
  repository: RepositoryId,
): string {
  return `${target} ${repository}`;
}

/** What a failure of this target is remembered as, where its wait has not yet passed. */
function gitRepositoryTreeRefetchWaits(
  own: GitRepositoryTreeState,
  key: string,
): GitRepositoryTreeRefused | undefined {
  const wait = own.refetchWaits.get(key);
  return wait !== undefined && own.monotonicNowMs() < wait.endsMs
    ? wait.refused
    : undefined;
}

/** Begins the wait of a target that has just failed, forgetting the wait begun first where as many are kept as may be. */
function gitRepositoryTreeRefetchWaitBegins(
  own: GitRepositoryTreeState,
  key: string,
  refused: GitRepositoryTreeRefused,
): void {
  own.refetchWaits.delete(key);
  if (own.refetchWaits.size >= own.refetchWaitsMax) {
    const first = own.refetchWaits.keys().next();
    if (first.done !== true) own.refetchWaits.delete(first.value);
  }
  own.refetchWaits.set(key, {
    endsMs: own.monotonicNowMs() + own.refetchWaitSecs * 1000,
    refused,
  });
}

/**
 * Begins a repository's one flight of a kind, which tells whoever is still
 * waiting on it how it ended, having begun its target's wait where it failed.
 * None is begun while as many flights as may be are already in the air.
 */
function gitRepositoryTreeFlight<Ended>(
  own: GitRepositoryTreeState,
  flights: Map<RepositoryId, GitRepositoryTreeFlight<Ended>>,
  repository: RepositoryId,
  target: string,
  flies: () => Promise<Ended>,
  refusedOf: (ended: Ended) => GitRepositoryTreeRefused | undefined,
): GitRepositoryTreeFlight<Ended> | undefined {
  if (own.fetches.size + own.heads.size >= own.fetchesInFlightMax)
    return undefined;
  const flight: GitRepositoryTreeFlight<Ended> = { target, waiters: new Set() };
  const ends = (tell: (waiter: GitRepositoryTreeWaiter<Ended>) => void) => {
    flights.delete(repository);
    flight.waiters.forEach(tell);
  };
  flights.set(repository, flight);
  flies().then(
    (ended) => {
      const refused = refusedOf(ended);
      if (refused !== undefined)
        gitRepositoryTreeRefetchWaitBegins(
          own,
          gitRepositoryTreeRefetchKey(target, repository),
          refused,
        );
      ends((waiter) => {
        waiter.ended(ended);
      });
    },
    (failure: unknown) => {
      ends((waiter) => {
        waiter.raised(failure);
      });
    },
  );
  return flight;
}

/**
 * Waits on a flight for one asker, answering `undefined` where the asker did
 * not see it end: one whose bound passed first, which is a waiter no longer
 * from then, and one that found as many waiting as may.
 */
function gitRepositoryTreeWaits<Ended>(
  own: GitRepositoryTreeState,
  flight: GitRepositoryTreeFlight<Ended>,
  asker: GitRepositoryTreeBound,
): Promise<Ended | undefined> {
  if (flight.waiters.size >= own.fetchWaitersMax)
    return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const waiter: GitRepositoryTreeWaiter<Ended> = {
      ended: resolve,
      raised: reject,
    };
    flight.waiters.add(waiter);
    void asker.then(() => {
      flight.waiters.delete(waiter);
      resolve(undefined);
    });
  });
}

/** The credential git is run under, none where the source denies one so that a public repository answers, and `undefined` where it could not answer. */
async function gitRepositoryTreeCredential(
  own: GitRepositoryTreeState,
  repository: RepositoryBinding,
): Promise<{ readonly credential?: RepositoryCredential } | undefined> {
  const resolved = await own.credentials.credential(repository);
  switch (resolved.resolved) {
    case "Credential":
      return { credential: resolved.credential };
    case "Denied":
      return {};
    case "Unavailable":
      return undefined;
    default:
      return assertNever(resolved);
  }
}

/** Whether a completed fetch of the commit stands in the scratch: yes, no, or nothing read. */
async function gitRepositoryTreeHeld(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
): Promise<"Yes" | "No" | "Unread"> {
  const ran = await gitRepositoryTreeRun(own, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: [
      "rev-parse",
      "--quiet",
      "--verify",
      `${gitRepositoryTreeHeldRef(request.commit)}^{commit}`,
    ],
  });
  if (ran?.ran !== "Exited") return "Unread";
  if (ran.code === 0 && ran.stdout.trim() === request.commit) return "Yes";
  return ran.code === 1 ? "No" : "Unread";
}

/**
 * The repository as the promisor remote of the one call that fetches,
 * configured on the call and the housekeeping it sets off kept inside it. The
 * address is a configuration value, which one beginning with a dash cannot
 * turn into an option.
 */
function gitRepositoryTreeFetchArguments(
  repository: RepositoryId,
): readonly string[] {
  const remote = `remote.${gitRepositoryTreeRemote}`;
  return [
    ...gitRepositoryTreeHousekeeping,
    "-c",
    `${remote}.url=${repository}`,
    "-c",
    `${remote}.promisor=true`,
    "-c",
    `${remote}.partialclonefilter=${gitRepositoryTreeFilter}`,
  ];
}

/** Probes the remote, then fetches the commit shallow and without its files under one credential, answering what came of it. */
async function gitRepositoryTreeFetch(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
): Promise<GitRepositoryTreeFetched> {
  const authorized = await gitRepositoryTreeCredential(own, request.repository);
  if (authorized === undefined) return "Unreachable";
  const repository = request.repository.repository;
  const timeoutSecsMax = own.scratch.options.remoteTimeoutSecsMax;
  const probe = await gitRepositoryTreeRun(own, {
    repository,
    ...authorized,
    timeoutSecsMax,
    argv: ["ls-remote", ...scratchRemoteArguments(repository, "HEAD")],
  });
  if (!gitRepositoryTreeExited(probe)) return "Unreachable";
  await gitRepositoryTreeRun(own, {
    repository,
    ...authorized,
    timeoutSecsMax,
    argv: [
      ...gitRepositoryTreeFetchArguments(repository),
      "fetch",
      "--quiet",
      "--no-tags",
      "--depth=1",
      `--filter=${gitRepositoryTreeFilter}`,
      gitRepositoryTreeRemote,
      `+${request.commit}:${gitRepositoryTreeHeldRef(request.commit)}`,
    ],
  });
  return (await gitRepositoryTreeHeld(own, request)) === "Yes"
    ? "Held"
    : "Unheld";
}

/**
 * Whether the commit came to be held while the asker waited: by a fetch that
 * completed earlier, by the one in flight for it, or by one begun once the
 * repository's fetch of another commit has ended. A fetch is begun only on
 * git's no to the commit's ref, and outside the commit's wait.
 */
async function gitRepositoryTreeHolds(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
  asker: GitRepositoryTreeBound,
): Promise<GitRepositoryTreeFetched> {
  const repository = request.repository.repository;
  let flight = own.fetches.get(repository);
  if (flight?.target !== request.commit) {
    const held = await gitRepositoryTreeRead(
      asker,
      gitRepositoryTreeHeld(own, request),
    );
    if (held === "Yes") return "Held";
    if (held !== "No") return "Unheld";
    const waited = gitRepositoryTreeRefetchWaits(
      own,
      gitRepositoryTreeRefetchKey(request.commit, repository),
    );
    if (waited !== undefined) return waited;
    flight =
      own.fetches.get(repository) ??
      gitRepositoryTreeFlight(
        own,
        own.fetches,
        repository,
        request.commit,
        () => gitRepositoryTreeFetch(own, request),
        (fetched) => (fetched === "Held" ? undefined : fetched),
      );
    if (flight === undefined) return "Unheld";
  }
  const ended = await gitRepositoryTreeWaits(own, flight, asker);
  if (ended === undefined) return "Unheld";
  if (flight.target === request.commit) return ended;
  return gitRepositoryTreeHolds(own, request, asker);
}

/** Resolves the directory asked for against the held commit, reading the type of what the path names and never following it. */
async function gitRepositoryTreeResolve(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
): Promise<GitRepositoryTreeResolved> {
  const named =
    request.directory === ""
      ? `${request.commit}^{tree}`
      : `${request.commit}:${request.directory}`;
  const ran = await gitRepositoryTreeRun(own, {
    repository: request.repository.repository,
    timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
    argv: ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    input: `${named}\n`,
  });
  if (!gitRepositoryTreeExited(ran)) return { resolved: "Unread" };
  const line = ran.stdout.replace(/\n$/u, "");
  if (line === `${named} missing`) return { resolved: "NotDirectory" };
  const matched = /^([0-9a-f]+) ([a-z]+)$/u.exec(line);
  const [, tree, type] = matched ?? [];
  if (tree === undefined || type === undefined) return { resolved: "Unread" };
  return type === "tree"
    ? { resolved: "Tree", tree }
    : { resolved: "NotDirectory" };
}

/** One listed row as the entry it names, the kind read off git's type and, for a blob, its mode. */
function gitRepositoryTreeEntry(
  mode: string,
  type: string,
  name: string,
): RepositoryTreeEntry | undefined {
  switch (type) {
    case "tree":
      return { name, kind: "Directory" };
    case "commit":
      return { name, kind: "Submodule" };
    case "blob":
      return mode === "120000"
        ? { name, kind: "Symlink" }
        : { name, kind: "File", executable: mode === "100755" };
    default:
      return undefined;
  }
}

/** A tree's listing as entries, cut at the count one read answers and saying so. */
function gitRepositoryTreeEntries(stdout: string): RepositoryTreeRead {
  const entries: RepositoryTreeEntry[] = [];
  for (const row of stdout.split("\0")) {
    if (row === "") continue;
    const matched = /^(\d{6}) ([a-z]+) [0-9a-f]+\t([^\0]+)$/u.exec(row);
    const [, mode, type, name] = matched ?? [];
    if (mode === undefined || type === undefined || name === undefined)
      return { read: "Absent", absent: "Commit" };
    const entry = gitRepositoryTreeEntry(mode, type, name);
    if (entry === undefined) return { read: "Absent", absent: "Commit" };
    if (entries.length === repositoryTreeEntriesAnsweredMax)
      return { read: "Listed", entries, truncated: true };
    entries.push(entry);
  }
  return { read: "Listed", entries, truncated: false };
}

/** Lists one directory of a held commit, a resolution or a listing that could not be read being a commit not held. */
async function gitRepositoryTreeListed(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
  asker: GitRepositoryTreeBound,
): Promise<RepositoryTreeRead> {
  const resolved = await gitRepositoryTreeRead(
    asker,
    gitRepositoryTreeResolve(own, request),
  );
  if (resolved === undefined || resolved.resolved === "Unread")
    return { read: "Absent", absent: "Commit" };
  if (resolved.resolved === "NotDirectory")
    return { read: "Absent", absent: "Directory" };
  const ran = await gitRepositoryTreeRead(
    asker,
    gitRepositoryTreeRun(own, {
      repository: request.repository.repository,
      timeoutSecsMax: own.scratch.options.localTimeoutSecsMax,
      argv: ["ls-tree", "-z", resolved.tree],
      outputBytesMax: gitRepositoryTreeListingBytesMax,
    }),
  );
  if (ran?.ran === "Stopped" && ran.stopped === "OutputCeiling")
    return { read: "Listed", entries: [], truncated: true };
  if (!gitRepositoryTreeExited(ran))
    return { read: "Absent", absent: "Commit" };
  return gitRepositoryTreeEntries(ran.stdout);
}

/** One directory's read: the commit held first, then the directory listed from it. */
async function gitRepositoryTreeList(
  own: GitRepositoryTreeState,
  request: RepositoryTreeRequest,
  asker: GitRepositoryTreeBound,
): Promise<RepositoryTreeRead> {
  const held = await gitRepositoryTreeHolds(own, request, asker);
  switch (held) {
    case "Held":
      return gitRepositoryTreeListed(own, request, asker);
    case "Unreachable":
      return { read: "Unavailable" };
    case "Unheld":
      return { read: "Absent", absent: "Commit" };
    default:
      return assertNever(held);
  }
}

/** Where the remote's HEAD points, under whatever credential the source gives, said in this adapter's words. */
async function gitRepositoryTreeHead(
  own: GitRepositoryTreeState,
  repository: RepositoryBinding,
): Promise<RepositoryDefaultBranchRead> {
  const authorized = await gitRepositoryTreeCredential(own, repository);
  if (authorized === undefined) return { read: "Unavailable" };
  const observed = await scratchObserveHead(
    own.scratch,
    repository.repository,
    authorized.credential,
  ).catch(() => undefined);
  switch (observed?.read) {
    case "Value":
      return {
        read: "Branch",
        branch: observed.value.ref,
        commit: observed.value.commit,
      };
    case "Absent":
      return { read: "Absent" };
    case "Unreachable":
    case undefined:
      return { read: "Unavailable" };
    default:
      return assertNever(observed);
  }
}

/** The head as one asker sees it: what the repository's head read in flight came to, or unavailable inside a failure's wait or past the asker's bound. */
async function gitRepositoryTreeDefaultBranch(
  own: GitRepositoryTreeState,
  repository: RepositoryBinding,
  asker: GitRepositoryTreeBound,
): Promise<RepositoryDefaultBranchRead> {
  const identity = repository.repository;
  const key = gitRepositoryTreeRefetchKey(
    gitRepositoryTreeHeadTarget,
    identity,
  );
  if (gitRepositoryTreeRefetchWaits(own, key) !== undefined)
    return { read: "Unavailable" };
  const flight =
    own.heads.get(identity) ??
    gitRepositoryTreeFlight(
      own,
      own.heads,
      identity,
      gitRepositoryTreeHeadTarget,
      () => gitRepositoryTreeHead(own, repository),
      (head) => (head.read === "Unavailable" ? "Unreachable" : undefined),
    );
  if (flight === undefined) return { read: "Unavailable" };
  return (
    (await gitRepositoryTreeWaits(own, flight, asker)) ?? {
      read: "Unavailable",
    }
  );
}

/**
 * Composes the adapter over a scratch of its own opening. An ask rejects only
 * where the credential source itself raises; whatever else it could not find
 * out is a read that says so.
 */
export function gitRepositoryTree(
  options: GitRepositoryTreeOptions,
): Extract<RepositoryTreeSource, { readable: "Scratch" }> {
  const resolved = { ...gitRepositoryTreeDefaults, ...options };
  for (const bound of [
    resolved.answerTimeoutSecsMax,
    resolved.fetchesInFlightMax,
    resolved.fetchWaitersMax,
    resolved.refetchWaitSecs,
    resolved.refetchWaitsMax,
  ]) {
    if (!Number.isSafeInteger(bound) || bound <= 0)
      throw new RangeError(
        "git repository tree: a bound or a wait is not a positive integer",
      );
  }
  const own: GitRepositoryTreeState = {
    scratch: scratchOpen({
      directory: join(
        resolved.scratchDirectory,
        gitRepositoryTreeScratchDirectory,
      ),
      identity: resolved.identity,
      environment: resolved.environment,
      credentialUsername: resolved.credentialUsername,
      localTimeoutSecsMax: resolved.localTimeoutSecsMax,
      remoteTimeoutSecsMax: resolved.remoteTimeoutSecsMax,
      promotionTimeoutSecsMax: resolved.remoteTimeoutSecsMax,
    }),
    credentials: resolved.credentials,
    fetches: new Map(),
    heads: new Map(),
    refetchWaits: new Map(),
    fetchesInFlightMax: resolved.fetchesInFlightMax,
    fetchWaitersMax: resolved.fetchWaitersMax,
    answerTimeoutSecsMax: resolved.answerTimeoutSecsMax,
    refetchWaitSecs: resolved.refetchWaitSecs,
    refetchWaitsMax: resolved.refetchWaitsMax,
    monotonicNowMs: resolved.monotonicNowMs,
  };
  const bounded = <Value>(
    waits: (asker: GitRepositoryTreeBound) => Promise<Value>,
  ) => gitRepositoryTreeBounded(own.answerTimeoutSecsMax, waits);
  return {
    readable: "Scratch",
    heads: {
      defaultBranch: (repository) =>
        bounded((asker) =>
          gitRepositoryTreeDefaultBranch(own, repository, asker),
        ),
    },
    trees: {
      list: (request) =>
        bounded((asker) => gitRepositoryTreeList(own, request, asker)),
    },
  };
}
