/**
 * What one process keeps of commit ancestry for the reads of action reach, and
 * how much it lets them ask of the port beneath.
 *
 * THE PORT REMEMBERS NOTHING AND BOUNDS NO LOCAL READ. Each question put to it
 * is several git processes, and one answered no walks its tip's whole history.
 * A page polls the read above this, so what bounds that work is kept here,
 * across reads and not inside one.
 *
 * A DECIDED ANSWER IS KEPT AND NOT ASKED AGAIN. `Ancestor` and `NotAncestor`
 * are true of two immutable commits for good. A stated count are kept, the one
 * decided first forgotten for one more, which costs asking it again.
 *
 * AN UNDECIDED QUESTION IS NOT ASKED AGAIN UNTIL A STATED WAIT HAS PASSED.
 * `Unknown` says only that the port could not find out, and its causes cannot
 * be told apart: a fetch still arriving, a remote or a credential source that
 * was down, a tip no remote holds. Inside the wait the answer is `Unknown` at
 * once and the port is asked nothing, so a read polled faster than the wait
 * spawns nothing for it. A port that raises is `Unknown` like any other.
 *
 * THE QUESTIONS UNDECIDED AT ONCE ARE HELD TO A STATED COUNT, those in flight
 * among them, and one past it is `Unknown` at once with nothing asked. The
 * tips asked about come from reports and a reporter may name any commit, so
 * this is what holds the tips put to the port while they cannot be fetched to
 * fewer than the waits it keeps for them.
 *
 * THE QUESTIONS IN FLIGHT ARE HELD TO A STATED COUNT, and a question asked
 * again while in flight joins that asking rather than beginning another.
 *
 * NOTHING HERE OUTLIVES THE PROCESS. A restart forgets every answer and every
 * wait, and what the port's scratch holds is all that is left.
 */

import type {
  CommitAncestry,
  CommitAncestryPort,
  CommitAncestryQuestion,
} from "./commitAncestry.ts";

/** An answer that is true of its two commits for good. */
export type ActionReachAncestryDecided = Exclude<CommitAncestry, "Unknown">;

/** The port beneath, the clock the waits are read on, and each bound and the wait, optional because each has a default. */
export interface ActionReachAncestryOptions {
  readonly port: CommitAncestryPort;
  readonly monotonicNowMs: () => number;
  readonly decidedMax?: number;
  readonly undecidedMax?: number;
  readonly undecidedWaitSecs?: number;
  readonly asksInFlightMax?: number;
}

/** The bounds and the wait a composition naming none is given. */
export const actionReachAncestryDefaults = {
  decidedMax: 4096,
  undecidedMax: 64,
  undecidedWaitSecs: 30,
  asksInFlightMax: 4,
} as const;

/** Ancestry as the reads of action reach are given it. */
export interface ActionReachAncestry {
  /** The answer kept for a question decided earlier, and nothing where none is. */
  decided(
    question: CommitAncestryQuestion,
  ): ActionReachAncestryDecided | undefined;
  /** Answers from what is kept, joins the asking in flight, asks the port, or is `Unknown` at once where asking is not due. It never rejects. */
  ask(question: CommitAncestryQuestion): Promise<CommitAncestry>;
}

/** What is kept across reads: the decided answers in the order they were decided, the reading of the clock each undecided question's wait ends at, and the askings in flight. */
interface ActionReachAncestryState {
  readonly port: CommitAncestryPort;
  readonly monotonicNowMs: () => number;
  readonly decided: Map<string, ActionReachAncestryDecided>;
  readonly waits: Map<string, number>;
  readonly asking: Map<string, Promise<CommitAncestry>>;
  readonly decidedMax: number;
  readonly undecidedMax: number;
  readonly undecidedWaitSecs: number;
  readonly asksInFlightMax: number;
}

/** What a question is kept under: its two commits and then its repository, the commits being hex and so never running into the spelling after them. */
function actionReachAncestryKey(question: CommitAncestryQuestion): string {
  return `${question.candidate} ${question.tip} ${question.repository.repository}`;
}

/** Keeps a decided answer, forgetting the one decided first where as many are kept as may be. */
function actionReachAncestryKept(
  own: ActionReachAncestryState,
  key: string,
  answer: ActionReachAncestryDecided,
): void {
  if (own.decided.size >= own.decidedMax) {
    const first = own.decided.keys().next();
    if (first.done !== true) own.decided.delete(first.value);
  }
  own.decided.set(key, answer);
}

/** Forgets every wait that has passed, so its question may be asked again and no longer counts as undecided. */
function actionReachAncestryWaitsPassed(own: ActionReachAncestryState): void {
  const nowMs = own.monotonicNowMs();
  for (const [key, endsMs] of own.waits)
    if (endsMs <= nowMs) own.waits.delete(key);
}

/** Puts one question to the port, a port that raises being one that could not find out. */
async function actionReachAncestryPut(
  own: ActionReachAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  try {
    return await own.port.ancestry(question);
  } catch {
    return "Unknown";
  }
}

/** Keeps what came of one asking: the answer where it decided, and a wait where it did not. */
function actionReachAncestryAnswered(
  own: ActionReachAncestryState,
  key: string,
  answer: CommitAncestry,
): CommitAncestry {
  own.asking.delete(key);
  if (answer === "Unknown")
    own.waits.set(key, own.monotonicNowMs() + own.undecidedWaitSecs * 1000);
  else actionReachAncestryKept(own, key, answer);
  return answer;
}

function actionReachAncestryAsk(
  own: ActionReachAncestryState,
  question: CommitAncestryQuestion,
): Promise<CommitAncestry> {
  const key = actionReachAncestryKey(question);
  const decided = own.decided.get(key);
  if (decided !== undefined) return Promise.resolve(decided);
  const joined = own.asking.get(key);
  if (joined !== undefined) return joined;
  actionReachAncestryWaitsPassed(own);
  if (
    own.waits.has(key) ||
    own.waits.size + own.asking.size >= own.undecidedMax ||
    own.asking.size >= own.asksInFlightMax
  )
    return Promise.resolve("Unknown");
  const asked = actionReachAncestryPut(own, question).then((answer) =>
    actionReachAncestryAnswered(own, key, answer),
  );
  own.asking.set(key, asked);
  return asked;
}

/** Composes what one process keeps, over the port it asks and the clock its waits are read on. */
export function actionReachAncestry(
  options: ActionReachAncestryOptions,
): ActionReachAncestry {
  const resolved = { ...actionReachAncestryDefaults, ...options };
  for (const bound of [
    resolved.decidedMax,
    resolved.undecidedMax,
    resolved.undecidedWaitSecs,
    resolved.asksInFlightMax,
  ]) {
    if (!Number.isSafeInteger(bound) || bound <= 0)
      throw new RangeError(
        "action reach ancestry: a bound or a wait is not a positive integer",
      );
  }
  const own: ActionReachAncestryState = {
    port: resolved.port,
    monotonicNowMs: resolved.monotonicNowMs,
    decided: new Map(),
    waits: new Map(),
    asking: new Map(),
    decidedMax: resolved.decidedMax,
    undecidedMax: resolved.undecidedMax,
    undecidedWaitSecs: resolved.undecidedWaitSecs,
    asksInFlightMax: resolved.asksInFlightMax,
  };
  return {
    decided: (question) => own.decided.get(actionReachAncestryKey(question)),
    ask: (question) => actionReachAncestryAsk(own, question),
  };
}
