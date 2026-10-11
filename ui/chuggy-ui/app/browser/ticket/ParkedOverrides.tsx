/**
 * An escalated ticket's overrides on the card that asks about it, closed until
 * asked for: the fields a parked ticket may change, drawn as the form draws
 * them, with one action that saves and the follow of it to settlement.
 *
 * WHAT WAS TYPED AND THE SAVE ARE THE PAGE'S AND NOT THIS PANEL'S, because the
 * Resume beside it is withheld while either says the ticket does not yet hold
 * what was typed. A change settles
 * without journalling anything, so no `Ticket` frame follows it; the ticket is
 * read again once the change is answered, which is what makes what was typed
 * and what is held the same again.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { PublicMutation } from "../../../../../src/contract/requests.ts";
import type {
  NativeActionResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { apiConfiguration } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { operationRefusalLabel } from "../../core/codeLabels.ts";
import { operationRefusalSentence } from "../../core/codeSentences.ts";
import {
  followOperation,
  operationFinished,
  operationIdBytesCount,
} from "../../core/operationFollow.ts";
import type { OperationStep } from "../../core/operationFollow.ts";
import {
  parkedOverrideFields,
  parkedOverridesChange,
  parkedOverridesShown,
  parkedOverridesUnsaved,
} from "../../core/parkedOverrides.ts";
import type { ParkedOverridesTyped } from "../../core/parkedOverrides.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { overrideDocumentOf } from "../../core/ticketOverrides.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { ConfigurationOverrides } from "../ConfigurationOverrides.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";

/** What the save has come to, said on the card. */
function ParkedOverridesNote(props: {
  readonly step: OperationStep | undefined;
  readonly invalid: boolean;
}): ReactNode {
  const step = props.step;
  if (props.invalid)
    return (
      <Notice
        tone="danger"
        inline
        role="alert"
        detail="Not saved · these are not overrides a ticket may hold"
      />
    );
  if (step === undefined) return null;
  if (!operationFinished(step))
    return <Notice tone="live" inline role="status" detail="Saving…" />;
  if (step.step === "Abandoned")
    return (
      <Notice
        tone="danger"
        inline
        role="alert"
        detail={`Not saved · ${step.reason}`}
      />
    );
  if (step.refusal !== undefined)
    return (
      <Notice
        tone="danger"
        inline
        role="alert"
        detail={`Not saved · ${operationRefusalLabel(step.refusal.type)}`}
        more={operationRefusalSentence(step.refusal)}
      />
    );
  return step.state === "Answered" ? (
    <Notice tone="info" inline role="status" detail="Overrides saved" />
  ) : (
    <Notice tone="danger" inline role="alert" detail="Not saved" />
  );
}

/** Where a card's save has got to, and the press that starts one. */
export interface ParkedOverridesSaving {
  readonly step: OperationStep | undefined;
  readonly save: (mutation: PublicMutation) => void;
}

/** Whether a save is still going, which withholds Resume as typing does. */
export function parkedOverridesSaving(saving: ParkedOverridesSaving): boolean {
  return saving.step !== undefined && !operationFinished(saving.step);
}

/** One save at a time, followed to settlement and abandoned with the page. */
export function useParkedOverridesSave(
  partition: PartitionIdentity,
  ticket: number,
): ParkedOverridesSaving {
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
  const save = (mutation: PublicMutation): void => {
    running.current?.abort(new Error("another save took this card"));
    const controller = new AbortController();
    running.current = controller;
    const operation = base64urlFromBytes(drawBytes(operationIdBytesCount));
    const report = (next: OperationStep): void => {
      if (!controller.signal.aborted) setStep(next);
    };
    void followOperation(
      ports,
      partition,
      { operation, mutation },
      ticket,
      report,
      controller.signal,
    )
      .then((followed) => {
        if (controller.signal.aborted) return;
        if (followed.step.step === "Settled")
          void client.invalidateQueries({
            queryKey: projectResourceKey(partition, "Ticket", String(ticket)),
            exact: true,
          });
      })
      .catch((thrown: unknown) => {
        report({
          step: "Abandoned",
          reason: thrown instanceof Error ? thrown.message : "the save failed",
          refused: false,
        });
      });
  };
  return { step, save };
}

/** The panel, once the configuration the ticket pins has been read. */
function ParkedOverridesEdit(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly fence: NativeActionResponse;
  readonly canonical: string;
  readonly typed: ParkedOverridesTyped | undefined;
  readonly onTyped: (typed: ParkedOverridesTyped | undefined) => void;
  readonly saving: ParkedOverridesSaving;
}): ReactNode {
  const { fence, ticket, typed, onTyped, saving } = props;
  const document = useMemo(
    () => overrideDocumentOf(props.canonical),
    [props.canonical],
  );
  const [invalid, setInvalid] = useState(false);
  const shown = parkedOverridesShown(typed, fence, ticket.overrides);
  const unsaved = parkedOverridesUnsaved(typed, fence, ticket.overrides);
  const busy = parkedOverridesSaving(saving);
  const refused = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "mutate",
  );
  return (
    <div className="grid gap-2">
      <ConfigurationOverrides
        document={document}
        overrides={shown}
        fields={parkedOverrideFields}
        onChange={(overrides) => {
          setInvalid(false);
          onTyped({ action: fence.action, overrides });
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {refused ? null : (
          <Button
            size="sm"
            disabled={!unsaved || busy}
            onClick={() => {
              const change = parkedOverridesChange(ticket, fence, shown);
              if (change.change === "Invalid") {
                setInvalid(true);
                return;
              }
              saving.save(change.mutation);
            }}
          >
            Save overrides
          </Button>
        )}
        {unsaved && !busy && !refused ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setInvalid(false);
              onTyped(undefined);
            }}
          >
            Discard
          </Button>
        ) : null}
        <ParkedOverridesNote step={saving.step} invalid={invalid} />
      </div>
    </div>
  );
}

export function ParkedOverrides(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly fence: NativeActionResponse;
  readonly typed: ParkedOverridesTyped | undefined;
  readonly onTyped: (typed: ParkedOverridesTyped | undefined) => void;
  readonly saving: ParkedOverridesSaving;
}): ReactNode {
  const revision = props.ticket.configurationRevision ?? "";
  const state = usePanelResource(
    props.partition,
    "Configuration",
    revision,
    (ports) => apiConfiguration(ports, props.partition, revision),
  );
  if (revision === "") return null;
  return (
    <Panel title="Overrides" collapsible={{ open: false }}>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <ParkedOverridesEdit {...props} canonical={state.value.canonical} />
      ) : null}
    </Panel>
  );
}
