/**
 * The answers a reader has submitted from the inbox, kept by the ticket each
 * one is about.
 *
 * A follow reports its steps into the row it came from, so the row needs the
 * latest step and nothing before it. What accumulates is one entry per ticket
 * answered, which is bounded by clicks rather than by anything the project
 * does — so the retained finished ones are capped, and shedding is the price of
 * writing the entry that went over.
 *
 * ONLY A FINISHED ANSWER IS SHED. An answer still in flight is the screen's one
 * account of a submission the actor may still act on, and dropping it would
 * leave a row saying nothing while its operation is open; the entry just
 * written is never the one shed, whatever it says.
 */

import type { OperationStep } from "./operationFollow.ts";

export const inboxAnswersFinishedMax = 20;

export type InboxAnswers = Readonly<Record<string, OperationStep>>;

export const inboxAnswersEmpty: InboxAnswers = {};

/** A follow past its last step, which is what its row draws until it is shed. */
export function inboxAnswerFinished(step: OperationStep): boolean {
  return step.step === "Settled" || step.step === "Abandoned";
}

export function inboxAnswerInFlight(step: OperationStep | undefined): boolean {
  return step !== undefined && !inboxAnswerFinished(step);
}

/** The written entry, then the finished ones in key order until the cap holds. */
function inboxAnswersShed(held: InboxAnswers, wrote: string): InboxAnswers {
  const finished = Object.entries(held)
    .filter(([at, step]) => at !== wrote && inboxAnswerFinished(step))
    .map(([at]) => at);
  if (finished.length <= inboxAnswersFinishedMax) return held;
  const shed = new Set(
    finished.slice(0, finished.length - inboxAnswersFinishedMax),
  );
  const kept: Record<string, OperationStep> = {};
  for (const [at, step] of Object.entries(held))
    if (!shed.has(at)) kept[at] = step;
  return kept;
}

export function inboxAnswersWith(
  held: InboxAnswers,
  ticket: number,
  step: OperationStep,
): InboxAnswers {
  const at = String(ticket);
  return inboxAnswersShed({ ...held, [at]: step }, at);
}
