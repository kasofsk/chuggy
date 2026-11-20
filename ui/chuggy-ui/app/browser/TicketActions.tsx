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
 * by the same path, `ticketAttemptPressed`, and the pick-up polls, because
 * only the API can say whether the identity it names ever arrived.
 */

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { MutationKey, QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import type {
  TicketNativeActionsResponse,
  DispatchViewResponse,
} from "../../../../src/contract/responses.ts";
import { apiCancelOperation } from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import {
  operationFailureLabel,
  operationStepLabel,
  ticketActionEffect,
  ticketActionLabel,
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
  operationAbandonFailure,
  operationAbandoned,
  operationAnswered,
  operationFinished,
  operationFollowing,
} from "../core/operationFollow.ts";
import type {
  OperationFollowed,
  OperationStep,
} from "../core/operationFollow.ts";
import { sessionRunnerShortWord } from "../core/sessionRunners.ts";
import { ticketArrival } from "../core/ticketArrival.ts";
import { ticketHeaderActionsOf } from "../core/ticketHeader.ts";
import {
  ticketDispatchQuery,
  ticketNativeActionsQuery,
  ticketQuery,
} from "../core/ticketQueries.ts";
import { nativeActionAnswerKey } from "../core/nativeActionAnswers.ts";
import { manualDispatchAction } from "../core/ticketActions.ts";
import type {
  TicketAction,
  TicketActionName,
  TicketAttempt,
} from "../core/ticketActions.ts";
import {
  ticketOffersAllowed,
  ticketOffersStartable,
  ticketRunnerOwner,
} from "../core/ticketOffers.ts";
import type { TicketOffers, TicketTakeOffer } from "../core/ticketOffers.ts";
import { useApiOnline } from "./api.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "./consoleWrite.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { applyResourceArrival } from "./stream.tsx";
import { useConsoleDispatch, useConsoleSelector } from "./store.ts";
import type { ConsoleDispatch } from "./store.ts";
import {
  ticketAttemptAt,
  ticketAttemptDroppedAt,
  ticketAttemptPressed,
} from "./ticketAttempts.ts";
import type { TicketAttemptPress } from "./ticketAttempts.ts";
import { PanelUnready, ReadFailed } from "./DataPanel.tsx";
import { TicketActionConfirm } from "./ticket/TicketActionConfirm.tsx";
import { ApprovalRejectDialog } from "./ticket/TicketApprovals.tsx";
import { TicketHeaderMenu } from "./ticket/TicketHeaderMenu.tsx";
import { useTicketTake } from "./ticket/TicketTake.tsx";
import type { MoreMenuItem } from "./ui/MoreMenu.tsx";
import { OfferedAction } from "./ui/OfferedAction.tsx";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { WordDetail } from "./ui/WordDetail.tsx";
import { AddRunnerLink, useWorkRunner } from "./workRunner.tsx";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { copyOrDataText } from "../core/copy.ts";
import type { CopyOrData, CopyText } from "../core/copy.ts";

interface Attempt {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

function StepNote(props: {
  readonly step: OperationStep;
  readonly action: TicketAction;
}): ReactNode {
  const text = useCopyText();
  const drawn = operationStepLabel(props.step, props.action.action);
  const tone = drawn.wrong ? "danger" : drawn.settled ? "info" : "live";
  return (
    <Notice tone={tone} inline role="status">
      <WordDetail word={text(drawn.text)} detail={drawn.detail} />
    </Notice>
  );
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
  text: CopyText,
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
      : { accepted: false, said: text(operationFailureLabel(answered)) };
  } catch (thrown: unknown) {
    return { accepted: false, said: copyOrDataText(text, faultReason(thrown)) };
  }
}

/**
 * Why a request threw, so that a throw is drawn where a returned failure is:
 * `apiSend` answers most transport failures as an `Unreachable` outcome, but
 * the wait it takes between a server's retries is outside that, so both a
 * follow and a cancellation can reject — and a rejection nobody reads is a
 * panel left busy with nothing said. What comes back is half a line: the reason
 * is a thrown message and is somebody else's words, so every caller puts the
 * console's own subject in front of it.
 */
function faultReason(thrown: unknown): CopyOrData {
  return thrown instanceof Error
    ? thrown.message
    : { id: "ticket-actions-request-failed" };
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

function ticketActionPressedOf({
  held,
  startedFrom,
}: TicketAttemptPress): TicketActionPressed {
  return {
    held,
    startedFrom,
    progress: new ConsoleWriteProgress<OperationStep>(),
    controller: new AbortController(),
  };
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
    report(operationAbandoned({ type: "Thrown", reason: faultReason(thrown) }));
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
  dispatch: ConsoleDispatch,
  text: CopyText,
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
        dispatch(ticketAttemptDroppedAt({ partition, ticket }));
      if (followed !== undefined)
        await followWrittenBack(client, partition, ticket, followed);
      const drawn = operationStepLabel(step, pressed.held.action.action);
      if (drawn.wrong)
        throw new ConsoleWriteRefused(
          text(drawn.text),
          operationAbandonFailure(step),
        );
      return { outcome: "Ok", value: undefined };
    },
    refusal: (failure) => text(operationFailureLabel(failure)),
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
  dispatch: ConsoleDispatch,
  partition: PartitionIdentity,
  ticket: number,
  standing: TicketActionPressed,
  text: CopyText,
): void {
  const step = standing.progress.step;
  if (step === undefined || !operationFinished(step))
    standing.progress.report({
      step: "Settled",
      operation: standing.held.operation,
      state: "Cancelled",
      refusal: undefined,
    });
  standing.controller.abort(
    new Error(text({ id: "ticket-actions-attempt-cancelled" })),
  );
  dispatch(ticketAttemptDroppedAt({ partition, ticket }));
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
  dispatch: ConsoleDispatch,
  text: CopyText,
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
        text,
      );
      const standing = ticketActionRunning(client, partition, ticket);
      if (
        standing === undefined ||
        standing.held.operation !== operation ||
        standing.controller.signal.aborted
      )
        return { outcome: "Ok", value: undefined };
      if (!answered.accepted)
        throw new ConsoleWriteRefused(
          text({
            id: "ticket-cancel-refused",
            args: { reason: answered.said },
          }),
        );
      attemptCancelled(dispatch, partition, ticket, standing, text);
      return { outcome: "Ok", value: undefined };
    },
    refusal: (failure) =>
      text({
        id: "ticket-cancel-refused",
        args: { reason: text(operationFailureLabel(failure)) },
      }),
  };
}

/** Whether a press of the action asks before it submits: Dispatch to be
 * sure, and Reject for the feedback it is sent with. */
function ticketActionAsks(action: TicketAction): boolean {
  return action.action === "Dispatch" || action.action === "Reject";
}

/** What a header's actions share: the ticket, what answering each would do,
 * and the one of them whose question is open. A resume's effect names the
 * exits it leaves, which are every action offered and not only the ones
 * drawn beside it. */
interface TicketHeaderPressing {
  readonly ticket: number;
  readonly exits: readonly TicketActionName[];
  readonly resume: ResumeOffer;
  readonly busy: boolean;
  readonly asking: TicketActionName | undefined;
  readonly onAsking: (asking: TicketActionName | undefined) => void;
  readonly onChoose: (action: TicketAction) => void;
}

/** The press of `action`: its question, where it asks one, or its submission. */
function ticketHeaderPress(
  pressing: TicketHeaderPressing,
  action: TicketAction,
): () => void {
  return ticketActionAsks(action)
    ? () => {
        pressing.onAsking(action.action);
      }
    : () => {
        pressing.onChoose(action);
      };
}

/** The question a press of `action` opens before it submits, where it opens
 * one, wherever the press was drawn. */
function TicketActionAsk(props: {
  readonly pressing: TicketHeaderPressing;
  readonly action: TicketAction;
}): ReactNode {
  const { pressing, action } = props;
  const text = useCopyText();
  const open = pressing.asking === action.action;
  const opened = (next: boolean): void => {
    pressing.onAsking(next ? action.action : undefined);
  };
  if (action.action === "Reject")
    return (
      <ApprovalRejectDialog
        offer={action}
        open={open}
        onOpenChange={opened}
        onReject={pressing.onChoose}
      />
    );
  if (action.action !== "Dispatch") return null;
  return (
    <TicketActionConfirm
      title={text({
        id: "ticket-dispatch-confirm-title",
        args: { number: String(pressing.ticket) },
      })}
      confirm={text(ticketActionLabel("Dispatch"))}
      open={open}
      onOpenChange={opened}
      onConfirm={() => {
        pressing.onChoose(action);
      }}
    >
      {text(
        ticketActionEffect(action.action, pressing.resume, pressing.exits)
          .effect,
      )}
    </TicketActionConfirm>
  );
}

/** The one action the header leads with, and what the machine charges for
 * it, said before it is pressed. */
function TicketHeaderPrimary(props: {
  readonly pressing: TicketHeaderPressing;
  readonly action: TicketAction;
}): ReactNode {
  const { pressing, action } = props;
  const text = useCopyText();
  const effect = ticketActionEffect(
    action.action,
    pressing.resume,
    pressing.exits,
  );
  return (
    <OfferedAction
      action={text(ticketActionLabel(action.action))}
      effect={text(effect.effect)}
      {...(effect.more === undefined ? {} : { more: text(effect.more) })}
      {...(effect.refusedBecause === undefined
        ? {}
        : { refusedBecause: effect.refusedBecause })}
      offered={effect.offered}
      busy={pressing.busy}
      primary
      onChoose={ticketHeaderPress(pressing, action)}
    />
  );
}

/** An action the header offers beside its primary one, as its menu's entry. */
function ticketHeaderMenuAction(
  pressing: TicketHeaderPressing,
  action: TicketAction,
  text: CopyText,
): MoreMenuItem {
  const effect = ticketActionEffect(
    action.action,
    pressing.resume,
    pressing.exits,
  );
  return {
    kind: "action",
    label: text(ticketActionLabel(action.action)),
    disabled: pressing.busy || !effect.offered,
    onSelect: ticketHeaderPress(pressing, action),
  };
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
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  const writing = useConsoleWrite(
    ticketActionWrite(partition, ticket, dispatch, text),
    { drawn },
  );
  const standing = useConsoleSelector((state) =>
    ticketAttemptAt(state, partition, ticket),
  );
  const attempt = useTicketActionAttempt(writing.variables, standing);
  const step = attempt?.step;
  const following = step !== undefined && !operationFinished(step);
  const refusedOperation =
    following && "operation" in step ? step.operation : undefined;
  const cancelling = useConsoleWrite(
    ticketCancelWrite(partition, ticket, dispatch, text),
    { drawn: (_, operation) => drawn && operation === refusedOperation },
  );

  useEffect(() => {
    if (standing === undefined) return;
    const mutationKey = ticketActionWriteKey(partition, ticket);
    if (client.isMutating({ mutationKey, exact: true }) > 0) return;
    writing.mutate(
      ticketActionPressedOf({
        held: standing,
        startedFrom: operationFollowing(standing.operation),
      }),
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
      writing.mutate(
        ticketActionPressedOf(
          dispatch(ticketAttemptPressed(partition, ticket, action)),
        ),
      );
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
export function FollowNotes(props: {
  readonly submitting: Submitting;
}): ReactNode {
  const attempt = props.submitting.attempt;
  const step = attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  const text = useCopyText();
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
          {text({ id: "ticket-cancel" })}
        </Button>
      )}
      {props.submitting.refused === undefined ? null : (
        <Notice tone="danger" inline detail={props.submitting.refused} />
      )}
    </>
  );
}

export interface TicketHeaderActionsProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  /** The ticket's phase as read, absent while the read is. */
  readonly phase: TicketPhase | undefined;
  readonly acting: TicketActing;
  readonly offers: TicketOffers;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
  readonly resume: ResumeOffer;
  /** Offered actions the page holds back for now. */
  readonly withheld: readonly TicketActionName[];
  /** Whether the reader may start a new ticket from this one. */
  readonly duplicates: boolean;
  /** Whether a Dispatch gave way because the project's work has no runner. */
  readonly noRunner: boolean;
  /** The one of Take and Return the reader is offered, for themselves. */
  readonly take: TicketTakeOffer;
}

/** Where Dispatch would be drawn in a project whose work has no runner to go
 * to: the words the creation form says it in, and the way to add one. */
function NoRunnerLine(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  return (
    <Notice
      tone="parked"
      inline
      detail={text(sessionRunnerShortWord("NoRunner"))}
    >
      {" · "}
      <AddRunnerLink partition={props.partition} />
    </Notice>
  );
}

function TicketDuplicateLink(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const text = useCopyText();
  return (
    <ButtonLink
      to="/$tenant/$project/tickets/new"
      params={props.partition}
      search={{ from: props.ticket }}
      variant="primary"
    >
      {text({ id: "ticket-duplicate" })}
    </ButtonLink>
  );
}

function headerActionsOf(props: TicketHeaderActionsProps) {
  return props.phase === undefined
    ? undefined
    : ticketHeaderActionsOf(
        props.offers,
        props.phase,
        props.withheld,
        props.duplicates,
      );
}

/** The edit screen, as the header's menu offers it: a link and not a
 * submission, because what an update sends is written on that screen. */
function ticketHeaderEditItem(
  partition: PartitionIdentity,
  ticket: number,
  text: CopyText,
): MoreMenuItem {
  return {
    kind: "link",
    label: text({ id: "ticket-edit" }),
    link: (anchor) => (
      <Link
        to="/$tenant/$project/tickets/$ticket/edit"
        params={{ ...partition, ticket: String(ticket) }}
        {...anchor}
      />
    ),
  };
}

/** The one primary action that fits the ticket's state, and the menu holding
 * the rest: the other main actions, Edit, Take or Return, and the menu's own. */
export function TicketHeaderActions(
  props: TicketHeaderActionsProps,
): ReactNode {
  const [asking, setAsking] = useState<TicketActionName | undefined>(undefined);
  const text = useCopyText();
  const take = useTicketTake(props.partition, props.ticket, props.take);
  const laid = headerActionsOf(props);
  if (laid === undefined) return null;
  const pressing: TicketHeaderPressing = {
    ticket: props.ticket,
    exits:
      props.offers.offers === "Actions"
        ? props.offers.actions.map((offered) => offered.action)
        : [],
    resume: props.resume,
    busy: props.acting.busy,
    asking,
    onAsking: setAsking,
    onChoose: props.acting.submitting.submit,
  };
  const [primary, ...others] = laid.main;
  return (
    <div className="ticket-header-actions">
      {primary === undefined ? null : (
        <TicketHeaderPrimary pressing={pressing} action={primary} />
      )}
      {laid.duplicate === "Main" ? (
        <TicketDuplicateLink
          partition={props.partition}
          ticket={props.ticket}
        />
      ) : null}
      <TicketHeaderMenu
        partition={props.partition}
        ticket={props.ticket}
        leading={[
          ...others.map((action) =>
            ticketHeaderMenuAction(pressing, action, text),
          ),
          ...(laid.editable
            ? [ticketHeaderEditItem(props.partition, props.ticket, text)]
            : []),
          ...(take.item === undefined ? [] : [take.item]),
        ]}
        revoke={laid.revoke}
        duplicate={laid.duplicate === "Menu"}
        busy={props.acting.busy}
        onChoose={props.acting.submitting.submit}
      />
      {take.refused}
      {laid.main.map((action) => (
        <TicketActionAsk
          key={nativeActionAnswerKey(action)}
          pressing={pressing}
          action={action}
        />
      ))}
    </div>
  );
}

/** What stands in the way of the actions, and the follow of whichever was
 * pressed, wherever it was pressed. */
export function TicketHeaderNotes(props: TicketHeaderActionsProps): ReactNode {
  const text = useCopyText();
  return (
    <div className="ticket-header-notes">
      {props.noRunner ? <NoRunnerLine partition={props.partition} /> : null}
      {props.offers.offers === "Unread" ? (
        <PanelUnready state={props.openState} />
      ) : null}
      {props.dispatchState.state === "Failed" ? (
        <ReadFailed
          subject={text(ticketActionLabel("Dispatch"))}
          failure={props.dispatchState.failure}
        />
      ) : null}
      <FollowNotes submitting={props.acting.submitting} />
    </div>
  );
}

/** The press a ready row's state chip answers, where the row may be dispatched,
 * which asks before anything is sent. */
export interface TicketRowDispatch {
  readonly busy: boolean;
  /** This tab does not reach the network, so a press would not be sent. */
  readonly offline: boolean;
  readonly press: () => void;
}

/** The notes beside a row's Dispatch: that it waits while this tab is
 * offline, and what its follow draws. */
function TicketRowDispatchNotes(props: {
  readonly online: boolean;
  readonly submitting: Submitting;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      {props.online ? null : (
        <Notice
          tone="parked"
          inline
          role="status"
          detail={text({ id: "ticket-dispatch-offline" })}
        />
      )}
      <FollowNotes submitting={props.submitting} />
    </>
  );
}

/** The Dispatch a ready row's reader and runner leave it offering, if any. */
function useRowDispatchOffered(row: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly sequence: number;
  readonly owner: string | undefined;
}): TicketAction | undefined {
  const abilities = useProjectAbilities(row.partition);
  const runner = useWorkRunner(
    row.partition,
    ticketRunnerOwner(row.owner, abilities),
  );
  const { offers } = ticketOffersStartable(
    ticketOffersAllowed(
      {
        offers: "Actions",
        editable: false,
        actions: [manualDispatchAction(row.ticket, row.sequence)],
      },
      abilities,
    ),
    runner,
  );
  return offers.offers === "Actions"
    ? offers.actions.find((action) => action.action === "Dispatch")
    : undefined;
}

/**
 * The Dispatch a ready row of the ticket list offers, expecting the version the
 * row was drawn at, as the press its state chip answers and the notes beside
 * it: that it waits while this tab is offline, and what its follow draws. The
 * reader's abilities and the project's runner take it away as they take it on
 * the ticket page, a press asks the question the ticket page asks, and only its
 * confirm sends the same submission the ticket page would follow.
 */
export function TicketRowDispatchScope(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly sequence: number;
  /** The member the ticket's next execution is placed for, as its read names
   * it, absent where it names none. */
  readonly owner: string | undefined;
  readonly children: (
    dispatch: TicketRowDispatch | undefined,
    notes: ReactNode,
  ) => ReactNode;
}): ReactNode {
  const offered = useRowDispatchOffered(props);
  const online = useApiOnline();
  const text = useCopyText();
  const [asking, setAsking] = useState(false);
  if (offered === undefined) return props.children(undefined, null);
  return (
    <TicketActingScope partition={props.partition} ticket={props.ticket} drawn>
      {(acting) => (
        <>
          {props.children(
            {
              busy: acting.busy,
              offline: !online,
              press: () => {
                setAsking(true);
              },
            },
            <TicketRowDispatchNotes
              online={online}
              submitting={acting.submitting}
            />,
          )}
          <TicketActionConfirm
            title={text({
              id: "ticket-dispatch-confirm-title",
              args: { number: String(props.ticket) },
            })}
            confirm={text(ticketActionLabel("Dispatch"))}
            confirmOffered={!acting.busy && online}
            open={asking}
            onOpenChange={setAsking}
            onConfirm={() => {
              acting.submitting.submit(offered);
            }}
          >
            {text(ticketActionEffect("Dispatch", { kind: "NoPoint" }).effect)}
          </TicketActionConfirm>
        </>
      )}
    </TicketActingScope>
  );
}
