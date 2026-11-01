/**
 * An answer a reader submitted from an inbox row: what was answered, the
 * latest step its follow reported, and what the row says of it.
 *
 * A follow reports its steps into the row it came from, so the row needs what
 * was answered and its latest step, and nothing before it. An ending the actor
 * did not accept is the answer's refusal, said in the words the row draws.
 */

import {
  operationRefusalSentence,
  operationStateSentence,
} from "./codeSentences.ts";
import type { OperationStep } from "./operationFollow.ts";
import type { TicketAction } from "./ticketActions.ts";

export interface InboxAnswer {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

/** A follow past its last step, which is what its row draws from then on. */
export function inboxAnswerFinished(step: OperationStep): boolean {
  return step.step === "Settled" || step.step === "Abandoned";
}

export function inboxAnswerInFlight(step: OperationStep | undefined): boolean {
  return step !== undefined && !inboxAnswerFinished(step);
}

/** What the row says about the answer it is carrying, in the reader's terms. */
export function inboxStepSentence(step: OperationStep): string {
  switch (step.step) {
    case "Submitting":
      return "submitting…";
    case "Backlogged":
      return `the API is deferring this (${step.code})`;
    case "Following":
      return "waiting on the actor…";
    case "Confirming":
      return "waiting for the project to catch up…";
    case "Settled":
      return step.refusal === undefined
        ? operationStateSentence(step.state)
        : operationRefusalSentence(step.refusal);
    case "Abandoned":
      return step.reason;
  }
}

/** The row's sentence for a follow that ended without the actor accepting or
 * answering it, and nothing for one that did. */
export function inboxAnswerRefusal(step: OperationStep): string | undefined {
  if (step.step === "Settled")
    return step.state === "Succeeded" || step.state === "Answered"
      ? undefined
      : inboxStepSentence(step);
  return inboxStepSentence(step);
}
