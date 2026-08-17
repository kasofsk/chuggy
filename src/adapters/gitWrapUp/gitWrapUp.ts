/**
 * The wrap-up performer over git: for a ticket wrapping up exclusively the
 * gate is the merge, run against a configured remote — any URL git accepts,
 * a filesystem path to a bare repository included — under the lease the
 * holding phase derives.
 *
 * THE ATTEMPT NEVER RUNS INSIDE THE DRAIN. The executor awaits every port
 * call, and a child-process merge inside that await blocks the mailbox for
 * its duration; so `openGate` resolves the branch, records the instruction,
 * schedules the attempt on this adapter's own serialized chain — one chain,
 * because the chain is what keeps two attempts out of one scratch — and
 * returns. The outcome goes back through `Inbound.gateOutcome`, bound after
 * construction because boot re-delivers gates before the drive exists; a
 * report for a ticket no longer holding is Dropped by enablement, which is
 * the safety net for every stale re-answer.
 *
 * A RE-DELIVERY RE-ANSWERS, IT NEVER RE-ATTEMPTS. A concluded emission
 * answers again from its `wrapup_attempts` row: the port promises that a
 * repeated `openGate` runs no second distinct attempt, and the row is what
 * makes that promise structural rather than a property of which re-delivery
 * sources happen to exist today. Only an emission with no row re-runs, and
 * the ancestor check is what makes that re-run touch nothing when the merge
 * already landed: true idempotence is the repository's, the row is memory
 * of the outcome.
 *
 * A CONFLICT IS THE WORK FAILING and is priced as `WFailed` at once; every
 * other failure of an attempt is infrastructure and retries down the bounded
 * delay ladder, whose exhaustion also concludes `WFailed` — priced onto the
 * ticket the way the model flattens a task's infrastructure death into its
 * fail verdict, where an unbounded wedge would hold the lease forever. What
 * fails past the attempt — the conclusion's own write, the report's journal —
 * ends the chain loudly and the boot re-drive re-delivers.
 *
 * THE MERGE'S AUTHOR IS THE TICKET AUTHOR'S GIT IDENTITY, read through the
 * handed resolver at attempt time, and the committer stays the machine's. An
 * author the registry holds no identity for leaves the machine authoring
 * both: doc 011 scopes failing closed to the spawn, and a merge withheld
 * over attribution would wedge machine work. Nothing is signed, there being
 * no key to sign with.
 */

import type { DatabaseSync } from "node:sqlite";

import { assertNever } from "../../domain/assertNever.ts";
import type { Config } from "../../domain/config.ts";
import type { TicketId } from "../../domain/ids.ts";
import type { WrapUpOutcome } from "../../domain/wrapUp.ts";
import type { Inbound } from "../../interpreter/inbound.ts";
import {
  emissionKey,
  type Emission,
  type JournalStore,
  type WrapUpPort,
} from "../../interpreter/ports.ts";
import { wrapUpBranchAt } from "./resolve.ts";
import {
  scratchCommitMerge,
  scratchDefaultBranch,
  scratchFetchHeads,
  scratchIsAncestor,
  scratchMergeTree,
  scratchPrepare,
  scratchPush,
  scratchTipOf,
  type GitIdentity,
} from "./scratch.ts";
import { wrapUpTables, type WrapUpTables } from "./tables.ts";

/** Everything the performer is composed with; the store is the root's own opening, never a second one. */
export interface GitWrapUpOptions {
  readonly config: Config;
  readonly store: JournalStore;
  readonly db: DatabaseSync;
  readonly remote: string;
  readonly scratchDirectory: string;
  readonly identity: GitIdentity;
  /** The ticket author's git identity, read from configuration at attempt time; absent or answering nothing, the machine authors. */
  readonly authorOf?:
    ((ticket: TicketId) => Promise<GitIdentity | undefined>) | undefined;
  readonly retryDelaysMs?: readonly number[];
}

/** The port, plus the one binding construction cannot make: the drive does not exist yet when boot re-delivers. */
export interface GitWrapUp extends WrapUpPort {
  readonly bindInbound: (inbound: Inbound) => void;
}

/** The infrastructure retry ladder a deployment gets unless it hands its own. */
export const gitWrapUpRetryDelaysMs: readonly number[] = [1000, 5000, 25000];

/** How one attempt concluded, with the detail its table row keeps for audit. */
interface GitWrapUpConclusion {
  readonly outcome: WrapUpOutcome;
  readonly detail: string;
}

/** What the performer owns across attempts: the tables, the chain, and the awaited binding. */
interface GitWrapUpState {
  readonly options: GitWrapUpOptions;
  readonly tables: WrapUpTables;
  readonly retryDelaysMs: readonly number[];
  readonly inbound: Promise<Inbound>;
  chain: Promise<void>;
}

const gitWrapUpNothing = (): void => undefined;

function gitWrapUpSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function gitWrapUpWhy(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The merge-commit message; the emission key ties the commit back to the deciding journal row. */
function gitWrapUpMessage(emission: Emission, branch: string): string {
  return `chug: wrap up ticket ${String(emission.ticket)}\n\nMerges ${branch}. Decision ${emissionKey(emission)}.`;
}

/**
 * One lap of the attempt: refresh the scratch, answer from the ancestor check
 * where the merge already landed, otherwise merge by plumbing and push. Any
 * throw out of here is infrastructure; a conflict is a returned conclusion.
 */
async function gitWrapUpMergeOnce(
  own: GitWrapUpState,
  emission: Emission,
  branch: string,
): Promise<GitWrapUpConclusion> {
  const { scratchDirectory, remote, identity } = own.options;
  await scratchFetchHeads(scratchDirectory, remote);
  const defaultBranch = await scratchDefaultBranch(scratchDirectory, remote);
  const workTip = await scratchTipOf(scratchDirectory, branch);
  if (workTip === undefined) {
    throw new Error(
      `the remote holds no ${branch}, so there is nothing to merge`,
    );
  }
  const defaultTip = await scratchTipOf(scratchDirectory, defaultBranch);
  if (defaultTip === undefined) {
    throw new Error(`the remote's default branch ${defaultBranch} has no tip`);
  }
  if (await scratchIsAncestor(scratchDirectory, workTip, defaultTip)) {
    return { outcome: "WOk", detail: `${branch} is already merged` };
  }
  const merge = await scratchMergeTree(scratchDirectory, defaultTip, workTip);
  switch (merge.merged) {
    case "MConflict":
      return { outcome: "WFailed", detail: merge.detail };
    case "MClean": {
      const author =
        (await own.options.authorOf?.(emission.ticket)) ?? identity;
      const sha = await scratchCommitMerge(
        scratchDirectory,
        author,
        identity,
        merge.tree,
        [defaultTip, workTip],
        gitWrapUpMessage(emission, branch),
      );
      await scratchPush(scratchDirectory, remote, sha, defaultBranch);
      return { outcome: "WOk", detail: `merged ${sha}` };
    }
    default:
      return assertNever(merge);
  }
}

/** The bounded ladder over the laps: a conflict concludes at once, and exhaustion prices the machinery's death. */
async function gitWrapUpOutcomeOf(
  own: GitWrapUpState,
  emission: Emission,
  branch: string,
): Promise<GitWrapUpConclusion> {
  for (let rung = 0; ; rung++) {
    try {
      return await gitWrapUpMergeOnce(own, emission, branch);
    } catch (failure) {
      const delayMs = own.retryDelaysMs.at(rung);
      if (delayMs === undefined) {
        return {
          outcome: "WFailed",
          detail: `the attempt's machinery failed ${String(rung + 1)} time(s), last: ${gitWrapUpWhy(failure)}`,
        };
      }
      await gitWrapUpSleep(delayMs);
    }
  }
}

/** One scheduled delivery: re-answer a concluded emission from its row, or attempt, conclude, then report. */
async function gitWrapUpAttempt(
  own: GitWrapUpState,
  emission: Emission,
  branch: string,
): Promise<void> {
  const inbound = await own.inbound;
  const key = emissionKey(emission);
  const held = own.tables.concludedOf(key);
  if (held !== undefined) {
    await inbound.gateOutcome(emission.ticket, held);
    return;
  }
  const conclusion = await gitWrapUpOutcomeOf(own, emission, branch);
  own.tables.conclude(key, conclusion.outcome, conclusion.detail);
  await inbound.gateOutcome(emission.ticket, conclusion.outcome);
}

/** Appends a job to the one chain; what escapes a job is re-raised off the chain, ending the process loudly. */
function gitWrapUpSchedule(
  own: GitWrapUpState,
  job: () => Promise<void>,
): void {
  const run = own.chain.then(job);
  own.chain = run.then(gitWrapUpNothing, (failure: unknown) => {
    setTimeout(() => {
      throw failure instanceof Error ? failure : new Error(String(failure));
    });
  });
}

/** The performer over its options, refusing at construction what it could never serve. */
export function gitWrapUp(options: GitWrapUpOptions): GitWrapUp {
  if (options.config.nTasks !== 1) {
    throw new Error(
      "gitWrapUp: the mark-to-branch derivation needs the one-task work set; nTasks is not 1",
    );
  }
  scratchPrepare(options.scratchDirectory);
  const bound = Promise.withResolvers<Inbound>();
  const own: GitWrapUpState = {
    options,
    tables: wrapUpTables(options.db),
    retryDelaysMs: options.retryDelaysMs ?? gitWrapUpRetryDelaysMs,
    inbound: bound.promise,
    chain: Promise.resolve(),
  };
  let alreadyBound = false;
  return {
    enqueueWrapUp: (emission) => {
      own.tables.notice("EnqueueWrapUp", emission);
      return Promise.resolve();
    },
    openGate: async (emission) => {
      const loaded = await options.store.load();
      if (loaded.parsed === "Refused") {
        throw new Error(
          `gitWrapUp: the stored journal did not parse — ${loaded.why}`,
        );
      }
      const branch = wrapUpBranchAt(options.config, loaded.value, emission);
      own.tables.notice("OpenGate", emission);
      gitWrapUpSchedule(own, () => gitWrapUpAttempt(own, emission, branch));
    },
    bindInbound: (inbound) => {
      if (alreadyBound) {
        throw new Error("gitWrapUp: the inbound face is already bound");
      }
      alreadyBound = true;
      bound.resolve(inbound);
    },
  };
}
