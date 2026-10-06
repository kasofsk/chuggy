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
 * ABSENCE IS A FINDING ONLY OVER A HISTORY READ TO ITS END. git reports a
 * lookup it could not complete exactly as it reports an object that is not
 * there, and the ref says only that a fetch completed once: the objects under
 * it can since have become unreadable, and may never have arrived where another
 * ref already named the tip. So a candidate the scratch does not resolve is
 * `NotAncestor` only once every commit of the tip's history has been read from
 * the object store. A candidate it does resolve must be a commit by its own
 * name, because git would otherwise answer for the commit a tag peels to.
 *
 * THE ASKER'S WAIT IS BOUNDED AND THE FETCH IS NOT STOPPED FOR IT. An asker is
 * answered `Unknown` once a bound short enough for a page being read has
 * passed, whatever its answer was still waiting on. The fetch it began runs on
 * under the bound the scratch's other readers fetch under, the wait for its
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
 * that one left out, where two at once would each transfer the history. A tip
 * asked for while that count of repositories is being fetched is `Unknown`,
 * and a tip already held is answered whatever is in flight.
 *
 * NOTHING IS REMEMBERED BETWEEN ASKS. The scratch is the memory: a tip it
 * holds is answered from it by local calls alone, and an answer read afresh
 * each time is one a wrong reading cannot outlive.
 */

import { setTimeout as delay } from "node:timers/promises";

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
  scratchIsAncestor,
  scratchNamed,
  scratchOpen,
  scratchWalksHistory,
  type GitCommitIdentity,
  type GitScratch,
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
} as const;

/** The one fetch a repository has in flight: the tip it is for, and whether that tip's history came to be held. */
interface GitCommitAncestryFlight {
  readonly tip: GitObjectId;
  readonly landed: Promise<boolean>;
}

/** What the adapter holds across asks: its scratch, its credential source, the fetch each repository has in flight, and the two bounds that are its own. */
interface GitCommitAncestryState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly flights: Map<RepositoryId, GitCommitAncestryFlight>;
  readonly fetchesInFlightMax: number;
  readonly answerTimeoutSecsMax: number;
}

/** What a wait came to within its bound, and `undefined` once the bound passed first; what was waited on is left running. */
async function gitCommitAncestryWithin<Value>(
  waited: Promise<Value>,
  timeoutSecsMax: number,
): Promise<Value | undefined> {
  const bound = new AbortController();
  try {
    return await Promise.race([
      waited,
      delay(timeoutSecsMax * 1000, undefined, { signal: bound.signal }),
    ]);
  } finally {
    bound.abort();
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
  return scratchHoldsHistory(own.scratch, repository, question.tip);
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
  const resolved = await gitCommitAncestryWithin(
    own.credentials.credential(question.repository),
    timeoutSecsMax,
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

/** Begins the one fetch a repository has in flight, and none while as many repositories as may be fetched at once already are. */
function gitCommitAncestryFlight(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<boolean> {
  const repository = question.repository.repository;
  if (own.flights.size >= own.fetchesInFlightMax) return Promise.resolve(false);
  const landed = gitCommitAncestryFetch(own, question).finally(() => {
    own.flights.delete(repository);
  });
  own.flights.set(repository, { tip: question.tip, landed });
  return landed;
}

/**
 * Whether the tip's whole history is held: by a fetch that completed earlier,
 * by the one in flight for it, or by one begun once the repository's fetch of
 * another tip has ended. A round that found the tip's own fetch begun is
 * followed by the one that joins it, any other follows a fetch that ended, and
 * an asker whose bound has passed takes none.
 */
async function gitCommitAncestryHeld(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  untilMs: number,
): Promise<boolean> {
  const repository = question.repository.repository;
  const joined = own.flights.get(repository);
  if (joined?.tip === question.tip) return joined.landed;
  if (await scratchHoldsHistory(own.scratch, repository, question.tip))
    return true;
  const flying = own.flights.get(repository);
  if (flying === undefined) return gitCommitAncestryFlight(own, question);
  if (flying.tip !== question.tip) {
    await flying.landed;
    if (performance.now() >= untilMs) return false;
  }
  return gitCommitAncestryHeld(own, question, untilMs);
}

/** What git says of a candidate that is a commit here, a call it could not answer deciding nothing. */
async function gitCommitAncestryDecideHeld(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  const ancestor = await scratchIsAncestor(
    own.scratch,
    question.repository.repository,
    question.candidate,
    question.tip,
  );
  if (ancestor === undefined) return "Unknown";
  return ancestor ? "Ancestor" : "NotAncestor";
}

/**
 * Decides against a tip a ref names. The tip's width is the repository's, so a
 * candidate of another width names nothing it could hold and decides nothing.
 */
async function gitCommitAncestryDecide(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  if (question.candidate.length !== question.tip.length) return "Unknown";
  const repository = question.repository.repository;
  const named = await scratchNamed(own.scratch, repository, question.candidate);
  switch (named) {
    case "Commit":
      return gitCommitAncestryDecideHeld(own, question);
    case "Other":
      return "Unknown";
    case "Unresolved":
      return (await scratchWalksHistory(own.scratch, repository, question.tip))
        ? "NotAncestor"
        : "Unknown";
    default:
      return assertNever(named);
  }
}

/** Answers from the scratch once the tip is held, and `Unknown` where it did not come to be. */
async function gitCommitAncestryAnswer(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  untilMs: number,
): Promise<CommitAncestry> {
  if (!(await gitCommitAncestryHeld(own, question, untilMs))) return "Unknown";
  return gitCommitAncestryDecide(own, question);
}

/** One ask, answered `Unknown` once the asker's bound has passed whatever the answer was still waiting on. */
async function gitCommitAncestryAsk(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  const untilMs = performance.now() + own.answerTimeoutSecsMax * 1000;
  const answered = await gitCommitAncestryWithin(
    gitCommitAncestryAnswer(own, question, untilMs),
    own.answerTimeoutSecsMax,
  );
  return answered ?? "Unknown";
}

/**
 * Composes the adapter over a scratch of its own opening. An ask rejects only
 * where a scratch cannot be used at all or the credential source itself
 * raises; whatever else it could not find out is `Unknown`.
 */
export function gitCommitAncestry(
  options: GitCommitAncestryOptions,
): CommitAncestryPort {
  const resolved = { ...gitCommitAncestryDefaults, ...options };
  for (const bound of [
    resolved.answerTimeoutSecsMax,
    resolved.fetchesInFlightMax,
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
    answerTimeoutSecsMax: resolved.answerTimeoutSecsMax,
  };
  return { ancestry: (question) => gitCommitAncestryAsk(own, question) };
}
