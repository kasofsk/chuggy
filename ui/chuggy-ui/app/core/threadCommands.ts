/**
 * What the composer's `/status` and `/usage` say of the reader's thread, from
 * the reads they are answered from, and what `/clear` does to it.
 *
 * `/status` IS READ, NOT KEPT. The thread's standing and its model come from
 * the thread's own read and where it runs from the project's session
 * placement, each as it stands when the line is drawn, so a line left open
 * moves when either read does.
 *
 * `/usage` IS EVERY TURN OF THE MAILBOX, SUMMED HERE. No route answers a
 * thread's totals, so the thread's pages are read back to its first turn, and a
 * thread with more pages than `threadUsagePagesMax` is summed over its newest
 * and says so rather than standing for the whole.
 *
 * `/clear` CLOSES BEFORE IT OPENS. The thread is closed first, and another is
 * opened only once the close has answered `Ok`, so a refused close leaves the
 * reader where they were rather than holding a thread beside the one they
 * meant to end. A thread with a turn the mailbox has not settled is not
 * cleared, since closing it would abandon that turn.
 */

import type {
  SessionPlacementResponse,
  ThreadResponse,
  ThreadTurnResponse,
} from "../../../../src/contract/responses.ts";
import { threadTurnsAnsweredMax } from "../../../../src/contract/http.ts";
import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import {
  costAmountFigure,
  durationFigure,
  tokenCountUnitFigure,
} from "./figures.ts";
import type { Figure } from "./figures.ts";
import { failureWords, readFailedLine } from "./failureWords.ts";
import type { FailureWords } from "./failureWords.ts";
import type { CopyText } from "./copy.ts";
import type { PanelState } from "./freshness.ts";
import {
  runnerRouteLabel,
  runnerRouteSourceLabel,
  runnerStandingLabel,
} from "./runners.ts";
import { threadWriting } from "./threads.ts";

/** One term of the `/status` line and what it says. */
export interface ThreadStatusFact {
  readonly term: string;
  readonly said: string;
}

/** The model the newest turn that names one ran on: the mailbox lists its
 * turns newest last, and a turn still running has named none yet. */
export function threadModel(
  turns: readonly ThreadTurnResponse[],
): string | undefined {
  return turns.findLast((turn) => turn.model !== undefined)?.model;
}

/** Where the reader's thread runs, what set that, and, where it waits on their
 * own runner, whether that runner is there. */
function threadStatusPlacement(
  placement: PanelState<SessionPlacementResponse>,
  text: CopyText,
): readonly ThreadStatusFact[] {
  switch (placement.state) {
    case "Pending":
      return [{ term: "Runs on", said: "Loading…" }];
    case "Absent":
      return [{ term: "Runs on", said: "Not found" }];
    case "Failed":
      return [
        { term: "Runs on", said: readFailedLine(undefined, placement.failure) },
      ];
    case "Ready": {
      const thread = placement.value.thread;
      return [
        { term: "Runs on", said: text(runnerRouteLabel(thread.route)) },
        { term: "Set by", said: text(runnerRouteSourceLabel(thread.source)) },
        ...(thread.route === "Pool"
          ? [
              {
                term: "Runner",
                said: text(runnerStandingLabel(placement.value.runners.mine)),
              },
            ]
          : []),
      ];
    }
  }
}

/** The `/status` line: the thread's standing, where it runs, and its model,
 * with a box no thread is open behind yet said as one. */
export function threadStatusFacts(
  thread: ThreadResponse | undefined,
  placement: PanelState<SessionPlacementResponse>,
  text: CopyText,
): readonly ThreadStatusFact[] {
  const model = thread === undefined ? undefined : threadModel(thread.turns);
  return [
    { term: "Thread", said: thread?.state ?? "Not opened" },
    ...threadStatusPlacement(placement, text),
    { term: "Model", said: model ?? "None reported yet" },
  ];
}

/** What the thread's turns measured between them, each sum absent where no
 * turn measured it, and whether every turn was reached. */
export interface ThreadUsage {
  readonly turns: number;
  readonly tokens: number | undefined;
  readonly costMicros: number | undefined;
  readonly durationMs: number | undefined;
  readonly whole: boolean;
}

function threadUsageAdded(
  sum: number | undefined,
  measured: number | undefined,
): number | undefined {
  return measured === undefined ? sum : (sum ?? 0) + measured;
}

export function threadUsageSummed(
  turns: readonly ThreadTurnResponse[],
  whole: boolean,
): ThreadUsage {
  return turns.reduce<ThreadUsage>(
    (usage, turn) => ({
      ...usage,
      tokens: threadUsageAdded(usage.tokens, turn.tokens),
      costMicros: threadUsageAdded(usage.costMicros, turn.costMicros),
      durationMs: threadUsageAdded(usage.durationMs, turn.durationMs),
    }),
    {
      turns: turns.length,
      tokens: undefined,
      costMicros: undefined,
      durationMs: undefined,
      whole,
    },
  );
}

/** The most pages of a thread's mailbox `/usage` reads before it sums what it
 * has, each the most turns a read answers. */
export const threadUsagePagesMax = 64;

/** One page of the thread's mailbox, older than `before` where it is named. */
export type ThreadUsagePageRead = (page: {
  readonly before?: number;
  readonly limit: number;
}) => Promise<ApiResult<ThreadResponse>>;

/** The thread's turns read page by page back to its first, or to the bound,
 * and summed; the first read the server refuses is the answer instead. */
export async function threadUsagePaged(
  read: ThreadUsagePageRead,
): Promise<ApiResult<ThreadUsage>> {
  const turns: ThreadTurnResponse[] = [];
  let before: number | undefined = undefined;
  for (let page = 0; page < threadUsagePagesMax; page += 1) {
    const answered = await read({
      ...(before === undefined ? {} : { before }),
      limit: threadTurnsAnsweredMax,
    });
    if (answered.outcome !== "Ok") return answered;
    turns.push(...answered.value.turns);
    before = answered.value.nextBefore;
    if (before === undefined)
      return { outcome: "Ok", value: threadUsageSummed(turns, true) };
  }
  return { outcome: "Ok", value: threadUsageSummed(turns, false) };
}

/** How many turns the sums are over, and that they are only the newest where
 * the bound was reached first. */
export function threadUsageTurnsText(usage: ThreadUsage): string {
  const counted = `${String(usage.turns)} ${usage.turns === 1 ? "turn" : "turns"}`;
  return usage.whole ? counted : `Newest ${counted}`;
}

/** The sums as the meta line under a turn draws each one. */
export function threadUsageFigures(usage: ThreadUsage): readonly Figure[] {
  return [
    ...(usage.tokens === undefined ? [] : [tokenCountUnitFigure(usage.tokens)]),
    ...(usage.costMicros === undefined
      ? []
      : [costAmountFigure(usage.costMicros)]),
    ...(usage.durationMs === undefined
      ? []
      : [durationFigure(usage.durationMs)]),
  ];
}

/** Why `/clear` closes nothing now: the thread is still answering a turn, one
 * the reader sent that no read lists yet among them, or the box has no thread
 * open behind it. */
export type ThreadClearWithheld = "Answering" | "Unopened";

export function threadClearWithheld(
  thread: Pick<ThreadResponse, "turns">,
  sending: number,
): "Answering" | undefined {
  return sending > 0 || threadWriting(thread) ? "Answering" : undefined;
}

/** What `/clear` ended as: the thread closed and another asked for, a close
 * refused and nothing opened, or a start already on its way that it left
 * alone. */
export type ThreadCleared =
  | { readonly cleared: "Closed" }
  | { readonly cleared: "Refused"; readonly failure: ApiFailure }
  | { readonly cleared: "Busy" };

/** The thread closed, and only once the close answered `Ok`, `open` asked and
 * what it answered handed back. */
export async function threadClearedThenOpened<T>(
  close: () => Promise<ApiResult<unknown>>,
  open: () => Promise<T>,
): Promise<
  | { readonly cleared: "Refused"; readonly failure: ApiFailure }
  | { readonly cleared: "Closed"; readonly opened: T }
> {
  const closed = await close();
  if (closed.outcome !== "Ok") return { cleared: "Refused", failure: closed };
  return { cleared: "Closed", opened: await open() };
}

/** What the command line says of a `/clear` that opened nothing, and nothing
 * where it went through. */
export function threadClearedWord(
  cleared: ThreadCleared | ThreadClearWithheld,
): FailureWords | undefined {
  if (cleared === "Answering") return { word: "Thread is answering" };
  if (cleared === "Unopened") return { word: "No thread to clear" };
  switch (cleared.cleared) {
    case "Closed":
      return undefined;
    case "Busy":
      return { word: "A thread is already starting" };
    case "Refused":
      return failureWords(cleared.failure);
  }
}
