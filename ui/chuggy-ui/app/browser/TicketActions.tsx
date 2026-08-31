/**
 * The mutations this ticket's phase enables, submitted and followed to
 * settlement.
 *
 * Which buttons exist is a decision the core makes twice over: an open native
 * action offers exactly the answers it admits, and where the ticket has none
 * the phase alone says what `actionsFor` enables. What happens after the click
 * is `followOperation`'s, and every step it passes through is drawn as it
 * arrives, so a submission the API is deferring reads as that rather than as a
 * screen doing nothing. The confirmed ticket is written into the cache the page
 * reads, which is what makes it read its own write.
 *
 * AN ANSWERED QUESTION IS RE-READ RATHER THAN ASSUMED GONE. Answering an
 * approval settles without journalling anything, so no `Ticket` frame follows
 * it; the open actions are read again once the follow ends, and the live
 * `NativeAction` frame empties them wherever the stream is carrying changes.
 */

import { useQueryClient } from "@tanstack/react-query";
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
import type { ReworkStanding } from "../core/codeLabels.ts";
import type { ResumeConsequence } from "../core/resumePoint.ts";
import type { PanelState } from "../core/freshness.ts";
import { nativeActionsAnswers } from "../core/nativeActionAnswers.ts";
import {
  followOperation,
  operationIdBytesCount,
  ticketConfirmed,
} from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import {
  actionsFor,
  manualDispatchAction,
  ticketDispatchList,
} from "../core/ticketActions.ts";
import type { TicketAction } from "../core/ticketActions.ts";
import { useApiPorts } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { drawBytes } from "./ports.ts";
import { ActionWithCost } from "./ui/ActionWithCost.tsx";
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

async function cancelOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const answered = await apiCancelOperation(
    ports,
    partition,
    operation,
    signal,
  );
  return answered.outcome === "Ok"
    ? "Cancellation accepted"
    : operationFailureLabel(answered);
}

/** What the machine charges for and what it undoes, said before it is pressed. */
function ActionButtons(props: {
  readonly actions: readonly TicketAction[];
  readonly busy: boolean;
  readonly resume: ResumeConsequence | undefined;
  readonly rework: ReworkStanding | undefined;
  readonly onChoose: (action: TicketAction) => void;
}): ReactNode {
  if (props.actions.length === 0)
    return <p className="empty">No action in this phase</p>;
  return (
    <div className="actions">
      {props.actions.map((action) => {
        const effect = ticketActionEffect(
          action.action,
          props.resume,
          props.rework,
        );
        return (
          <ActionWithCost
            key={action.action}
            action={action.action}
            effect={effect.effect}
            cost={effect.cost}
            {...(effect.more === undefined ? {} : { more: effect.more })}
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

interface Submitting {
  readonly attempt: Attempt | undefined;
  readonly cancelled: string | undefined;
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
 */
function useSubmitting(
  partition: PartitionIdentity,
  ticket: number,
): Submitting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const runningRef = useAbandonOnUnmount();
  const [attempt, setAttempt] = useState<Attempt | undefined>(undefined);
  const [cancelled, setCancelled] = useState<string | undefined>(undefined);
  const key = projectResourceKey(partition, "Ticket", String(ticket));
  const openKey = projectResourceKey(partition, "NativeAction", String(ticket));
  const dispatchKey = ticketDispatchList(partition, ticket).key;

  const follow = async (action: TicketAction): Promise<void> => {
    setCancelled(undefined);
    const controller = new AbortController();
    runningRef.current = controller;
    const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
    const followed = await followOperation(
      ports,
      partition,
      { operation, mutation: action.mutation },
      ticket,
      (step) => {
        if (!controller.signal.aborted) setAttempt({ action, step });
      },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    void client.invalidateQueries({ queryKey: openKey, exact: true });
    void client.invalidateQueries({ queryKey: dispatchKey, exact: true });
    const confirmed = followed.ticket;
    if (confirmed === undefined) return;
    client.setQueryData(key, (held: TicketResponse | undefined) =>
      ticketConfirmed(held, confirmed),
    );
  };

  return {
    attempt,
    cancelled,
    submit: (action) => {
      void follow(action);
    },
    cancel: (operation) => {
      const controller = runningRef.current;
      void cancelOperation(
        ports,
        partition,
        operation,
        controller?.signal,
      ).then((said) => {
        if (controller?.signal.aborted !== true) setCancelled(said);
      });
    },
  };
}

export function TicketActions(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly state: PanelState<TicketResponse>;
  readonly openState: PanelState<TicketNativeActionsResponse>;
  readonly dispatchState: PanelState<DispatchViewResponse>;
  readonly resume?: ResumeConsequence;
  readonly rework?: ReworkStanding;
}): ReactNode {
  const submitting = useSubmitting(props.partition, props.ticket);
  const step = submitting.attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  const busy =
    step !== undefined && step.step !== "Settled" && step.step !== "Abandoned";
  const open =
    props.openState.state === "Ready" ? props.openState.value.actions : [];
  const dispatch =
    props.dispatchState.state === "Ready"
      ? manualDispatchAction(props.ticket, props.dispatchState.value)
      : undefined;
  return (
    <DataPanel title="Actions" state={props.state}>
      {(value) => (
        <div className="action-panel">
          <ActionButtons
            actions={
              open.length === 0
                ? [
                    ...(dispatch === undefined ? [] : [dispatch]),
                    ...actionsFor(value),
                  ]
                : nativeActionsAnswers(open)
            }
            busy={busy}
            resume={props.resume}
            rework={props.rework}
            onChoose={submitting.submit}
          />
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
          {submitting.cancelled === undefined ? null : (
            <Notice tone="info" inline detail={submitting.cancelled} />
          )}
        </div>
      )}
    </DataPanel>
  );
}
