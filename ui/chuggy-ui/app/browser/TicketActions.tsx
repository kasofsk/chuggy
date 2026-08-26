/**
 * The mutations this ticket's phase enables, submitted and followed to
 * settlement.
 *
 * Which buttons exist is `actionsFor`'s decision and this file draws it; what
 * happens after the click is `followOperation`'s, and every step it passes
 * through is drawn as it arrives, so a submission the API is deferring reads as
 * that rather than as a screen doing nothing. The confirmed ticket is written
 * into the cache the page reads, which is what makes it read its own write.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { apiCancelOperation } from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  mutationDeferralSentence,
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "../core/codeSentences.ts";
import type { PanelState } from "../core/freshness.ts";
import { followOperation, ticketConfirmed } from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { actionsFor, ticketActionSentence } from "../core/ticketActions.ts";
import type { TicketAction } from "../core/ticketActions.ts";
import { useApiPorts } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { drawBytes } from "./ports.ts";

export const operationIdBytesCount = 16;

interface Attempt {
  readonly action: TicketAction;
  readonly step: OperationStep;
}

function StepNote(props: { readonly step: OperationStep }): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Submitting":
      return <p className="panel-note">submitting…</p>;
    case "Backlogged":
      return (
        <p className="panel-absent">
          {mutationDeferralSentence(step.code)}; trying again in{" "}
          {step.retryAfterSeconds}s
        </p>
      );
    case "Following":
      return (
        <p className="panel-note">waiting on operation {step.operation}…</p>
      );
    case "Confirming":
      return (
        <p className="panel-note">
          waiting for the project to reach sequence {step.minimumSequence}…
        </p>
      );
    case "Settled":
      return (
        <p
          className={step.state === "Succeeded" ? "panel-note" : "panel-absent"}
        >
          {operationStateSentence(step.state)}
          {step.refusalCode === undefined
            ? ""
            : ` — ${operationRefusalSentence(step.refusalCode)}`}
        </p>
      );
    case "Abandoned":
      return <p className="panel-failed">{step.reason}</p>;
  }
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
    ? "the cancellation was accepted"
    : operationFailureSentence(answered);
}

function ActionButtons(props: {
  readonly actions: readonly TicketAction[];
  readonly busy: boolean;
  readonly onChoose: (action: TicketAction) => void;
}): ReactNode {
  if (props.actions.length === 0)
    return (
      <p className="panel-note">
        no mutation this console can submit is enabled in this phase
      </p>
    );
  return (
    <div className="actions">
      {props.actions.map((action) => (
        <button
          key={action.action}
          type="button"
          disabled={props.busy}
          title={ticketActionSentence(action.action)}
          onClick={() => {
            props.onChoose(action);
          }}
        >
          {action.action.toLowerCase()}
        </button>
      ))}
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
 * this page reads. The confirmed row goes through `ticketConfirmed` rather than
 * over the entry, because it is a narrower projection than the ticket's own
 * read and a live frame may already have written a later one.
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
    const confirmed = followed.ticket;
    if (controller.signal.aborted || confirmed === undefined) return;
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
}): ReactNode {
  const submitting = useSubmitting(props.partition, props.ticket);
  const step = submitting.attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  const busy =
    step !== undefined && step.step !== "Settled" && step.step !== "Abandoned";
  return (
    <Panel title="actions" state={props.state}>
      {(value) => (
        <div className="action-panel">
          <ActionButtons
            actions={actionsFor(value)}
            busy={busy}
            onChoose={submitting.submit}
          />
          {step === undefined ? null : <StepNote step={step} />}
          {pending === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                submitting.cancel(pending);
              }}
            >
              cancel operation
            </button>
          )}
          {submitting.cancelled === undefined ? null : (
            <p className="panel-note">{submitting.cancelled}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
