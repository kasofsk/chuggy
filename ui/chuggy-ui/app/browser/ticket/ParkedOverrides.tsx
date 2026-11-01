/**
 * An escalated ticket's overrides on the card that asks about it, closed until
 * asked for or a save of them is out: the fields a parked ticket may change,
 * drawn as the form draws them, with one action that saves and the follow of
 * it to settlement.
 *
 * WHAT WAS TYPED AND THE SAVE ARE THE PAGE'S AND NOT THIS PANEL'S, because the
 * Resume beside it is withheld while either says the ticket does not yet hold
 * what was typed. A change settles
 * without journalling anything, so no `Ticket` frame follows it; the ticket is
 * read again once the change is answered, which is what makes what was typed
 * and what is held the same again.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { PublicMutation } from "../../../../../src/contract/requests.ts";
import type {
  NativeActionResponse,
  TicketResponse,
} from "../../../../../src/contract/responses.ts";
import { configurationQuery } from "../../core/configurationQueries.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import {
  operationFailureSentence,
  operationRefusalSentence,
} from "../../core/codeSentences.ts";
import {
  ConsoleWriteProgress,
  ConsoleWriteRefused,
  consoleWriteKey,
} from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  operationFinished,
  operationIdBytesCount,
  operationSubmitting,
} from "../../core/operationFollow.ts";
import type { OperationStep } from "../../core/operationFollow.ts";
import { followOperationProgressed } from "../../core/operationProgress.ts";
import {
  parkedOverrideFields,
  parkedOverridesChange,
  parkedOverridesRefusal,
  parkedOverridesShown,
  parkedOverridesUnsaved,
} from "../../core/parkedOverrides.ts";
import type { ParkedOverridesTyped } from "../../core/parkedOverrides.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { ticketQuery } from "../../core/ticketQueries.ts";
import { overrideDocumentOf } from "../../core/ticketOverrides.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "../consoleWrite.tsx";
import { ConfigurationOverrides } from "../ConfigurationOverrides.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";

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
  const refused = parkedOverridesRefusal(step);
  if (refused === undefined)
    return <Notice tone="info" inline role="status" detail="Overrides saved" />;
  const refusal = step.step === "Settled" ? step.refusal : undefined;
  return (
    <Notice
      tone="danger"
      inline
      role="alert"
      detail={refused}
      {...(refusal === undefined
        ? {}
        : { more: operationRefusalSentence(refusal) })}
    />
  );
}

/** Where a card's save has got to, whether it is still going until the ticket
 * it changed has been read again, which withholds Resume as typing does, and
 * the press that starts one. */
export interface ParkedOverridesSaving {
  readonly step: OperationStep | undefined;
  readonly busy: boolean;
  readonly save: (mutation: PublicMutation) => void;
}

/** One press of Save: the change, the identity it drew, and where its follow
 * reports. */
interface ParkedOverridesPressed {
  readonly mutation: PublicMutation;
  readonly operation: string;
  readonly progress: ConsoleWriteProgress<OperationStep>;
}

/** A save followed to settlement, over only once a settled one's ticket has
 * been read again; every ending but an answered change is its refusal. */
function parkedOverridesWrite(
  partition: PartitionIdentity,
  ticket: number,
): ConsoleWrite<ParkedOverridesPressed, OperationStep> {
  const reread = (client: QueryClient): Promise<void> =>
    client.invalidateQueries({
      queryKey: ticketQuery(partition, ticket).queryKey,
      exact: true,
    });
  return {
    mutationKey: consoleWriteKey(
      "parked-overrides",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: async (ports, pressed, client) => {
      const step = await followOperationProgressed(
        ports,
        partition,
        { operation: pressed.operation, mutation: pressed.mutation },
        ticket,
        pressed.progress,
        "the save failed",
      );
      const refused = parkedOverridesRefusal(step);
      if (refused === undefined) return { outcome: "Ok", value: step };
      if (step.step === "Settled") await reread(client);
      throw new ConsoleWriteRefused(refused);
    },
    refusal: (failure) => `Not saved · ${operationFailureSentence(failure)}`,
    landed: (client) => reread(client),
  };
}

/** One save at a time, followed to settlement whether or not the card that
 * pressed it is still drawn; its refusal is the card's where the card is. */
export function useParkedOverridesSave(
  partition: PartitionIdentity,
  ticket: number,
  drawn: boolean,
): ParkedOverridesSaving {
  const writing = useConsoleWrite(parkedOverridesWrite(partition, ticket), {
    drawn,
  });
  const step = useConsoleWriteProgress(writing.variables?.progress);
  return {
    step: step ?? (writing.isPending ? operationSubmitting() : undefined),
    busy: writing.isPending,
    save: (mutation) => {
      writing.mutate({
        mutation,
        operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
        progress: new ConsoleWriteProgress<OperationStep>(),
      });
    },
  };
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
  const busy = saving.busy;
  const refused = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "overrideTicketConfig",
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

/** A parked ticket's overrides, drawn for none whose configuration is a catalog, which takes none. */
export function ParkedOverrides(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly fence: NativeActionResponse;
  readonly typed: ParkedOverridesTyped | undefined;
  readonly onTyped: (typed: ParkedOverridesTyped | undefined) => void;
  readonly saving: ParkedOverridesSaving;
}): ReactNode {
  const revision = props.ticket.configurationRevision ?? "";
  const state = usePanelState(configurationQuery(props.partition, revision));
  if (revision === "") return null;
  if (
    state.state === "Ready" &&
    configurationCatalogOf(state.value.canonical) !== undefined
  )
    return null;
  return (
    <Panel
      title="Overrides"
      collapsible={{ open: props.saving.step !== undefined }}
    >
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <ParkedOverridesEdit {...props} canonical={state.value.canonical} />
      ) : null}
    </Panel>
  );
}
