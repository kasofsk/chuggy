/**
 * An answer a reader submitted from an inbox row: what was answered, the
 * latest step its follow reported, and what the row says of it.
 *
 * A follow reports its steps into the row it came from, so the row needs what
 * was answered and its latest step, and nothing before it. An ending the actor
 * did not accept is the answer's refusal, said in the words the row draws.
 */

import { operationAbandonWords } from "./codeLabels.ts";
import {
  operationRefusalSentence,
  operationStateSentence,
} from "./codeSentences.ts";
import type { OperationStep } from "./operationFollow.ts";
import type { TicketAction, TicketActionName } from "./ticketActions.ts";
import type { Copy, CopyOrData, CopyText } from "./copy.ts";

const inboxStepWords = {
  Submitting: { id: "inbox-step-submitting" },
  Backlogged: { id: "inbox-step-busy" },
  Following: { id: "inbox-step-waiting" },
  Confirming: { id: "inbox-step-updating" },
} as const;

export interface InboxAnswer {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

/** An answer a row offers, in the word its button says. */
export function inboxActionLabel(action: TicketActionName): Copy {
  switch (action) {
    case "Dispatch":
      return { id: "inbox-action-dispatch" };
    case "Resume":
      return { id: "inbox-action-resume" };
    case "Revoke":
      return { id: "inbox-action-revoke" };
    case "Approve":
      return { id: "inbox-action-approve" };
    case "Decline":
      return { id: "inbox-action-decline" };
    case "Release":
      return { id: "inbox-action-release" };
  }
}

/** A follow past its last step, which is what its row draws from then on. */
export function inboxAnswerFinished(step: OperationStep): boolean {
  return step.step === "Settled" || step.step === "Abandoned";
}

export function inboxAnswerInFlight(step: OperationStep | undefined): boolean {
  return step !== undefined && !inboxAnswerFinished(step);
}

/** What the row says about the answer it is carrying, in the reader's terms. */
export function inboxStepSentence(step: OperationStep, text: CopyText): string {
  switch (step.step) {
    case "Submitting":
    case "Backlogged":
    case "Following":
    case "Confirming":
      return text(inboxStepWords[step.step]);
    case "Settled":
      return text(
        step.refusal === undefined
          ? operationStateSentence(step.state)
          : operationRefusalSentence(step.refusal),
      );
    case "Abandoned":
      return text(operationAbandonWords(step.cause).word);
  }
}

/** What a reader reporting an abandoned answer reads on hover of its word. */
export function inboxStepDetail(step: OperationStep): CopyOrData | undefined {
  return step.step === "Abandoned"
    ? operationAbandonWords(step.cause).detail
    : undefined;
}

/** The row's sentence for a follow that ended without the actor accepting or
 * answering it, and nothing for one that did. */
export function inboxAnswerRefusal(
  step: OperationStep,
  text: CopyText,
): string | undefined {
  if (step.step === "Settled")
    return step.state === "Succeeded" || step.state === "Answered"
      ? undefined
      : inboxStepSentence(step, text);
  return inboxStepSentence(step, text);
}
