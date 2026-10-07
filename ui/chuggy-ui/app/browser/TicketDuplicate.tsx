/**
 * A new ticket started from another: the creation screen, its form seeded from
 * the named ticket's draft as an edit of it would be, less what a new ticket
 * cannot carry.
 *
 * The draft and the dependencies it names are read once, as the screen opens,
 * and the form is seeded from what those reads said then: a later read of
 * either redraws nothing under the reader's typing. Submitting is a plain
 * creation, and nothing ties the ticket it makes to the one it started from.
 */

import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { DraftResponse } from "../../../../src/contract/responses.ts";
import { apiDraft, apiTicket } from "../core/apiRoutes.ts";
import {
  ticketDuplicateRevoked,
  ticketDuplicateSeed,
} from "../core/ticketDuplicate.ts";
import { usePanelResource, usePanelResources } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { ticketConfigurationStored } from "./editor/authoringGuards.tsx";
import {
  CreationForm,
  CreationScreen,
  TicketCreation,
} from "./TicketCreation.tsx";
import type { CreationScreenReady } from "./TicketCreation.tsx";

interface DuplicateProps extends CreationScreenReady {
  readonly from: number;
}

/** The form, seeded once from the reads it opened on. */
function DuplicateForm(
  props: DuplicateProps & {
    readonly draft: DraftResponse;
    readonly revoked: readonly number[];
  },
): ReactNode {
  const { context, draft, partition, revoked } = props;
  const [seed] = useState(() =>
    ticketDuplicateSeed({
      draft,
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
  props: DuplicateProps & { readonly draft: DraftResponse },
): ReactNode {
  const { partition } = props;
  const [draft] = useState(props.draft);
  const dependencies = draft.authoring.dependencies;
  const states = usePanelResources(
    partition,
    "Ticket",
    dependencies.map(String),
    (resource, readPorts) => apiTicket(readPorts, partition, Number(resource)),
  );
  const revoked = ticketDuplicateRevoked(dependencies, states);
  if (revoked === undefined)
    return <PanelUnready state={{ state: "Pending" }} />;
  return <DuplicateForm {...props} draft={draft} revoked={revoked} />;
}

function DuplicateRead(props: DuplicateProps): ReactNode {
  const { from, partition } = props;
  const draftState = usePanelResource(
    partition,
    "Draft",
    String(from),
    (readPorts) => apiDraft(readPorts, partition, from),
  );
  if (draftState.state !== "Ready") return <PanelUnready state={draftState} />;
  return <DuplicateDependencies {...props} draft={draftState.value} />;
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
  return (
    <>
      New ticket from{" "}
      <Link
        to="/$tenant/$project/tickets/$ticket"
        params={{
          tenant: params.tenant,
          project: params.project,
          ticket: String(props.from),
        }}
      >
        ticket {props.from}
      </Link>
    </>
  );
}

/**
 * A new ticket, or one started from the ticket the address names. Each is
 * keyed by where it starts, because a change of search alone keeps a route's
 * component and the form it holds.
 */
export function TicketCreationFrom(props: {
  readonly from: number | undefined;
}): ReactNode {
  return props.from === undefined ? (
    <TicketCreation key="new" />
  ) : (
    <TicketDuplicate key={props.from} from={props.from} />
  );
}
