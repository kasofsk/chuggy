/**
 * A ticket's landings: the read, asked on a clock and again on every frame
 * naming the ticket, and the records, fragments and detail the page draws of
 * it.
 *
 * Each record opens its own detail by state it keeps itself. A pull request
 * is an address a press opens outside the console, offered under its host.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { sinceFigure } from "../../core/figures.ts";
import { branchName } from "../../core/labels.ts";
import { runCountLabel } from "../../core/runTotals.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import { ticketLandingsQuery } from "../../core/ticketQueries.ts";
import {
  ticketLandingFragment,
  ticketLandingFragmentSays,
  ticketLandingsRead,
} from "../../core/ticketLandings.ts";
import type {
  TicketLanding,
  TicketLandingDetail,
  TicketLandingFragment,
  TicketLandingProposal,
  TicketLandingsState,
} from "../../core/ticketLandings.ts";
import { usePanelState } from "../api.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { LedgerBlock, LedgerRow } from "../ui/Ledger.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { copyOrDataText } from "../../core/copy.ts";

import "./ticket.css";

/** One ticket's landings, kept across a read that is out or failed. */
export function useTicketLandings(
  partition: PartitionIdentity,
  ticket: number,
): TicketLandingsState {
  return ticketLandingsRead(
    usePanelState(ticketLandingsQuery(partition, ticket)),
    useCopyText(),
  );
}

/**
 * A landing's fragment: its text, its pull request under the host it names,
 * the commit it landed at, and what a reader must not miss about that commit.
 */
function LandingFragment(props: {
  readonly fragment: TicketLandingFragment;
}): ReactNode {
  const fragment = props.fragment;
  const text = useCopyText();
  if (!ticketLandingFragmentSays(fragment)) return null;
  return (
    <span className="ticket-landing-fragment">
      {fragment.text === undefined ? null : copyOrDataText(text, fragment.text)}
      {fragment.link === undefined ? null : (
        <a href={fragment.link.href} rel="noopener noreferrer" target="_blank">
          {fragment.link.host}
        </a>
      )}
      {fragment.commit === undefined ? null : (
        <span className="ticket-landing-part">
          {fragment.commit.name === undefined
            ? null
            : text(fragment.commit.name)}
          <Identity label={fragment.commit.label} />
        </span>
      )}
      {fragment.caveat === undefined ? null : (
        <span className="ticket-landing-part">
          <span aria-hidden="true">·</span>
          {text(fragment.caveat)}
        </span>
      )}
    </span>
  );
}

function LandingProposalFields(props: {
  readonly proposal: TicketLandingProposal;
}): ReactNode {
  const proposal = props.proposal;
  const text = useCopyText();
  const labelled: readonly (readonly [string, string | undefined])[] = [
    [text({ id: "ticket-landing-head" }), branchName(proposal.head)],
    [text({ id: "ticket-landing-base" }), branchName(proposal.base)],
    [text({ id: "ticket-landing-creation" }), proposal.creation],
    [text({ id: "ticket-landing-status" }), proposal.status],
    [text({ id: "ticket-landing-merge" }), proposal.merge],
    [text({ id: "ticket-landing-reason" }), proposal.mergeReason],
    [text({ id: "ticket-landing-mergeability" }), proposal.mergeability],
    [text({ id: "ticket-landing-merge-state" }), proposal.mergeState],
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
        <Field name={text({ id: "ticket-landing-merge-commit" })}>
          <Identity label={proposal.mergeCommit} />
        </Field>
      )}
      {proposal.heads === undefined ? null : (
        <>
          <Field name={text({ id: "ticket-landing-merged-head" })}>
            <Identity label={proposal.heads.merged} />
          </Field>
          <Field name={text({ id: "ticket-landing-evaluated-head" })}>
            <Identity label={proposal.heads.evaluated} />
          </Field>
        </>
      )}
    </>
  );
}

function LandingConflicts(props: {
  readonly detail: TicketLandingDetail;
}): ReactNode {
  const detail = props.detail;
  const text = useCopyText();
  if (detail.conflicts.length === 0 && !detail.conflictsCut) return null;
  return (
    <Field name={text({ id: "ticket-landing-conflicts" })}>
      <ul className="ticket-landing-conflicts">
        {detail.conflicts.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
      {detail.conflictsCut ? (
        <p className="ticket-landing-cut">
          {text({ id: "ticket-landing-more-not-shown" })}
        </p>
      ) : null}
    </Field>
  );
}

function LandingDetail(props: {
  readonly detail: TicketLandingDetail;
  readonly nowMs: number;
}): ReactNode {
  const detail = props.detail;
  const text = useCopyText();
  return (
    <Fields>
      {detail.targetRef === undefined ? null : (
        <Field name={text({ id: "ticket-landing-target" })}>
          {branchName(detail.targetRef)}{" "}
          {detail.targetCommit === undefined ? null : (
            <Identity label={detail.targetCommit} />
          )}
        </Field>
      )}
      {detail.candidateCommit === undefined ? null : (
        <Field name={text({ id: "ticket-landing-candidate" })}>
          <Identity label={detail.candidateCommit} />
        </Field>
      )}
      {detail.preparedAt === undefined ? null : (
        <Field name={text({ id: "ticket-landing-prepared" })}>
          <Figure figure={sinceFigure(detail.preparedAt, props.nowMs)} />
        </Field>
      )}
      <Field name={text({ id: "ticket-landing-attempts" })}>
        {runCountLabel(detail.attempts)}
      </Field>
      <LandingConflicts detail={detail} />
      {detail.proposal === undefined ? null : (
        <LandingProposalFields proposal={detail.proposal} />
      )}
      {detail.checkedAt === undefined ? null : (
        <Field name={text({ id: "ticket-landing-checked" })}>
          <Figure figure={sinceFigure(detail.checkedAt, props.nowMs)} />
        </Field>
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
  const text = useCopyText();
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
          label: text({ id: "ticket-landing-details-label" }),
          hide: text({ id: "ticket-landing-details-hide" }),
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
  const text = useCopyText();
  if (props.landings.length === 0) return null;
  const landingWord = text({ id: "ticket-landing-heading" });
  return (
    <LedgerBlock eyebrow={landingWord}>
      {props.landings.map((landing) => (
        <LandingRow
          key={landing.key}
          label={
            props.cycleNamed ? text(cycleLabel(landing.cycle)) : landingWord
          }
          landing={landing}
          nowMs={props.nowMs}
        />
      ))}
    </LedgerBlock>
  );
}
