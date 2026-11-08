/**
 * A new ticket started from another: the creation screen, its form seeded from
 * the named ticket's draft as an edit of it would be, less what a new ticket
 * cannot carry.
 *
 * The draft, the ticket it released and the dependencies it names are read
 * once, as the screen opens,
 * and the form is seeded from what those reads said then: a later read of
 * either redraws nothing under the reader's typing. Submitting is a plain
 * creation, and nothing ties the ticket it makes to the one it started from.
 */

import { useQueries } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { draftQuery, ticketQuery } from "../core/ticketQueries.ts";
import {
  ticketDuplicateRevoked,
  ticketDuplicateSeed,
} from "../core/ticketDuplicate.ts";
import { panelQueryState, usePanelQueryOptions, usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { ticketConfigurationStored } from "./editor/authoringGuards.tsx";
import { CreationForm, CreationScreen } from "./TicketCreation.tsx";
import type { CreationScreenReady } from "./TicketCreation.tsx";

interface DuplicateProps extends CreationScreenReady {
  readonly from: number;
}

/** What a duplicate is seeded from: the draft, and the ticket it released where it released one. */
interface DuplicateReads {
  readonly draft: DraftResponse;
  readonly ticket: TicketResponse | undefined;
}

/** The form, seeded once from the reads it opened on. */
function DuplicateForm(
  props: DuplicateProps &
    DuplicateReads & {
      readonly revoked: readonly number[];
    },
): ReactNode {
  const { context, draft, partition, revoked } = props;
  const [seed] = useState(() =>
    ticketDuplicateSeed({
      draft,
      ticket: props.ticket,
      offers: context.offers,
      bound: context.repositories,
      revoked,
      preferred: ticketConfigurationStored(partition),
      partial: context.partial,
    }),
  );
  return <CreationForm {...props} duplicate={{ from: props.from, seed }} />;
}

/** Each dependency the draft names, read for whether it was revoked. */
function DuplicateDependencies(
  props: DuplicateProps & DuplicateReads,
): ReactNode {
  const { partition } = props;
  const [draft] = useState(props.draft);
  const dependencies = draft.authoring.dependencies;
  const options = usePanelQueryOptions();
  const states = useQueries({
    queries: dependencies.map((dependency) =>
      options(ticketQuery(partition, dependency, "Streamed")),
    ),
    combine: (answers) => answers.map((answer) => panelQueryState(answer)),
  });
  const revoked = ticketDuplicateRevoked(dependencies, states);
  if (revoked === undefined)
    return <PanelUnready state={{ state: "Pending" }} />;
  return <DuplicateForm {...props} draft={draft} revoked={revoked} />;
}

function DuplicateRead(props: DuplicateProps): ReactNode {
  const { from, partition } = props;
  const draftState = usePanelState(draftQuery(partition, from, "Streamed"));
  const ticketState = usePanelState(ticketQuery(partition, from, "Streamed"));
  if (draftState.state !== "Ready") return <PanelUnready state={draftState} />;
  if (ticketState.state === "Pending" || ticketState.state === "Failed")
    return <PanelUnready state={ticketState} />;
  return (
    <DuplicateDependencies
      {...props}
      draft={draftState.value}
      ticket={ticketState.state === "Ready" ? ticketState.value : undefined}
    />
  );
}

export function TicketDuplicate(props: { readonly from: number }): ReactNode {
  return (
    <CreationScreen heading={<DuplicateHeading from={props.from} />}>
      {(ready) => <DuplicateRead {...ready} from={props.from} />}
    </CreationScreen>
  );
}

/** The title of a duplicate, naming the ticket it started from as the way
 * back to it. */
function DuplicateHeading(props: { readonly from: number }): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  const text = useCopyText();
  return (
    <>
      {text({ id: "ticket-authoring-duplicate-heading" })}{" "}
      <Link
        to="/$tenant/$project/tickets/$ticket"
        params={{
          tenant: params.tenant,
          project: params.project,
          ticket: String(props.from),
        }}
      >
        {text({
          id: "ticket-authoring-duplicate-from",
          args: { ticket: String(props.from) },
        })}
      </Link>
    </>
  );
}
