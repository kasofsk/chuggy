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
 *
 * AN ATTEMPT OUTLIVES THE PANEL THAT MADE IT. The follow is a console write,
 * so a page that unmounts with it in flight leaves it running and a page that
 * mounts again draws it. Its identity is held before the submission is made
 * and outlives the follow too, because a follow can end without the API ever
 * saying what it did: the record is what a mount picks up and a press reaches
 * by the same path, `attemptPressed`, and the pick-up polls, because only the
 * API can say whether the identity it names ever arrived.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { MutationKey, QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  TicketNativeActionsResponse,
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
import {
  ConsoleWriteProgress,
  ConsoleWriteRefused,
  consoleWriteKey,
} from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
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
import { sessionRunnerShortWord } from "../core/sessionRunners.ts";
import { ticketArrival } from "../core/ticketArrival.ts";
import {
  ticketDispatchQuery,
  ticketNativeActionsQuery,
  ticketQuery,
} from "../core/ticketQueries.ts";
import { manualDispatchAction } from "../core/ticketActions.ts";
import type {
  TicketAction,
  TicketActionName,
  TicketAttempt,
} from "../core/ticketActions.ts";
import {
  ticketOffersAllowed,
  ticketOffersStartable,
} from "../core/ticketOffers.ts";
import type { TicketOffers } from "../core/ticketOffers.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "./consoleWrite.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { applyResourceArrival } from "./stream.tsx";
import {
  ticketAttemptDropped,
  ticketAttemptHeld,
  ticketAttemptRead,
} from "./ticketAttemptHeld.ts";
import { PanelUnready, ReadFailed } from "./DataPanel.tsx";
import { drawBytes } from "./ports.ts";
import { TicketDuplicateOffer } from "./ticket/TicketDuplicateOffer.tsx";
import { TicketEditOffer } from "./ticket/TicketEditOffer.tsx";
import {
  TicketRevokeConfirm,
  useTicketRevokeAsk,
} from "./ticket/TicketRevoke.tsx";
import { OfferedAction } from "./ui/OfferedAction.tsx";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { AddRunnerLink, useWorkRunner } from "./workRunner.tsx";

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
 * Why a request threw, so that a throw is drawn where a returned failure is:
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

/** What the follow learned, written into the caches this page reads from and
 * answered before the write is over. */
async function followWrittenBack(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  followed: OperationFollowed | undefined,
): Promise<void> {
  const confirmed = followed?.ticket;
  if (confirmed !== undefined) {
    const key = ticketQuery(partition, ticket).queryKey;
    applyResourceArrival(
      client,
      key,
      ticketArrival(client.getQueryData(key), {
        carried: "ProjectRow",
        ticket: confirmed,
      }),
    );
  }
  await Promise.all(
    [
      ticketNativeActionsQuery(partition, ticket),
      ticketDispatchQuery(partition, ticket),
    ].map((query) =>
      client.invalidateQueries({ queryKey: query.queryKey, exact: true }),
    ),
  );
}

/** One press, or one pick-up: the identity it follows, the step it starts
 * from, where it reports its steps, and what stops it. */
interface TicketActionPressed {
  readonly held: TicketAttempt;
  readonly startedFrom: OperationStep;
  readonly progress: ConsoleWriteProgress<OperationStep>;
  readonly controller: AbortController;
}

function ticketActionPressedOf(
  held: TicketAttempt,
  startedFrom: OperationStep,
): TicketActionPressed {
  return {
    held,
    startedFrom,
    progress: new ConsoleWriteProgress<OperationStep>(),
    controller: new AbortController(),
  };
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
): TicketActionPressed {
  const standing = ticketAttemptRead(client, partition, ticket);
  if (standing !== undefined)
    return ticketActionPressedOf(
      standing,
      operationFollowing(standing.operation),
    );
  const held = {
    action,
    operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
  };
  ticketAttemptHeld(client, partition, ticket, held);
  return ticketActionPressedOf(held, operationSubmitting());
}

function ticketActionWriteKey(
  partition: PartitionIdentity,
  ticket: number,
): MutationKey {
  return consoleWriteKey(
    "ticket-action",
    partition.tenant,
    partition.project,
    ticket,
  );
}

/** The follow under way for the ticket, wherever it was pressed. */
function ticketActionRunning(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
): TicketActionPressed | undefined {
  return client
    .getMutationCache()
    .findAll({
      mutationKey: ticketActionWriteKey(partition, ticket),
      exact: true,
      status: "pending",
    })
    .at(-1)?.state.variables as TicketActionPressed | undefined;
}

/**
 * One follow, run to whichever end it reaches and drawn step by step. A throw
 * ends it as abandoned, and a follow the reader cancelled ends there and
 * reports nothing more, because the cancellation has said its last word.
 */
async function ticketActionFollowed(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  pressed: TicketActionPressed,
): Promise<OperationFollowed | undefined> {
  const { held, controller } = pressed;
  const report = (step: OperationStep): void => {
    if (!controller.signal.aborted) pressed.progress.report(step);
  };
  const stopped = new Promise<undefined>((resolve) => {
    controller.signal.addEventListener("abort", () => {
      resolve(undefined);
    });
  });
  try {
    return await Promise.race([
      followOperation(
        ports,
        partition,
        { operation: held.operation, mutation: held.action.mutation },
        ticket,
        report,
        controller.signal,
        pressed.startedFrom,
      ),
      stopped,
    ]);
  } catch (thrown: unknown) {
    report({
      step: "Abandoned",
      reason: `Failed · ${faultReason(thrown)}`,
      refused: false,
    });
    return undefined;
  }
}

/**
 * A ticket's action, submitted and followed to settlement. A record goes when
 * the API has said what became of the submission and stays when it has not,
 * which `operationAnswered` is, so a panel that comes back asks again under the
 * same identity; an ending other than success is the write's refusal, in the
 * words its step is drawn in.
 */
function ticketActionWrite(
  partition: PartitionIdentity,
  ticket: number,
): ConsoleWrite<TicketActionPressed, undefined> {
  return {
    mutationKey: ticketActionWriteKey(partition, ticket),
    write: async (ports, pressed, client) => {
      const followed = await ticketActionFollowed(
        ports,
        partition,
        ticket,
        pressed,
      );
      const step = pressed.progress.step;
      if (pressed.controller.signal.aborted || step === undefined)
        return { outcome: "Ok", value: undefined };
      if (operationAnswered(step))
        ticketAttemptDropped(client, partition, ticket);
      if (followed !== undefined)
        await followWrittenBack(client, partition, ticket, followed);
      const drawn = operationStepLabel(step, pressed.held.action.action);
      if (drawn.wrong) throw new ConsoleWriteRefused(drawn.text);
      return { outcome: "Ok", value: undefined };
    },
    refusal: operationFailureLabel,
  };
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
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  standing: TicketActionPressed,
): void {
  const step = standing.progress.step;
  if (step === undefined || !operationFinished(step))
    standing.progress.report({
      step: "Settled",
      operation: standing.held.operation,
      state: "Cancelled",
      refusal: undefined,
    });
  standing.controller.abort(new Error(attemptCancelledReason));
  ticketAttemptDropped(client, partition, ticket);
}

/**
 * WHAT A CANCELLATION ANSWERS ABOUT IS ONE OPERATION, AND WHAT IT IS APPLIED
 * TO IS THE FOLLOW UNDER WAY WHEN THE ANSWER ARRIVES — so it is applied only
 * where those are the same operation, because a cancelled attempt that settles
 * on its own before the answer comes, and a second attempt started after it,
 * are the case that reads as one panel and is two: the answer names the first,
 * and applying it to the second would abort a live follow, name the wrong
 * operation on screen, and drop the record that is the only thing holding the
 * second one's identity. A refusal nobody is following any more says nothing.
 */
function ticketCancelWrite(
  partition: PartitionIdentity,
  ticket: number,
): ConsoleWrite<string, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "ticket-cancel",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: async (ports, operation, client) => {
      const answered = await cancelOperation(
        ports,
        partition,
        operation,
        ticketActionRunning(client, partition, ticket)?.controller.signal,
      );
      const standing = ticketActionRunning(client, partition, ticket);
      if (
        standing === undefined ||
        standing.held.operation !== operation ||
        standing.controller.signal.aborted
      )
        return { outcome: "Ok", value: undefined };
      if (!answered.accepted)
        throw new ConsoleWriteRefused(`Cancel refused · ${answered.said}`);
      attemptCancelled(client, partition, ticket, standing);
      return { outcome: "Ok", value: undefined };
    },
    refusal: (failure) => `Cancel refused · ${operationFailureLabel(failure)}`,
  };
}

/** What the machine charges for and what it undoes, said before it is pressed,
 * with Revoke asking before it submits. A resume's effect names the exits it
 * leaves, which are every action offered and not only the ones drawn beside
 * it. */
function ActionButtons(props: {
  readonly actions: readonly TicketAction[];
  readonly exits: readonly TicketActionName[];
  readonly attempt: Attempt | undefined;
  readonly busy: boolean;
  readonly resume: ResumeOffer;
  readonly onChoose: (action: TicketAction) => void;
}): ReactNode {
  const revoke = useTicketRevokeAsk(props.attempt);
  return props.actions.map((action) => {
    const effect = ticketActionEffect(action.action, props.resume, props.exits);
    const asks = action.action === "Revoke";
    const chosen = (): void => {
      props.onChoose(action);
    };
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
        danger={asks}
        {...(asks ? { expanded: revoke.open } : {})}
        onChoose={asks ? revoke.toggle : chosen}
      >
        {asks && revoke.open ? (
          <TicketRevokeConfirm ask={revoke} onRevoke={chosen} />
        ) : null}
      </OfferedAction>
    );
  });
}

/**
 * An attempt this page left standing, drawn from the first render rather than
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

/** The attempt drawn: the step the write under way or last made has reached,
 * else the record a follow left standing. */
function useTicketActionAttempt(
  pressed: TicketActionPressed | undefined,
  standing: TicketAttempt | undefined,
): Attempt | undefined {
  const step = useConsoleWriteProgress(pressed?.progress);
  if (pressed === undefined) return attemptHeld(standing);
  return {
    action: pressed.held.action,
    step: step ?? pressed.startedFrom,
  };
}

/**
 * One submission at a time, followed to settlement and merged into the ticket
 * this page reads. The confirmed row goes through `ticketArrival` because it
 * is a narrower projection than the ticket's own read and a live frame may
 * already have written a later one, and the open actions are read again rather
 * than written because what the follow learned is that the question was
 * answered and not what is open now.
 */
function useTicketActionWrite(
  partition: PartitionIdentity,
  ticket: number,
  drawn: boolean,
): TicketActing {
  const client = useQueryClient();
  const writing = useConsoleWrite(ticketActionWrite(partition, ticket), {
    drawn,
  });
  const attempt = useTicketActionAttempt(
    writing.variables,
    ticketAttemptRead(client, partition, ticket),
  );
  const step = attempt?.step;
  const following = step !== undefined && !operationFinished(step);
  const refusedOperation =
    following && "operation" in step ? step.operation : undefined;
  const cancelling = useConsoleWrite(ticketCancelWrite(partition, ticket), {
    drawn: (_, operation) => drawn && operation === refusedOperation,
  });

  useEffect(() => {
    const held = ticketAttemptRead(client, partition, ticket);
    if (held === undefined) return;
    const mutationKey = ticketActionWriteKey(partition, ticket);
    if (client.isMutating({ mutationKey, exact: true }) > 0) return;
    writing.mutate(
      ticketActionPressedOf(held, operationFollowing(held.operation)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pick-up is this mount's, and a later render must not follow the same operation twice
  }, []);

  const submitting: Submitting = {
    attempt,
    refused:
      cancelling.error !== null && cancelling.variables === refusedOperation
        ? cancelling.error.message
        : undefined,
    submit: (action) => {
      cancelling.reset();
      writing.mutate(attemptPressed(client, partition, ticket, action));
    },
    cancel: (operation) => {
      cancelling.mutate(operation);
    },
  };
  return { submitting, busy: writing.isPending || following };
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
  readonly drawn: boolean;
  readonly children: (acting: TicketActing) => ReactNode;
}): ReactNode {
  return props.children(
    useTicketActionWrite(props.partition, props.ticket, props.drawn),
  );
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
  /** Whether the children draw `FollowNotes` where they stand now, which is
   * where either write's refusal is said. */
  readonly drawn: boolean;
  readonly children: (acting: TicketActing) => ReactNode;
}): ReactNode {
  const { tenant, project } = props.partition;
  return (
    <TicketActingHeld
      key={`${tenant}/${project}/${String(props.ticket)}`}
      partition={props.partition}
      ticket={props.ticket}
      drawn={props.drawn}
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
        <Notice tone="danger" inline detail={props.submitting.refused} />
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
  /** Whether Dispatch is offered in a project no lead dispatches or will open to. */
  readonly byHand: boolean;
  /** Whether a Dispatch gave way because the project's work has no runner. */
  readonly noRunner: boolean;
}

/** Where Dispatch would be drawn in a project whose work has no runner to go
 * to: the words the creation form says it in, and the way to add one. */
function NoRunnerLine(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  return (
    <Notice tone="parked" inline detail={sessionRunnerShortWord("NoRunner")}>
      {" · "}
      <AddRunnerLink partition={props.partition} />
    </Notice>
  );
}

/** Every action but the ones a card answers, the edit screen, the duplicate
 * whatever the phase, and the follow of whichever was pressed, wherever it was
 * pressed. */
export function TicketBarActions(props: TicketActionsProps): ReactNode {
  const offers = props.offers;
  return (
    <>
      {props.noRunner ? <NoRunnerLine partition={props.partition} /> : null}
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
            attempt={props.acting.submitting.attempt}
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
      <TicketDuplicateOffer partition={props.partition} ticket={props.ticket} />
      {props.dispatchState.state === "Failed" ? (
        <ReadFailed subject="Dispatch" failure={props.dispatchState.failure} />
      ) : null}
      {props.byHand ? (
        <Notice tone="info" inline detail="No lead · Dispatched by hand" />
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
      attempt={props.acting.submitting.attempt}
      busy={props.acting.busy}
      resume={props.resume}
      onChoose={props.acting.submitting.submit}
    />
  );
}

/** The press a ready row's state chip answers, where the row may be dispatched. */
export interface TicketRowDispatch {
  readonly busy: boolean;
  readonly effect: string;
  readonly press: () => void;
}

/**
 * The Dispatch a ready row of the ticket list offers, expecting the version the
 * row was drawn at, as the press its state chip answers and the notes its
 * follow draws beside it. The reader's abilities and the project's runner take
 * it away as they take it on the ticket page, and a press is followed by the
 * same submission the ticket page would follow.
 */
export function TicketRowDispatchScope(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly sequence: number;
  readonly children: (
    dispatch: TicketRowDispatch | undefined,
    notes: ReactNode,
  ) => ReactNode;
}): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  const runner = useWorkRunner(props.partition, "Unknown");
  const { offers } = ticketOffersStartable(
    ticketOffersAllowed(
      {
        offers: "Actions",
        editable: false,
        actions: [manualDispatchAction(props.ticket, props.sequence)],
      },
      abilities,
    ),
    runner,
  );
  const offered =
    offers.offers === "Actions"
      ? offers.actions.find((action) => action.action === "Dispatch")
      : undefined;
  if (offered === undefined) return props.children(undefined, null);
  const effect = ticketActionEffect("Dispatch", { kind: "NoPoint" }).effect;
  return (
    <TicketActingScope partition={props.partition} ticket={props.ticket} drawn>
      {(acting) =>
        props.children(
          {
            busy: acting.busy,
            effect,
            press: () => {
              acting.submitting.submit(offered);
            },
          },
          <FollowNotes submitting={acting.submitting} />,
        )
      }
    </TicketActingScope>
  );
}
