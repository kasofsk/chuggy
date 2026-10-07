/**
 * A parked ticket's overrides on the card that asks about it: closed until
 * asked for, drawn as the new-ticket form draws them over the fields a parked
 * ticket may change, and saved by one press that is followed to settlement.
 *
 * WHAT IS TYPED OUTLIVES A REFUSAL. A change the actor refused is drawn beside
 * the fields still holding it, so the reader corrects what they typed rather
 * than typing it again. A saved change is written into the ticket the page
 * reads, which is what the configuration panel and the card seed from.
 *
 * RESUME WAITS FOR A SAVE. `useParkedOverrides` is held by the page so the
 * card's Resume can say it is waiting while a change is typed and unsaved, and
 * nobody resumes under settings they believed they had changed.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { apiConfiguration } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { operationRefusalSentence } from "../../core/codeSentences.ts";
import {
  followOperation,
  operationFinished,
  operationIdBytesCount,
  operationSubmitting,
} from "../../core/operationFollow.ts";
import type { OperationStep } from "../../core/operationFollow.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import {
  parkedOverrideFieldsDrawn,
  parkedOverridesMutation,
  parkedOverridesSeed,
  parkedOverridesUnsaved,
} from "../../core/ticketParkedOverrides.ts";
import type {
  ParkedOverridesFence,
  ParkedOverridesMutation,
} from "../../core/ticketParkedOverrides.ts";
import { overrideDocumentOf } from "../../core/ticketOverrides.ts";
import type { CreationOverrides } from "../../core/ticketOverrides.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { ConfigurationOverrides } from "../ConfigurationOverrides.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";

/** What a parked ticket's card holds of its overrides, and whether it is unsaved. */
export interface ParkedOverridesHeld {
  readonly held: CreationOverrides;
  readonly unsaved: boolean;
  readonly onChange: (held: CreationOverrides | undefined) => void;
}

/** The card's overrides, as the ticket holds them until something is typed. */
export function useParkedOverrides(
  ticket: TicketResponse | undefined,
): ParkedOverridesHeld {
  const [typed, setTyped] = useState<CreationOverrides | undefined>(undefined);
  const seed = ticket === undefined ? {} : parkedOverridesSeed(ticket);
  return {
    held: typed ?? seed,
    unsaved:
      ticket !== undefined &&
      typed !== undefined &&
      parkedOverridesUnsaved(ticket, typed),
    onChange: setTyped,
  };
}

/** Where a save has got to, as one line. */
function SaveNote(props: { readonly step: OperationStep }): ReactNode {
  const step = props.step;
  switch (step.step) {
    case "Submitting":
    case "Backlogged":
    case "Following":
    case "Confirming":
      return <Notice tone="live" inline role="status" detail="Saving…" />;
    case "Settled":
      if (step.state === "Answered")
        return (
          <Notice tone="info" inline role="status" detail="Overrides saved" />
        );
      return (
        <Notice
          tone="danger"
          inline
          role="alert"
          detail={`Not saved · ${
            step.refusal === undefined
              ? step.state.toLowerCase()
              : operationRefusalSentence(step.refusal)
          }`}
        />
      );
    case "Abandoned":
      return (
        <Notice
          tone="danger"
          inline
          role="alert"
          detail={`Not saved · ${step.reason}`}
        />
      );
  }
}

/** What a saved change wrote, put into the ticket the page reads and read again behind it. */
function parkedOverridesWritten(
  client: QueryClient,
  partition: PartitionIdentity,
  ticket: number,
  sent: ParkedOverridesMutation["overrides"],
): void {
  const key = projectResourceKey(partition, "Ticket", String(ticket));
  client.setQueryData<TicketResponse>(key, (read) => {
    if (read === undefined) return read;
    const written: TicketResponse = { ...read };
    delete written.overrides;
    return Object.keys(sent).length === 0
      ? written
      : { ...written, overrides: sent };
  });
  void client.invalidateQueries({ queryKey: key, exact: true });
}

/** One save, followed to settlement and written into the ticket the page reads. */
function useParkedOverridesSave(
  partition: PartitionIdentity,
  ticket: TicketResponse,
  fence: ParkedOverridesFence,
  parked: ParkedOverridesHeld,
): {
  readonly step: OperationStep | undefined;
  readonly save: (() => void) | undefined;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [step, setStep] = useState<OperationStep | undefined>(undefined);
  const running = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      running.current?.abort(new Error("the card that saved this is gone"));
    },
    [],
  );
  const mutation = parkedOverridesMutation(ticket, fence, parked.held);
  const saving = step !== undefined && !operationFinished(step);
  if (mutation === undefined || saving || !parked.unsaved)
    return { step, save: undefined };
  const sent = mutation.overrides;
  const run = async (): Promise<void> => {
    const controller = new AbortController();
    running.current = controller;
    const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
    try {
      const followed = await followOperation(
        ports,
        partition,
        { operation, mutation },
        ticket.ticket,
        (next) => {
          if (!controller.signal.aborted) setStep(next);
        },
        controller.signal,
        operationSubmitting(),
      );
      if (controller.signal.aborted) return;
      if (
        followed.step.step !== "Settled" ||
        followed.step.state !== "Answered"
      )
        return;
      parked.onChange(undefined);
      parkedOverridesWritten(client, partition, ticket.ticket, sent);
    } catch (thrown: unknown) {
      if (!controller.signal.aborted)
        setStep({
          step: "Abandoned",
          reason: thrown instanceof Error ? thrown.message : "the save failed",
          refused: false,
        });
    }
  };
  return {
    step,
    save: () => {
      void run();
    },
  };
}

function ParkedOverridesFields(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly fence: ParkedOverridesFence;
  readonly parked: ParkedOverridesHeld;
  readonly revision: string;
}): ReactNode {
  const { partition, revision, parked } = props;
  const state = usePanelResource(
    partition,
    "Configuration",
    revision,
    (ports) => apiConfiguration(ports, partition, revision),
  );
  const saving = useParkedOverridesSave(
    partition,
    props.ticket,
    props.fence,
    parked,
  );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <div className="grid gap-2">
      <ConfigurationOverrides
        document={overrideDocumentOf(state.value.canonical)}
        overrides={parked.held}
        fields={parkedOverrideFieldsDrawn}
        onChange={parked.onChange}
      />
      <div className="ticket-card-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={saving.save === undefined}
          onClick={() => {
            saving.save?.();
          }}
        >
          Save overrides
        </Button>
        {parked.unsaved ? (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              parked.onChange(undefined);
            }}
          >
            Discard
          </Button>
        ) : null}
      </div>
      {saving.step === undefined ? null : <SaveNote step={saving.step} />}
    </div>
  );
}

/** The card's overrides, closed until asked for, for a ticket whose resume starts a worker. */
export function TicketParkedOverrides(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly fence: ParkedOverridesFence;
  readonly parked: ParkedOverridesHeld;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const revision = props.ticket.configurationRevision;
  if (revision === undefined) return null;
  return (
    <div className="grid gap-2">
      <div>
        <Button
          variant="quiet"
          size="sm"
          expanded={open}
          onClick={() => {
            setOpen((held) => !held);
          }}
        >
          {open ? "Hide overrides" : "Change overrides before resuming"}
        </Button>
      </div>
      {open || props.parked.unsaved ? (
        <ParkedOverridesFields {...props} revision={revision} />
      ) : null}
    </div>
  );
}
