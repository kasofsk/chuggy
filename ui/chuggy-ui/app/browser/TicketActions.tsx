/**
 * The mutations this ticket's phase enables, submitted and followed to
 * settlement.
 *
 * Which buttons exist is `ticketOffers`', and a read that has not answered
 * draws its own state where they would be. What happens after the click is
 * `followOperation`'s, and every step it passes through is drawn as it arrives
 * — including the ones it reaches by throwing — so a submission the API is
 * deferring reads as that rather than as a screen doing nothing, and one that
 * fell over reads as that rather than as a panel busy for ever. The confirmed
 * ticket is written into the cache the page reads, which is what makes it read
 * its own write.
 *
 * AN ANSWERED QUESTION IS RE-READ RATHER THAN ASSUMED GONE. Answering an
 * approval settles without journalling anything, so no `Ticket` frame follows
 * it; the open actions are read again once the follow ends, and the live
 * `NativeAction` frame empties them wherever the stream is carrying changes.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  TicketNativeActionsResponse,
  TicketResponse,
  DispatchViewResponse,
} from "../../../../src/contract/responses.ts";
import { apiCancelOperation } from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  operationFailureLabel,
  operationStepLabel,
  ticketActionEffect,
} from "../core/codeLabels.ts";
import type { ResumeOffer } from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  followOperation,
  operationAnswered,
  operationFinished,
  operationFollowing,
  operationIdBytesCount,
  operationSubmitting,
} from "../core/operationFollow.ts";
import type {
  OperationFollowed,
  OperationStep,
} from "../core/operationFollow.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { ticketArrival } from "../core/ticketArrival.ts";
import { ticketDispatchList } from "../core/ticketActions.ts";
import type {
  TicketAction,
  TicketActionName,
  TicketAttempt,
} from "../core/ticketActions.ts";
import type { TicketOffers } from "../core/ticketOffers.ts";
import { useApiPorts } from "./api.ts";
import { applyResourceArrival } from "./stream.tsx";
import {
  ticketAttemptDropped,
  ticketAttemptHeld,
  ticketAttemptRead,
} from "./ticketAttemptHeld.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { drawBytes } from "./ports.ts";
import { TicketEditOffer } from "./ticket/TicketEditOffer.tsx";
import { OfferedAction } from "./ui/OfferedAction.tsx";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

interface Attempt {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

function StepNote(props: {
  readonly step: OperationStep;
  readonly action: TicketAction;
}): ReactNode {
  const drawn = operationStepLabel(props.step, props.action.action);
  const tone = drawn.wrong ? "danger" : drawn.settled ? "info" : "live";
  return <Notice tone={tone} inline role="status" detail={drawn.text} />;
}

/** What the cancellation answered: the attempt is over, or it is not and this
 * is what said so. */
type Cancellation =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly said: string };

/** It answers rather than rejects, so that the one caller has one thing to
 * read whichever way the request ended. */
async function cancelOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<Cancellation> {
  try {
    const answered = await apiCancelOperation(
      ports,
      partition,
      operation,
      signal,
    );
    return answered.outcome === "Ok"
      ? { accepted: true }
      : { accepted: false, said: operationFailureLabel(answered) };
  } catch (thrown: unknown) {
    return { accepted: false, said: faultReason(thrown) };
  }
}

/** The reason a request carries when the reader is the one who stopped it. */
const attemptCancelledReason = "this attempt was cancelled";

/**
 * Why a request threw, so that a throw is drawn where a returned failure is.
 * `apiSend` answers most transport failures as an `Unreachable` outcome, but
 * the wait it takes between a server's retries is outside that, so both a
 * follow and a cancellation can reject — and a rejection nobody reads is a
 * panel left busy with nothing said. What comes back is half a line: the reason
 * is a thrown message and is somebody else's words, so every caller puts the
 * console's own subject in front of it.
 */
function faultReason(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : "the request failed";
}

/** What the follow learned, written into the caches this page reads from. */
function followWrittenBack(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  followed: OperationFollowed,
): void {
  const openKey = projectResourceKey(partition, "NativeAction", String(ticket));
  void client.invalidateQueries({ queryKey: openKey, exact: true });
  void client.invalidateQueries({
    queryKey: ticketDispatchList(partition, ticket).key,
    exact: true,
  });
  const confirmed = followed.ticket;
  if (confirmed === undefined) return;
  const key = projectResourceKey(partition, "Ticket", String(ticket));
  applyResourceArrival(
    client,
    key,
    ticketArrival(client.getQueryData<TicketResponse>(key), {
      carried: "ProjectRow",
      ticket: confirmed,
    }),
  );
}

/**
 * ONE INTENT IS ONE IDENTITY: a press draws one only where nothing is held, and
 * reaches what is held by the path a mount takes otherwise. A follow the API
 * never answered leaves its record standing and the buttons come back, and what
 * stands is a submission the machine may be working on — so it is polled to an
 * end rather than replaced, even where the press names another action, and the
 * reader's new intent waits for the buttons that come back when this one
 * settles.
 */
function attemptPressed(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  action: TicketAction,
): { readonly held: TicketAttempt; readonly startedFrom: OperationStep } {
  const standing = ticketAttemptRead(client, partition, ticket);
  if (standing !== undefined)
    return {
      held: standing,
      startedFrom: operationFollowing(standing.operation),
    };
  const held = {
    action,
    operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
  };
  ticketAttemptHeld(client, partition, ticket, held);
  return { held, startedFrom: operationSubmitting() };
}

/** Where a follow reports to: the panel's own step, and the caches the page
 * reads the ticket back out of. Gathered so the runner below is a function of
 * its arguments rather than of a hook's scope. */
interface AttemptWriter {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly client: QueryClient;
  readonly drawStep: (action: TicketAction, step: OperationStep) => void;
}

/**
 * One follow, run to whichever end it reaches. A throw ends it as abandoned,
 * because a screen told nothing is a screen that stays busy; a controller
 * already aborted is told nothing, because the screen that asked has gone or
 * the reader has cancelled and either has said its own last word.
 */
async function followInto(
  writer: AttemptWriter,
  held: TicketAttempt,
  startedFrom: OperationStep,
  controller: AbortController,
): Promise<void> {
  const action = held.action;
  try {
    const followed = await followOperation(
      writer.ports,
      writer.partition,
      { operation: held.operation, mutation: action.mutation },
      writer.ticket,
      (step) => {
        if (!controller.signal.aborted) writer.drawStep(action, step);
      },
      controller.signal,
      startedFrom,
    );
    if (!controller.signal.aborted)
      followWrittenBack(
        writer.client,
        writer.partition,
        writer.ticket,
        followed,
      );
  } catch (thrown: unknown) {
    if (!controller.signal.aborted)
      writer.drawStep(action, {
        step: "Abandoned",
        reason: `Failed · ${faultReason(thrown)}`,
        refused: false,
      });
  }
}

/** What the machine charges for and what it undoes, said before it is pressed.
 * A resume's effect names the exits it leaves, which are every action offered
 * and not only the ones drawn beside it. */
function ActionButtons(props: {
  readonly actions: readonly TicketAction[];
  readonly exits: readonly TicketActionName[];
  readonly busy: boolean;
  readonly resume: ResumeOffer;
  readonly onChoose: (action: TicketAction) => void;
}): ReactNode {
  return props.actions.map((action) => {
    const effect = ticketActionEffect(action.action, props.resume, props.exits);
    return (
      <OfferedAction
        key={action.action}
        action={action.action}
        effect={effect.effect}
        {...(effect.more === undefined ? {} : { more: effect.more })}
        {...(effect.refusedBecause === undefined
          ? {}
          : { refusedBecause: effect.refusedBecause })}
        offered={effect.offered}
        busy={props.busy}
        danger={action.action === "Revoke"}
        onChoose={() => {
          props.onChoose(action);
        }}
      />
    );
  });
}

/**
 * The follow this panel is running, named by the operation it is about. The
 * name is half of it: an answer to a request made about one operation can
 * arrive after the panel has moved on to another, and a controller alone cannot
 * tell those apart.
 */
interface Running {
  readonly controller: AbortController;
  readonly operation: string;
}

/**
 * A follow is abandoned with the screen that asked for it: the controller this
 * holds aborts the requests still in flight and the waits between them, and its
 * signal is what stops anything being reported afterwards.
 */
function useAbandonOnUnmount(): RefObject<Running | undefined> {
  const runningRef = useRef<Running | undefined>(undefined);
  useEffect(
    () => () => {
      runningRef.current?.controller.abort(
        new Error("the screen that asked for this is gone"),
      );
    },
    [],
  );
  return runningRef;
}

/**
 * An accepted cancellation ends the attempt, so it is drawn as the attempt's
 * own last step rather than as a line beside a follow still saying it is
 * waiting — unless the follow reached an end of its own while the cancellation
 * was in flight, which is the truer answer and stands. A refused cancellation
 * ends nothing: the operation is still the actor's, and the follow goes on
 * watching it.
 */
function attemptCancelled(
  operation: string,
): (held: Attempt | undefined) => Attempt | undefined {
  return (held) =>
    held === undefined || operationFinished(held.step)
      ? held
      : {
          action: held.action,
          step: {
            step: "Settled",
            operation,
            state: "Cancelled",
            refusal: undefined,
          },
        };
}

/**
 * An attempt this page left running, drawn from the first render rather than
 * after one: the pick-up below re-reads the operation, and a screen that drew
 * the button that started it in the meantime would offer the same submission a
 * second time.
 */
function attemptHeld(held: TicketAttempt | undefined): Attempt | undefined {
  return held === undefined
    ? undefined
    : { action: held.action, step: operationFollowing(held.operation) };
}

interface Submitting {
  readonly attempt: Attempt | undefined;
  readonly refused: string | undefined;
  readonly submit: (action: TicketAction) => void;
  readonly cancel: (operation: string) => void;
}

/**
 * One submission at a time, followed to settlement and merged into the ticket
 * this page reads. The confirmed row goes through `ticketArrival` because it
 * is a narrower projection than the ticket's own read and a live frame may
 * already have written a later one, and the open actions are invalidated rather
 * than written because what the follow learned is that the question was
 * answered and not what is open now.
 *
 * AN ATTEMPT OUTLIVES THE PANEL THAT MADE IT. The identity is held before the
 * submission is made and not after it is accepted, because a page that
 * unmounts with the submission in flight — which a reader who leaves and comes
 * back does — abandons the request without unmaking whatever the API did with
 * it. So the record is what a mount
 * picks up, and the pick-up polls, because only the API can say whether the
 * identity it names ever arrived.
 *
 * A press reaches a held record by the same path, which `attemptPressed` is.
 */
function useSubmitting(
  partition: PartitionIdentity,
  ticket: number,
): Submitting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const runningRef = useAbandonOnUnmount();
  const [attempt, setAttempt] = useState<Attempt | undefined>(() =>
    attemptHeld(ticketAttemptRead(client, partition, ticket)),
  );
  const [refused, setRefused] = useState<string | undefined>(undefined);

  /**
   * A record goes when the API has said what became of the submission and stays
   * when it has not, which `operationAnswered` is: an operation the API settled,
   * or one it declined to make at all. What stays is a budget spent on an
   * operation still pending and a submission whose response was lost — and a
   * submission the browser made and lost the answer to is still a submission,
   * so what the record is for is the panel that comes back and asks again under
   * the same identity.
   */
  const drawStep = (action: TicketAction, step: OperationStep): void => {
    setAttempt({ action, step });
    if (!operationFinished(step)) return;
    setRefused(undefined);
    if (operationAnswered(step))
      ticketAttemptDropped(client, partition, ticket);
  };

  /** Whatever was running is abandoned before this replaces it, so that no
   * caller can leave two follows reporting to one panel. */
  const follow = (held: TicketAttempt, startedFrom: OperationStep): void => {
    runningRef.current?.controller.abort(
      new Error("another attempt took this panel"),
    );
    const controller = new AbortController();
    runningRef.current = { controller, operation: held.operation };
    void followInto(
      { ports, partition, ticket, client, drawStep },
      held,
      startedFrom,
      controller,
    );
  };

  /**
   * WHAT A CANCELLATION ANSWERS ABOUT IS ONE OPERATION, AND WHAT IT IS APPLIED
   * TO IS WHAT THE PANEL IS RUNNING WHEN THE ANSWER ARRIVES — so it is applied
   * only where those are the same operation. A cancelled attempt that settles
   * on its own before the answer comes, and a second attempt started after it,
   * are the case that reads as one panel and is two: the answer names the
   * first, and applying it to the second would abort a live follow, name the
   * wrong operation on screen, and drop the record that is the only thing
   * holding the second one's identity.
   *
   * The signal is taken when the request is made and the abort is aimed when it
   * answers, which is also what a Cancel pressed in a picked-up attempt's first
   * paint needs: there is no controller yet to carry, and the follow that comes
   * a moment later is the one to stop.
   */
  const cancel = async (operation: string): Promise<void> => {
    const answered = await cancelOperation(
      ports,
      partition,
      operation,
      runningRef.current?.controller.signal,
    );
    const standing = runningRef.current;
    if (standing === undefined || standing.operation !== operation) return;
    if (standing.controller.signal.aborted) return;
    if (!answered.accepted) {
      setRefused(answered.said);
      return;
    }
    standing.controller.abort(new Error(attemptCancelledReason));
    setAttempt(attemptCancelled(operation));
    setRefused(undefined);
    ticketAttemptDropped(client, partition, ticket);
  };

  useEffect(() => {
    const held = ticketAttemptRead(client, partition, ticket);
    if (held !== undefined) follow(held, operationFollowing(held.operation));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pick-up is this mount's, and a later render must not follow the same operation twice
  }, []);

  return {
    attempt,
    refused,
    submit: (action) => {
      setRefused(undefined);
      const pressed = attemptPressed(client, partition, ticket, action);
      follow(pressed.held, pressed.startedFrom);
    },
    cancel: (operation) => {
      void cancel(operation);
    },
  };
}

/** One ticket's submission and whether it is still going, shared by every
 * place a button for the ticket is drawn so that there is one follow and not
 * one per place. */
export interface TicketActing {
  readonly submitting: Submitting;
  readonly busy: boolean;
}

function TicketActingHeld(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly children: (acting: TicketActing) => ReactNode;
}): ReactNode {
  const submitting = useSubmitting(props.partition, props.ticket);
  const step = submitting.attempt?.step;
  const busy = step !== undefined && !operationFinished(step);
  return props.children({ submitting, busy });
}

/**
 * The submission, keyed by the ticket it is about, which is what makes the
 * pick-up above per ticket rather than per mount and is why its effect names no
 * dependency. THE KEY IS HERE AND NOT AT THE CALL SITE, which is where the
 * idiom would put it, because a caller who left it off would get a page
 * drawing the last ticket's attempt over this one rather than an error, and a
 * component that cannot be mounted wrongly is worth more here than the idiom.
 */
export function TicketActingScope(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly children: (acting: TicketActing) => ReactNode;
}): ReactNode {
  const { tenant, project } = props.partition;
  return (
    <TicketActingHeld
      key={`${tenant}/${project}/${String(props.ticket)}`}
      partition={props.partition}
      ticket={props.ticket}
    >
      {props.children}
    </TicketActingHeld>
  );
}

/** Where the submission has got to, the Cancel that stops it, and what a
 * refused Cancel said. */
function FollowNotes(props: { readonly submitting: Submitting }): ReactNode {
  const attempt = props.submitting.attempt;
  const step = attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  return (
    <>
      {attempt === undefined ? null : (
        <StepNote step={attempt.step} action={attempt.action} />
      )}
      {pending === undefined ? null : (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            props.submitting.cancel(pending);
          }}
        >
          Cancel
        </Button>
      )}
      {props.submitting.refused === undefined ? null : (
        <Notice
          tone="danger"
          inline
          detail={`Cancel refused · ${props.submitting.refused}`}
        />
      )}
    </>
  );
}

export interface TicketActionsProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly acting: TicketActing;
  readonly offers: TicketOffers;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
  readonly resume: ResumeOffer;
  /** The actions a card beside the bar answers, which the bar leaves out. */
  readonly answered: readonly TicketAction[];
}

/** Every action but the ones a card answers, the edit screen, and the follow
 * of whichever was pressed, wherever it was pressed. */
export function TicketBarActions(props: TicketActionsProps): ReactNode {
  const offers = props.offers;
  return (
    <>
      {offers.offers === "Unread" ? (
        <PanelUnready state={props.openState} />
      ) : (
        <>
          <ActionButtons
            actions={offers.actions.filter(
              (action) =>
                !props.answered.some(
                  (answer) => answer.action === action.action,
                ),
            )}
            exits={offers.actions.map((offered) => offered.action)}
            busy={props.acting.busy}
            resume={props.resume}
            onChoose={props.acting.submitting.submit}
          />
          {offers.editable ? (
            <TicketEditOffer
              partition={props.partition}
              ticket={props.ticket}
            />
          ) : null}
        </>
      )}
      {props.dispatchState.state === "Failed" ? (
        <Notice
          tone="parked"
          inline
          detail={`Dispatch unavailable · ${props.dispatchState.reason}`}
        />
      ) : null}
      <FollowNotes submitting={props.acting.submitting} />
    </>
  );
}

/** The actions that answer what the ticket is waiting on, drawn in the card
 * that asks it and followed by the same submission as the bar's. */
export function TicketAnswerActions(props: {
  readonly acting: TicketActing;
  readonly offers: TicketOffers;
  readonly answered: readonly TicketAction[];
  readonly resume: ResumeOffer;
}): ReactNode {
  if (props.offers.offers === "Unread") return null;
  return (
    <ActionButtons
      actions={props.answered}
      exits={props.offers.actions.map((offered) => offered.action)}
      busy={props.acting.busy}
      resume={props.resume}
      onChoose={props.acting.submitting.submit}
    />
  );
}
