/**
 * What the ticket is, beside where it stands: the live revision and when it
 * released, who filed it, what it waits on, and where its work happens and
 * lands. Every cell is the live revision's, which a draft may have been
 * revised past.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../../src/contract/rosters.ts";
import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import { agoFigure } from "../../core/figures.ts";
import { creatorLabel } from "../../core/labels.ts";
import { repositoryLabel } from "../../core/projectRepositories.ts";
import { useCreatorEmails } from "../creatorEmails.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import {
  TicketDependencyChip,
  dependencyStandingOf,
} from "./TicketStateChip.tsx";

import "./ticket.css";

/** The member who filed the ticket, drawn only where the wire names one. */
export function TicketFiledBy(props: {
  readonly partition: PartitionIdentity;
  readonly creator: string | undefined;
}): ReactNode {
  const emails = useCreatorEmails(props.partition);
  if (props.creator === undefined) return <span className="fig-dim">—</span>;
  return <Identity label={creatorLabel(props.creator, emails)} />;
}

/** The live revision and, where the wire says when, how long ago it released. */
export function TicketLiveRevision(props: {
  readonly ticket: TicketResponse;
  readonly nowMs: number;
}): ReactNode {
  const { ticket } = props;
  return (
    <>
      Revision {String(ticket.revision)}
      {ticket.releasedAt === undefined ? null : (
        <span className="fig-dim">
          {" "}
          · released{" "}
          <Figure figure={agoFigure(ticket.releasedAt, props.nowMs)} />
        </span>
      )}
    </>
  );
}

/** Each dependency as a chip in the state it stands in, the list's colours. */
function TicketDependencies(props: {
  readonly ticket: TicketResponse;
}): ReactNode {
  const { ticket } = props;
  const dependencies = ticket.dependencies ?? [];
  if (dependencies.length === 0) return "None";
  return (
    <span className="ticket-dependencies">
      {dependencies.map((number) => (
        <TicketDependencyChip
          key={number}
          ticket={number}
          standing={dependencyStandingOf(dependencyPhase(ticket, number))}
        />
      ))}
    </span>
  );
}

function dependencyPhase(ticket: TicketResponse, number: number): TicketPhase {
  if (ticket.revokedDependencies.includes(number)) return "Revoked";
  return (
    ticket.openDependencies.find((open) => open.ticket === number)?.phase ??
    "Done"
  );
}

export function TicketMeta(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
  readonly nowMs: number;
}): ReactNode {
  const { ticket } = props;
  const repository = ticket.brief?.repository;
  return (
    <div className="ticket-status-meta">
      <Fields>
        <Field name="Revision">
          <TicketLiveRevision ticket={ticket} nowMs={props.nowMs} />
        </Field>
        <Field name="Filed by" absent={ticket.creator === undefined}>
          <TicketFiledBy partition={props.partition} creator={ticket.creator} />
        </Field>
        <Field name="Dependencies">
          <TicketDependencies ticket={ticket} />
        </Field>
        <Field name="Repository" absent={repository === undefined}>
          {repository === undefined ? (
            "—"
          ) : (
            <span title={repository}>{repositoryLabel(repository)}</span>
          )}
        </Field>
      </Fields>
    </div>
  );
}
