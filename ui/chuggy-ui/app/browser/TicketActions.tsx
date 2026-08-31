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
import type { ResumeOffer, ReworkStanding } from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  followOperation,
  operationFinished,
  operationFollowing,
  operationIdBytesCount,
  operationSubmitting,
  ticketConfirmed,
} from "../core/operationFollow.ts";
import type {
  OperationFollowed,
  OperationStep,
} from "../core/operationFollow.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import {
  manualDispatchAction,
  ticketAttemptHeldMsMax,
  ticketAttemptKey,
  ticketDispatchList,
} from "../core/ticketActions.ts";
import type { TicketAction, TicketAttempt } from "../core/ticketActions.ts";
import { ticketOffers } from "../core/ticketOffers.ts";
import { useApiPorts } from "./api.ts";
import { DataPanel, PanelUnready } from "./DataPanel.tsx";
import { drawBytes } from "./ports.ts";
import { ActionWithCost } from "./ui/ActionWithCost.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
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
 * panel left busy with nothing said.
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
  client.setQueryData(
    projectResourceKey(partition, "Ticket", String(ticket)),
    (held: TicketResponse | undefined) => ticketConfirmed(held, confirmed),
  );
}

/**
 * What a step does to the record a remount picks the attempt back up from: a
 * `Following` step names the operation the API accepted, and a finished follow
 * leaves nothing to pick up. The entry is read by no query of its own, so how
 * long it survives is set here rather than left to a default this console never
 * chose.
 */
function attemptRecorded(
  client: QueryClient,
  key: ProjectQueryKey,
  action: TicketAction,
  step: OperationStep,
): void {
  if (step.step === "Following") {
    client.setQueryDefaults(key, { gcTime: ticketAttemptHeldMsMax });
    client.setQueryData<TicketAttempt>(key, {
      action,
      operation: step.operation,
    });
    return;
  }
  if (operationFinished(step))
    client.removeQueries({ queryKey: key, exact: true });
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
        reason: faultReason(thrown),
      });
  }
}

/** What the machine charges for and what it undoes, said before it is pressed. */
function ActionButtons(props: {
  readonly actions: readonly TicketAction[];
  readonly busy: boolean;
  readonly resume: ResumeOffer;
  readonly rework: ReworkStanding | undefined;
  readonly onChoose: (action: TicketAction) => void;
}): ReactNode {
  if (props.actions.length === 0)
    return <EmptyState label="No action in this phase" />;
  return (
    <div className="actions">
      {props.actions.map((action) => {
        const effect = ticketActionEffect(
          action.action,
          props.resume,
          props.rework,
          props.actions.map((offered) => offered.action),
        );
        return (
          <ActionWithCost
            key={action.action}
            action={action.action}
            effect={effect.effect}
            {...(effect.cost === undefined ? {} : { cost: effect.cost })}
            {...(effect.more === undefined ? {} : { more: effect.more })}
            {...(effect.refusedBecause === undefined
              ? {}
              : { refusedBecause: effect.refusedBecause })}
            offered={effect.offered}
            busy={props.busy}
            danger={action.action === "Revoke" || action.action === "Abandon"}
            onChoose={() => {
              props.onChoose(action);
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * A follow is abandoned with the screen that asked for it: the controller this
 * holds aborts the requests still in flight and the waits between them, and its
 * signal is what stops anything being reported afterwards.
 */
function useAbandonOnUnmount(): RefObject<AbortController | undefined> {
  const runningRef = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      runningRef.current?.abort(
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
 * waiting. A refused one is not: the operation is still the actor's, and the
 * follow goes on watching it.
 */
function attemptCancelled(
  operation: string,
): (held: Attempt | undefined) => Attempt | undefined {
  return (held) =>
    held === undefined
      ? held
      : {
          action: held.action,
          step: {
            step: "Settled",
            operation,
            state: "Cancelled",
            refusalCode: undefined,
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
 * this page reads. The confirmed row goes through `ticketConfirmed` because it
 * is a narrower projection than the ticket's own read and a live frame may
 * already have written a later one, and the open actions are invalidated rather
 * than written because what the follow learned is that the question was
 * answered and not what is open now.
 *
 * AN ATTEMPT OUTLIVES THE PANEL THAT MADE IT. The accepted operation is written
 * to the cache as the follow reaches it, so a panel that unmounts mid-follow —
 * which this page does whenever the situation column has read enough to change
 * shape — is picked up again on mount rather than replaced by a fresh button
 * offering the same submission a second time. The record is dropped where the
 * follow finishes, which is the only state there is nothing left to pick up.
 */
function useSubmitting(
  partition: PartitionIdentity,
  ticket: number,
): Submitting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const runningRef = useAbandonOnUnmount();
  const attemptKey = ticketAttemptKey(partition, ticket);
  const [attempt, setAttempt] = useState<Attempt | undefined>(() =>
    attemptHeld(client.getQueryData<TicketAttempt>(attemptKey)),
  );
  const [refused, setRefused] = useState<string | undefined>(undefined);

  const drawStep = (action: TicketAction, step: OperationStep): void => {
    setAttempt({ action, step });
    if (operationFinished(step)) setRefused(undefined);
    attemptRecorded(client, attemptKey, action, step);
  };

  const follow = (held: TicketAttempt, startedFrom: OperationStep): void => {
    const controller = new AbortController();
    runningRef.current = controller;
    void followInto(
      { ports, partition, ticket, client, drawStep },
      held,
      startedFrom,
      controller,
    );
  };

  /**
   * What it aborts is whatever is running when the answer arrives, and not what
   * was running when the button was pressed: the seeded attempt is drawn before
   * the pick-up has made its controller, so a Cancel in that first paint has
   * none to carry, and aborting the one it found would abort nothing while the
   * pick-up polled on. The abort precedes the removal so that the follow cannot
   * write the record back between them.
   */
  const cancel = async (operation: string): Promise<void> => {
    const asked = runningRef.current;
    const answered = await cancelOperation(
      ports,
      partition,
      operation,
      asked?.signal,
    );
    if (asked?.signal.aborted === true) return;
    if (!answered.accepted) {
      setRefused(answered.said);
      return;
    }
    runningRef.current?.abort(new Error(attemptCancelledReason));
    setAttempt(attemptCancelled(operation));
    setRefused(undefined);
    client.removeQueries({ queryKey: attemptKey, exact: true });
  };

  useEffect(() => {
    const held = client.getQueryData<TicketAttempt>(attemptKey);
    if (held !== undefined) follow(held, operationFollowing(held.operation));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pick-up is this mount's, and a later render must not follow the same operation twice
  }, []);

  return {
    attempt,
    refused,
    submit: (action) => {
      setRefused(undefined);
      const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
      follow({ action, operation }, operationSubmitting());
    },
    cancel: (operation) => {
      void cancel(operation);
    },
  };
}

export interface TicketActionsProps {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly state: PanelState<TicketResponse>;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
  readonly resume: ResumeOffer;
  readonly rework?: ReworkStanding;
}

function TicketActionsPanel(props: TicketActionsProps): ReactNode {
  const submitting = useSubmitting(props.partition, props.ticket);
  const step = submitting.attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  const busy = step !== undefined && !operationFinished(step);
  const dispatch =
    props.dispatchState.state === "Ready"
      ? manualDispatchAction(props.ticket, props.dispatchState.value)
      : undefined;
  return (
    <DataPanel title="Actions" state={props.state}>
      {(value) => {
        const offers = ticketOffers(props.openState, value, dispatch);
        return (
          <div className="action-panel">
            {offers.offers === "Unread" ? (
              <PanelUnready state={props.openState} />
            ) : (
              <ActionButtons
                actions={offers.actions}
                busy={busy}
                resume={props.resume}
                rework={props.rework}
                onChoose={submitting.submit}
              />
            )}
            {props.dispatchState.state === "Failed" ? (
              <Notice
                tone="parked"
                inline
                detail={`Dispatch unavailable · ${props.dispatchState.reason}`}
              />
            ) : null}
            {step === undefined || submitting.attempt === undefined ? null : (
              <StepNote step={step} action={submitting.attempt.action} />
            )}
            {pending === undefined ? null : (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  submitting.cancel(pending);
                }}
              >
                Cancel
              </Button>
            )}
            {submitting.refused === undefined ? null : (
              <Notice
                tone="danger"
                inline
                detail={`Cancel refused · ${submitting.refused}`}
              />
            )}
          </div>
        );
      }}
    </DataPanel>
  );
}

/**
 * The panel, keyed by the ticket it is about, which is what makes the pick-up
 * above per ticket rather than per mount and is why its effect names no
 * dependency. `ticketRoute` carries no key of its own, so a reader moving
 * between tickets is drawn by one instance, and everything the panel holds is
 * about the ticket it started on.
 */
export function TicketActions(props: TicketActionsProps): ReactNode {
  const { tenant, project } = props.partition;
  return (
    <TicketActionsPanel
      key={`${tenant}/${project}/${String(props.ticket)}`}
      {...props}
    />
  );
}
