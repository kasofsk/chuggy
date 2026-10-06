/**
 * Whether one commit is in another's history, answered from the bare scratch
 * kept per repository.
 *
 * A TIP IS HELD ONLY BY THE REF ITS OWN COMPLETED FETCH WROTE. git unpacks a
 * small fetch object by object and writes the ref last, so a fetch stopped
 * part-way can leave the tip standing without what it descends from. Taking
 * the object's existence for the history would then answer `NotAncestor` for a
 * candidate that had only not arrived yet, so nothing is decided against a tip
 * no such ref names.
 *
 * AN ANSWER RESTS ONLY ON READS THAT LOOKED. The scratch is asked whether the
 * candidate is a commit here, whether git reaches it from the tip, and whether
 * every commit of the tip's history can be read, and each read answers yes, no,
 * or that it did not look. `Ancestor` is a yes to the first two. `NotAncestor`
 * is a no to either and then a yes to the third, because git also gives each
 * of those noes where it could not read what the scratch holds. A read that
 * did not look decides nothing, whichever it was. Each no walks its tip's
 * whole history for itself, so many at once over a long history pass the local
 * bound and are `Unknown`.
 *
 * THE ASKER'S WAIT IS BOUNDED AND THE FETCH IS NOT STOPPED FOR IT. An asker is
 * answered `Unknown` once a bound short enough for a page being read has
 * passed, and from then on no read is begun for it and it waits on no fetch.
 * The fetch it began runs on under the remote bound, the wait for its
 * credential included, so a history too slow for one read is held by a later
 * one. A fetch stopped at that longer bound leaves its partial pack in the
 * scratch, as a stopped fetch of any reader of a scratch does. Nothing here
 * removes one, because a partial pack cannot be told from another reader's
 * transfer still arriving.
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
 * NOTHING IS REMEMBERED BETWEEN ASKS. The scratch is the memory: a tip it
 * holds is answered from it by local calls alone, and an answer read afresh
 * each time is one a wrong reading cannot outlive.
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

/** What the adapter is composed over, each bound optional because each has a default. */
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
}

/**
 * The bounds a composition naming none is given. An asker's wait stays under
 * the console's read timeout, so a remote too slow for a page is `Unknown` on
 * that page rather than a read that never came back.
 */
export const gitCommitAncestryDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 5,
  remoteTimeoutSecsMax: 300,
  answerTimeoutSecsMax: 10,
  fetchesInFlightMax: 4,
  fetchWaitersMax: 100,
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

/** What the adapter holds across asks: its scratch, its credential source, the fetch each repository has in flight, and the bounds that are its own. */
interface GitCommitAncestryState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly flights: Map<RepositoryId, GitCommitAncestryFlight>;
  readonly fetchesInFlightMax: number;
  readonly fetchWaitersMax: number;
  readonly answerTimeoutSecsMax: number;
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
  const beganMs = performance.now();
  const resolved = await gitCommitAncestryBounded(timeoutSecsMax, (bound) =>
    Promise.race([own.credentials.credential(question.repository), bound]),
  );
  if (resolved === undefined) return false;
  const transferTimeoutSecsMax =
    timeoutSecsMax - (performance.now() - beganMs) / 1000;
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

/** Begins the one fetch a repository has in flight, which tells whoever is still waiting on it how it ended. None is begun while as many repositories as may be fetched at once already are. */
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
 * flight joins that fetch without reading the scratch, and a fetch is begun
 * only on a read that looked and found no ref.
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
  ]) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new RangeError(
        "git commit ancestry: a bound is not a positive integer",
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
    fetchesInFlightMax: resolved.fetchesInFlightMax,
    fetchWaitersMax: resolved.fetchWaitersMax,
    answerTimeoutSecsMax: resolved.answerTimeoutSecsMax,
  };
  return {
    ancestry: (question) =>
      gitCommitAncestryBounded(own.answerTimeoutSecsMax, (asker) =>
        gitCommitAncestryAnswer(own, question, asker),
      ),
  };
}
