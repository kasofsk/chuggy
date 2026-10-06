/**
 * Whether one commit is in another's history, answered from the bare scratch
 * kept per repository.
 *
 * A TIP IS HELD ONLY BY THE REF ITS OWN COMPLETED FETCH WROTE. A git a scratch
 * admits may unpack a small fetch object by object and write the ref last, so
 * a fetch stopped part-way can leave the tip standing without what it descends
 * from. A tip taken as held on its object alone would never be fetched again,
 * and a candidate that had only not arrived yet would be `Unknown` for good, so
 * only such a ref says a tip is held.
 *
 * AN ANSWER RESTS ONLY ON READS THAT LOOKED. The scratch is asked whether the
 * candidate is a commit here, whether git reaches it from the tip, and whether
 * every commit of the tip's history can be read, and each read answers yes, no,
 * or that it did not look. `Ancestor` is a yes to the first two. `NotAncestor`
 * is a no to either and then a yes to the third, because git also gives each
 * of those noes where it could not read what the scratch holds. A read that
 * did not look decides nothing, whichever it was. Each no walks its tip's
 * whole history for itself and each yes walks down to where its candidate
 * lies, so one asker alone over a long enough history passes the local bound
 * and is `Unknown`, as many at once are over a shorter one. Asking again under
 * the same load does not resolve it, because each ask walks afresh.
 *
 * THE ASKER'S WAIT IS BOUNDED AND THE FETCH IS NOT STOPPED FOR IT. An asker is
 * answered `Unknown` once a bound short enough for a page being read has
 * passed, and from then on no read is begun for it and it waits on no fetch.
 * The fetch it began runs on under the remote bound, the wait for its
 * credential included, so a history too slow for one read is held by a later
 * one.
 *
 * A REPOSITORY IS FETCHED FOR ONE TIP AT A TIME, AND A STATED COUNT OF
 * REPOSITORIES AT ONCE. Every asker of the tip in flight waits on that one
 * fetch and reads the scratch only after it has ended, so a page reloaded
 * during a slow remote starts no second transfer and reads no half of the
 * first. An asker of another tip of that repository waits for the fetch to end
 * and then begins its own, which after a fetch that landed brings only what
 * that one left out, where two at once would each transfer the history. The
 * askers waiting on one fetch are held to a stated count as well, and one past
 * it is `Unknown` at once, as is a tip asked for while as many repositories as
 * may be are being fetched. A tip already held is answered whatever is in
 * flight.
 *
 * A TIP WHOSE FETCH FAILED IS NOT FETCHED AGAIN UNTIL A STATED WAIT HAS PASSED.
 * A page being polled would otherwise begin another fetch as each one failed,
 * so an ask inside the wait is `Unknown` with no credential resolved, nothing
 * asked of the remote and no other fetch waited on. The wait is the tip's and
 * not its repository's: were it the repository's, a tip that can never be
 * fetched could keep every other tip there from being fetched for as long as
 * it went on being asked. Askers waiting on the fetch that failed are `Unknown`
 * as it ends, and those waiting behind it for another tip go on to their own.
 * Only a fetch that ended without its tip found held begins a wait: one that
 * landed was begun after any wait had passed and leaves none, and a credential
 * source that raised is told to its askers instead. The wait is asked about
 * only once the scratch has said no, so a tip that came to be held meanwhile
 * is answered. The waits kept are held to a stated count, and the one begun
 * first is forgotten for one more.
 *
 * A FETCH THAT ENDS PART-WAY CAN LEAVE A PARTIAL PACK, AND NOTHING HERE
 * REMOVES ONE. It is left whether the remote bound stopped the transfer, the
 * remote cut it, or git gave up on something in the scratch it could not
 * read, and the wait is all that bounds how fast they gather: one for a tip
 * each time its wait has passed. A partial pack cannot be told from a pack
 * still arriving, and nothing serialises a scratch: its directory may be
 * another reader's too, in this process or another, a fetch runs on after the
 * process that began it is killed, and git's own housekeeping, which a fetch
 * that completed may set off, writes packs there as well. That housekeeping
 * is also all that removes a partial pack, and only one older than its
 * pruning spares. A scratch that has filled or been damaged is repaired by
 * removing its directory and starting the process again, never by hand inside
 * it: git believes a shallow file or a graft left there, and an answer decided
 * on one is wrong.
 *
 * NO ANSWER IS REMEMBERED BETWEEN ASKS. The scratch is the memory: a tip it
 * holds is answered from it by local calls alone, and an answer read afresh
 * each time is one a wrong reading cannot outlive. What is kept between asks
 * is the fetch each repository has in flight and the waits, which say when a
 * fetch is begun and nothing of any commit.
 */

import { assertNever } from "../../domain/assertNever.ts";
import type {
  CommitAncestry,
  CommitAncestryPort,
  CommitAncestryQuestion,
} from "../../interpreter/commitAncestry.ts";
import type {
  GitObjectId,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { GitEnvironment } from "./gitRun.ts";
import {
  scratchFetchHistory,
  scratchHoldsHistory,
  scratchNamesCommit,
  scratchOpen,
  scratchReaches,
  scratchWalksHistory,
  type GitCommitIdentity,
  type GitScratch,
  type ScratchFound,
} from "./gitScratch.ts";

/** What the adapter is composed over, each bound, the wait and the clock optional because each has a default. */
export interface GitCommitAncestryOptions {
  readonly scratchDirectory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentials: RepositoryCredentialPort;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
  readonly answerTimeoutSecsMax?: number;
  readonly fetchesInFlightMax?: number;
  readonly fetchWaitersMax?: number;
  readonly refetchWaitSecs?: number;
  readonly refetchWaitsMax?: number;
  readonly monotonicNowMs?: () => number;
}

/**
 * The bounds, the wait after a fetch that failed and the clock a composition
 * naming none is given. An asker's bound stays under the console's read
 * timeout, so a remote too slow for a page is `Unknown` on that page rather
 * than a read that never came back.
 */
export const gitCommitAncestryDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 5,
  remoteTimeoutSecsMax: 300,
  answerTimeoutSecsMax: 10,
  fetchesInFlightMax: 4,
  fetchWaitersMax: 100,
  refetchWaitSecs: 300,
  refetchWaitsMax: 1000,
  monotonicNowMs: (): number => performance.now(),
} as const;

/** A bound as whoever waits under it sees it: it resolves once the bound has passed, and never where what it bounded ended first. */
type GitCommitAncestryBound = Promise<undefined>;

/** One asker waiting on a fetch: how it is told the fetch ended and whether the tip came to be held, and how it is told the fetch raised. */
interface GitCommitAncestryWaiter {
  readonly ended: (landed: boolean) => void;
  readonly raised: (failure: unknown) => void;
}

/** The one fetch a repository has in flight: the tip it is for, and the askers still waiting for it to end. */
interface GitCommitAncestryFlight {
  readonly tip: GitObjectId;
  readonly waiters: Set<GitCommitAncestryWaiter>;
}

/**
 * What the adapter holds across asks: its scratch, its credential source, the
 * fetch each repository has in flight, the reading of its clock each tip's wait
 * ends at, and the bounds, the wait and the clock that are its own. The waits
 * stand in the order they were begun, which is the order they end in.
 */
interface GitCommitAncestryState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly flights: Map<RepositoryId, GitCommitAncestryFlight>;
  readonly refetchWaits: Map<string, number>;
  readonly fetchesInFlightMax: number;
  readonly fetchWaitersMax: number;
  readonly answerTimeoutSecsMax: number;
  readonly refetchWaitSecs: number;
  readonly refetchWaitsMax: number;
  readonly monotonicNowMs: () => number;
}

/** Runs one wait under a bound of its own, which the wait is handed so that it can give way to it. The bound's timer is gone once the wait has ended. */
async function gitCommitAncestryBounded<Value>(
  timeoutSecsMax: number,
  waits: (bound: GitCommitAncestryBound) => Promise<Value>,
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

/** Fetches the tip's whole history in the time given and answers whether its ref now says a commit by that identity is held. */
async function gitCommitAncestryFetchWith(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  credential: RepositoryCredential | undefined,
  timeoutSecsMax: number,
): Promise<boolean> {
  const repository = question.repository.repository;
  await scratchFetchHistory(
    own.scratch,
    repository,
    credential,
    question.tip,
    timeoutSecsMax,
  );
  const held = await scratchHoldsHistory(own.scratch, repository, question.tip);
  return held === "Yes";
}

/**
 * Fetches with whatever the credential source resolves, the wait for the source
 * coming out of the one remote bound the transfer is then given the rest of.
 * A refusal is read as no credential, so a public repository still answers.
 */
async function gitCommitAncestryFetch(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<boolean> {
  const timeoutSecsMax = own.scratch.options.remoteTimeoutSecsMax;
  const beganMs = own.monotonicNowMs();
  const resolved = await gitCommitAncestryBounded(timeoutSecsMax, (bound) =>
    Promise.race([own.credentials.credential(question.repository), bound]),
  );
  if (resolved === undefined) return false;
  const transferTimeoutSecsMax =
    timeoutSecsMax - (own.monotonicNowMs() - beganMs) / 1000;
  switch (resolved.resolved) {
    case "Credential":
      return gitCommitAncestryFetchWith(
        own,
        question,
        resolved.credential,
        transferTimeoutSecsMax,
      );
    case "Denied":
      return gitCommitAncestryFetchWith(
        own,
        question,
        undefined,
        transferTimeoutSecsMax,
      );
    case "Unavailable":
      return false;
    default:
      return assertNever(resolved);
  }
}

/** What a tip's wait is kept under: the tip and then its repository, the tip being hex and so never running into the spelling after it. */
function gitCommitAncestryRefetchKey(question: CommitAncestryQuestion): string {
  return `${question.tip} ${question.repository.repository}`;
}

/** Whether a fetch of the tip failed so lately that none may be begun for it yet. */
function gitCommitAncestryRefetchWaits(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): boolean {
  const endsMs = own.refetchWaits.get(gitCommitAncestryRefetchKey(question));
  return endsMs !== undefined && own.monotonicNowMs() < endsMs;
}

/** Begins the wait of a tip whose fetch has just failed, forgetting the wait begun first where as many are kept as may be. */
function gitCommitAncestryRefetchWaitBegins(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): void {
  const key = gitCommitAncestryRefetchKey(question);
  own.refetchWaits.delete(key);
  if (own.refetchWaits.size >= own.refetchWaitsMax) {
    const first = own.refetchWaits.keys().next();
    if (first.done !== true) own.refetchWaits.delete(first.value);
  }
  own.refetchWaits.set(key, own.monotonicNowMs() + own.refetchWaitSecs * 1000);
}

/**
 * Begins the one fetch a repository has in flight, which tells whoever is still
 * waiting on it how it ended, having begun the tip's wait where it ended without
 * the tip found held. None is begun while as many repositories as may be
 * fetched at once already are.
 */
function gitCommitAncestryFlight(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): GitCommitAncestryFlight | undefined {
  const repository = question.repository.repository;
  if (own.flights.size >= own.fetchesInFlightMax) return undefined;
  const flight: GitCommitAncestryFlight = {
    tip: question.tip,
    waiters: new Set(),
  };
  const ends = (tell: (waiter: GitCommitAncestryWaiter) => void): void => {
    own.flights.delete(repository);
    flight.waiters.forEach(tell);
  };
  own.flights.set(repository, flight);
  gitCommitAncestryFetch(own, question).then(
    (landed) => {
      if (!landed) gitCommitAncestryRefetchWaitBegins(own, question);
      ends((waiter) => {
        waiter.ended(landed);
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
 * Waits on a fetch for one asker and answers whether the tip came to be held,
 * or `undefined` where the asker did not see the fetch end. That is an asker
 * whose bound passed first, which is a waiter no longer from then, and one that
 * found as many waiting as may.
 */
function gitCommitAncestryWaits(
  own: GitCommitAncestryState,
  flight: GitCommitAncestryFlight,
  asker: GitCommitAncestryBound,
): Promise<boolean | undefined> {
  if (flight.waiters.size >= own.fetchWaitersMax)
    return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const waiter: GitCommitAncestryWaiter = { ended: resolve, raised: reject };
    flight.waiters.add(waiter);
    void asker.then(() => {
      flight.waiters.delete(waiter);
      resolve(undefined);
    });
  });
}

/** What a read found for an asker still waiting, and `Unread` once its bound has passed first, so that nothing is decided or begun on it. */
function gitCommitAncestryRead(
  asker: GitCommitAncestryBound,
  found: Promise<ScratchFound>,
): Promise<ScratchFound> {
  return Promise.race([found, asker.then((): ScratchFound => "Unread")]);
}

/**
 * Whether the tip's whole history came to be held while the asker waited: by a
 * fetch that completed earlier, by the one in flight for it, or by one begun
 * once the repository's fetch of another tip has ended. An asker of the tip in
 * flight joins that fetch without reading the scratch, and any other begins or
 * waits on a fetch only on git's no to the tip's ref and outside the tip's wait.
 */
async function gitCommitAncestryHeld(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  asker: GitCommitAncestryBound,
): Promise<boolean> {
  const repository = question.repository.repository;
  let flight = own.flights.get(repository);
  if (flight?.tip !== question.tip) {
    const held = await gitCommitAncestryRead(
      asker,
      scratchHoldsHistory(own.scratch, repository, question.tip),
    );
    if (held !== "No") return held === "Yes";
    if (gitCommitAncestryRefetchWaits(own, question)) return false;
    flight =
      own.flights.get(repository) ?? gitCommitAncestryFlight(own, question);
    if (flight === undefined) return false;
  }
  const landed = await gitCommitAncestryWaits(own, flight, asker);
  if (landed === undefined) return false;
  if (flight.tip === question.tip) return landed;
  return gitCommitAncestryHeld(own, question, asker);
}

/**
 * Decides against a tip a ref names, in the one place what the reads found is
 * put together. The tip's width is the repository's, so a candidate of another
 * width names nothing it could hold and decides nothing.
 */
async function gitCommitAncestryDecide(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  asker: GitCommitAncestryBound,
): Promise<CommitAncestry> {
  const { candidate, tip } = question;
  if (candidate.length !== tip.length) return "Unknown";
  const { scratch } = own;
  const repository = question.repository.repository;
  const named = await gitCommitAncestryRead(
    asker,
    scratchNamesCommit(scratch, repository, candidate),
  );
  const reached =
    named === "Yes"
      ? await gitCommitAncestryRead(
          asker,
          scratchReaches(scratch, repository, candidate, tip),
        )
      : named;
  switch (reached) {
    case "Yes":
      return "Ancestor";
    case "Unread":
      return "Unknown";
    case "No": {
      const walked = await gitCommitAncestryRead(
        asker,
        scratchWalksHistory(scratch, repository, tip),
      );
      return walked === "Yes" ? "NotAncestor" : "Unknown";
    }
    default:
      return assertNever(reached);
  }
}

/** Answers from the scratch once the tip is held, and `Unknown` where it did not come to be while the asker waited. */
async function gitCommitAncestryAnswer(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  asker: GitCommitAncestryBound,
): Promise<CommitAncestry> {
  if (!(await gitCommitAncestryHeld(own, question, asker))) return "Unknown";
  return gitCommitAncestryDecide(own, question, asker);
}

/**
 * Composes the adapter over a scratch of its own opening. An ask rejects only
 * where the credential source itself raises; whatever else it could not find
 * out, a git that could not be run included, is `Unknown`.
 */
export function gitCommitAncestry(
  options: GitCommitAncestryOptions,
): CommitAncestryPort {
  const resolved = { ...gitCommitAncestryDefaults, ...options };
  for (const bound of [
    resolved.answerTimeoutSecsMax,
    resolved.fetchesInFlightMax,
    resolved.fetchWaitersMax,
    resolved.refetchWaitSecs,
    resolved.refetchWaitsMax,
  ]) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new RangeError(
        "git commit ancestry: a bound or a wait is not a positive integer",
      );
    }
  }
  const own: GitCommitAncestryState = {
    scratch: scratchOpen({
      directory: resolved.scratchDirectory,
      identity: resolved.identity,
      environment: resolved.environment,
      credentialUsername: resolved.credentialUsername,
      localTimeoutSecsMax: resolved.localTimeoutSecsMax,
      remoteTimeoutSecsMax: resolved.remoteTimeoutSecsMax,
      promotionTimeoutSecsMax: resolved.remoteTimeoutSecsMax,
    }),
    credentials: resolved.credentials,
    flights: new Map(),
    refetchWaits: new Map(),
    fetchesInFlightMax: resolved.fetchesInFlightMax,
    fetchWaitersMax: resolved.fetchWaitersMax,
    answerTimeoutSecsMax: resolved.answerTimeoutSecsMax,
    refetchWaitSecs: resolved.refetchWaitSecs,
    refetchWaitsMax: resolved.refetchWaitsMax,
    monotonicNowMs: resolved.monotonicNowMs,
  };
  return {
    ancestry: (question) =>
      gitCommitAncestryBounded(own.answerTimeoutSecsMax, (asker) =>
        gitCommitAncestryAnswer(own, question, asker),
      ),
  };
}
