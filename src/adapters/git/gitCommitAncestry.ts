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
 * ONE FETCH IS IN FLIGHT PER REPOSITORY AND TIP, AND A STATED COUNT OF THEM AT
 * ONCE. Every asker of a tip not yet held waits on the same fetch and reads the
 * scratch only after it has ended, so a page reloaded during a slow remote
 * starts no second transfer and reads no half of the first. Each fetch is a
 * git process holding part of a history in memory, so a tip asked for while
 * that count is already running is `Unknown` rather than one more of them.
 *
 * THE REMOTE BOUND IS THIS ADAPTER'S OWN, because it answers a page being read
 * and the scratch's other users do not. A fetch that outruns it is stopped and
 * the answer is `Unknown`; nothing of that fetch is trusted afterwards, so the
 * next ask begins again.
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
  RepositoryCredential,
  RepositoryCredentialPort,
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
  readonly fetchesInFlightMax?: number;
}

/**
 * The bounds a composition naming none is given. The remote one stays under
 * the console's read timeout, so a remote too slow for a page is `Unknown` on
 * that page rather than a read that never came back.
 */
export const gitCommitAncestryDefaults = {
  credentialUsername: "chuggy",
  localTimeoutSecsMax: 5,
  remoteTimeoutSecsMax: 10,
  fetchesInFlightMax: 4,
} as const;

/** What the adapter holds across asks: its scratch, its credential source and the fetches in flight. */
interface GitCommitAncestryState {
  readonly scratch: GitScratch;
  readonly credentials: RepositoryCredentialPort;
  readonly fetching: Map<string, Promise<boolean>>;
  readonly fetchesInFlightMax: number;
}

/** Fetches the tip's whole history and answers whether its ref now says a commit by that identity is held. */
async function gitCommitAncestryFetchWith(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
  credential: RepositoryCredential | undefined,
): Promise<boolean> {
  const repository = question.repository.repository;
  const fetched = await scratchFetchHistory(
    own.scratch,
    repository,
    credential,
    question.tip,
  );
  if (!fetched) return false;
  return scratchHoldsHistory(own.scratch, repository, question.tip);
}

/** Fetches with whatever the credential source resolves, a refusal being read as no credential so a public repository still answers. */
async function gitCommitAncestryFetch(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<boolean> {
  const resolved = await own.credentials.credential(question.repository);
  switch (resolved.resolved) {
    case "Credential":
      return gitCommitAncestryFetchWith(own, question, resolved.credential);
    case "Denied":
      return gitCommitAncestryFetchWith(own, question, undefined);
    case "Unavailable":
      return false;
    default:
      return assertNever(resolved);
  }
}

/** The one fetch every asker of a repository and tip waits on, not begun while as many as may run at once already are. */
function gitCommitAncestryFlight(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<boolean> {
  const key = `${question.tip} ${question.repository.repository}`;
  const flying = own.fetching.get(key);
  if (flying !== undefined) return flying;
  if (own.fetching.size >= own.fetchesInFlightMax)
    return Promise.resolve(false);
  const flight = gitCommitAncestryFetch(own, question).finally(() => {
    own.fetching.delete(key);
  });
  own.fetching.set(key, flight);
  return flight;
}

/** Whether the tip's whole history is held, by a fetch that completed earlier or by the one this waits on. */
async function gitCommitAncestryHeld(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<boolean> {
  const held = await scratchHoldsHistory(
    own.scratch,
    question.repository.repository,
    question.tip,
  );
  if (held) return true;
  return gitCommitAncestryFlight(own, question);
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

async function gitCommitAncestryAsk(
  own: GitCommitAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  if (!(await gitCommitAncestryHeld(own, question))) return "Unknown";
  return gitCommitAncestryDecide(own, question);
}

export function gitCommitAncestry(
  options: GitCommitAncestryOptions,
): CommitAncestryPort {
  const resolved = { ...gitCommitAncestryDefaults, ...options };
  if (
    !Number.isSafeInteger(resolved.fetchesInFlightMax) ||
    resolved.fetchesInFlightMax <= 0
  ) {
    throw new RangeError(
      "git commit ancestry: a count is not a positive integer",
    );
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
    fetching: new Map(),
    fetchesInFlightMax: resolved.fetchesInFlightMax,
  };
  return { ancestry: (question) => gitCommitAncestryAsk(own, question) };
}
