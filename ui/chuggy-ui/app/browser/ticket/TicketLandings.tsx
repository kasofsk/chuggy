/**
 * A ticket's landings: the read, asked on a clock and again on every frame
 * naming the ticket, and the rows, fragments and detail the page draws of it.
 *
 * Each row opens its own detail by state it keeps itself, because a landing
 * has no execution for the ledger's shared opened row to name. A pull request
 * is an address a press opens outside the console, offered under its host.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { TicketLandingsResponse } from "../../../../../src/contract/responses.ts";
import { apiTicketLandings } from "../../core/apiRoutes.ts";
import { sinceFigure } from "../../core/figures.ts";
import { projectListRereadNamed } from "../../core/projectQueryKeys.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import {
  ticketLandingFragment,
  ticketLandingFragmentSays,
  ticketLandingsListName,
  ticketLandingsPolledMs,
  ticketLandingsRead,
} from "../../core/ticketLandings.ts";
import type {
  TicketLanding,
  TicketLandingDetail,
  TicketLandingFragment,
  TicketLandingProposal,
  TicketLandingsState,
} from "../../core/ticketLandings.ts";
import { usePanelList } from "../api.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { LedgerBlock, LedgerRow } from "../ui/Ledger.tsx";

import "./ticket.css";

/** One ticket's landings, kept across a read that is out or failed. */
export function useTicketLandings(
  partition: PartitionIdentity,
  ticket: number,
): TicketLandingsState {
  return ticketLandingsRead(
    usePanelList(
      projectListRereadNamed<TicketLandingsResponse>(
        partition,
        "Ticket",
        ticketLandingsListName(ticket),
        (change) => change.resource === String(ticket),
      ),
      (ports) => apiTicketLandings(ports, partition, ticket),
      ticketLandingsPolledMs,
    ),
  );
}

/** A landing's fragment: its text, its pull request under the host it names, its commit. */
export function LandingFragment(props: {
  readonly fragment: TicketLandingFragment;
}): ReactNode {
  const fragment = props.fragment;
  if (!ticketLandingFragmentSays(fragment)) return null;
  return (
    <span className="ticket-landing-fragment">
      {fragment.text}
      {fragment.link === undefined ? null : (
        <a href={fragment.link.href} rel="noopener noreferrer" target="_blank">
          {fragment.link.host}
        </a>
      )}
      {fragment.commit === undefined ? null : (
        <Identity label={fragment.commit} />
      )}
    </span>
  );
}

function LandingProposalFields(props: {
  readonly proposal: TicketLandingProposal;
}): ReactNode {
  const proposal = props.proposal;
  const labelled: readonly (readonly [string, string | undefined])[] = [
    ["Head", proposal.head],
    ["Base", proposal.base],
    ["Creation", proposal.creation],
    ["Merge", proposal.merge],
    ["Reason", proposal.mergeReason],
    ["Mergeability", proposal.mergeability],
  ];
  return (
    <>
      {labelled.map(([name, value]) =>
        value === undefined ? null : (
          <Field key={name} name={name}>
            {value}
          </Field>
        ),
      )}
      {proposal.mergeCommit === undefined ? null : (
        <Field name="Merge commit">
          <Identity label={proposal.mergeCommit} />
        </Field>
      )}
    </>
  );
}

function LandingConflicts(props: {
  readonly detail: TicketLandingDetail;
}): ReactNode {
  const detail = props.detail;
  if (detail.conflicts.length === 0 && !detail.conflictsCut) return null;
  return (
    <Field name="Conflicts">
      <ul className="ticket-landing-conflicts">
        {detail.conflicts.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
      {detail.conflictsCut ? (
        <p className="ticket-landing-cut">More not shown</p>
      ) : null}
    </Field>
  );
}

function LandingDetail(props: {
  readonly detail: TicketLandingDetail;
  readonly nowMs: number;
}): ReactNode {
  const detail = props.detail;
  return (
    <Fields>
      {detail.targetRef === undefined ? null : (
        <Field name="Target">
          {detail.targetRef}{" "}
          {detail.targetCommit === undefined ? null : (
            <Identity label={detail.targetCommit} />
          )}
        </Field>
      )}
      {detail.candidateCommit === undefined ? null : (
        <Field name="Candidate">
          <Identity label={detail.candidateCommit} />
        </Field>
      )}
      {detail.preparedAt === undefined ? null : (
        <Field name="Prepared">
          <Figure figure={sinceFigure(detail.preparedAt, props.nowMs)} />
        </Field>
      )}
      <Field name="Attempts">{runCountLabel(detail.attempts)}</Field>
      <LandingConflicts detail={detail} />
      {detail.proposal === undefined ? null : (
        <LandingProposalFields proposal={detail.proposal} />
      )}
    </Fields>
  );
}

function LandingRow(props: {
  readonly label: string;
  readonly landing: TicketLanding;
  readonly nowMs: number;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const landing = props.landing;
  return (
    <LedgerRow
      label={props.label}
      pill={{ tone: landing.tone, text: landing.word }}
      note={
        <LandingFragment
          fragment={ticketLandingFragment(landing, props.nowMs)}
        />
      }
      expands={[
        {
          label: "Details",
          hide: "Hide",
          open,
          onToggle: () => {
            setOpen((held) => !held);
          },
          children: (
            <LandingDetail detail={landing.detail} nowMs={props.nowMs} />
          ),
        },
      ]}
    />
  );
}

/**
 * The block of landings under the eyebrow "Landing", drawn for none at all.
 * A row names its cycle where the block stands apart from the cycles.
 */
export function LandingBlock(props: {
  readonly landings: readonly TicketLanding[];
  readonly cycleNamed: boolean;
  readonly nowMs: number;
}): ReactNode {
  if (props.landings.length === 0) return null;
  return (
    <LedgerBlock eyebrow="Landing">
      {props.landings.map((landing) => (
        <LandingRow
          key={landing.key}
          label={props.cycleNamed ? cycleLabel(landing.cycle) : "Landing"}
          landing={landing}
          nowMs={props.nowMs}
        />
      ))}
    </LedgerBlock>
  );
}
