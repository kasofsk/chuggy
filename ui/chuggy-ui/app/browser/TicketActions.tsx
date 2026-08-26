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
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { apiCancelOperation } from "../core/apiRoutes.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "../core/codeSentences.ts";
import type { PanelState } from "../core/freshness.ts";
import { followOperation } from "../core/operationFollow.ts";
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
          the API is deferring this ({step.code}); trying again in{" "}
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
): Promise<string> {
  const answered = await apiCancelOperation(ports, partition, operation);
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

/** A follow that outlived its screen has nowhere to report, so it stops here. */
function useLiving(): { readonly current: boolean } {
  const living = useRef(true);
  useEffect(() => {
    living.current = true;
    return () => {
      living.current = false;
    };
  }, []);
  return living;
}

export function TicketActions(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly state: PanelState<TicketResponse>;
}): ReactNode {
  const ports = useApiPorts();
  const client = useQueryClient();
  const living = useLiving();
  const [attempt, setAttempt] = useState<Attempt | undefined>(undefined);
  const [cancelled, setCancelled] = useState<string | undefined>(undefined);
  const { partition, ticket } = props;

  const submit = async (action: TicketAction): Promise<void> => {
    setCancelled(undefined);
    const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
    const followed = await followOperation(
      ports,
      partition,
      { operation, mutation: action.mutation },
      ticket,
      (step) => {
        if (living.current) setAttempt({ action, step });
      },
    );
    if (followed.ticket !== undefined)
      client.setQueryData(
        projectResourceKey(partition, "Ticket", String(ticket)),
        followed.ticket,
      );
  };

  const step = attempt?.step;
  const pending = step?.step === "Following" ? step.operation : undefined;
  return (
    <Panel title="actions" state={props.state}>
      {(value) => (
        <div className="action-panel">
          <ActionButtons
            actions={actionsFor(value)}
            busy={
              step !== undefined &&
              step.step !== "Settled" &&
              step.step !== "Abandoned"
            }
            onChoose={(action) => {
              void submit(action);
            }}
          />
          {step === undefined ? null : <StepNote step={step} />}
          {pending === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                void cancelOperation(ports, partition, pending).then((said) => {
                  if (living.current) setCancelled(said);
                });
              }}
            >
              cancel operation
            </button>
          )}
          {cancelled === undefined ? null : (
            <p className="panel-note">{cancelled}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
