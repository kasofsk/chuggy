/**
 * The ticket's landing as a page of its Runs tab: the rail with Landing
 * marked, the newest landing's state, its pull request and the commits it
 * names, and under them every landing record the read holds.
 */

import type { ReactNode } from "react";

import { sinceFigure } from "../../core/figures.ts";
import { branchName } from "../../core/labels.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import { ticketLandingLinkLabel } from "../../core/ticketLandings.ts";
import type {
  TicketLanding,
  TicketLandingsState,
} from "../../core/ticketLandings.ts";
import {
  ticketRunLandingMarked,
  ticketRunsLandingCycle,
} from "../../core/ticketRuns.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { useTicketPageHeld } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { LandingBlock } from "./TicketLandings.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { useTicketRuns } from "./TicketRuns.tsx";
import { TicketRunsFrame } from "./TicketRunPage.tsx";

import "./ticket.css";

function TicketLandingHead(props: {
  readonly landing: TicketLanding;
  readonly nowMs: number;
}): ReactNode {
  const { landing } = props;
  const text = useCopyText();
  const prepared = landing.detail.preparedAt;
  const marked = ticketRunLandingMarked(landing);
  return (
    <div className="ticket-run-head">
      <div className="ticket-run-heading">
        <TicketRunMarkDrawn mark={marked.mark} tone={marked.tone} />
        <h2>{text({ id: "ticket-landing-heading" })}</h2>
        <span className="ticket-run-cycle">
          {text(cycleLabel(landing.cycle))}
        </span>
        <Pill tone={landing.tone}>{landing.word}</Pill>
      </div>
      {prepared === undefined ? null : (
        <p className="ticket-run-meta">
          <Figure
            figure={sinceFigure(prepared, props.nowMs, {
              id: "figures-happened-prepared",
            })}
          />
        </p>
      )}
    </div>
  );
}

function TicketLandingFields(props: {
  readonly landing: TicketLanding;
}): ReactNode {
  const { landing } = props;
  const text = useCopyText();
  const proposal = landing.detail.proposal;
  const merge = proposal?.mergeCommit ?? landing.landedCommit;
  return (
    <Fields>
      <Field
        name={text({ id: "ticket-landing-pull-request-field" })}
        absent={landing.link === undefined}
      >
        {landing.link === undefined ? (
          text({ id: "ticket-value-none" })
        ) : (
          <>
            <a
              href={landing.link.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {ticketLandingLinkLabel(landing.link)}
            </a>
            {` · ${proposal?.status ?? landing.word}`}
          </>
        )}
      </Field>
      {proposal === undefined ? null : (
        <>
          <Field name={text({ id: "ticket-landing-from" })}>
            <code title={proposal.head}>{branchName(proposal.head)}</code>
          </Field>
          <Field name={text({ id: "ticket-landing-into" })}>
            <code title={proposal.base}>{branchName(proposal.base)}</code>
          </Field>
        </>
      )}
      {landing.detail.candidateCommit === undefined ? null : (
        <Field name={text({ id: "ticket-landing-head" })}>
          <Identity label={landing.detail.candidateCommit} />
        </Field>
      )}
      {merge === undefined ? null : (
        <Field name={text({ id: "ticket-landing-merge-commit" })}>
          <Identity label={merge} />
        </Field>
      )}
      <Field name={text({ id: "ticket-landing-attempts" })}>
        {landing.detail.attempts}
      </Field>
    </Fields>
  );
}

function TicketLandingOf(props: {
  readonly held: TicketPageHeld;
  readonly state: TicketLandingsState;
}): ReactNode {
  const text = useCopyText();
  if (props.state.state !== "Ready")
    return <PanelUnready state={props.state} />;
  const landings = props.state.value;
  const landing = landings.at(-1);
  if (landing === undefined)
    return <EmptyState label={text({ id: "ticket-landing-none" })} />;
  return (
    <>
      <TicketLandingHead landing={landing} nowMs={props.held.nowMs} />
      <div className="ticket-run-body">
        <TicketLandingFields landing={landing} />
      </div>
      <LandingBlock landings={landings} cycleNamed nowMs={props.held.nowMs} />
    </>
  );
}

/** The ticket's newest landing, beside the rail of every run it holds. */
export function TicketLandingTab(): ReactNode {
  const held = useTicketPageHeld();
  const runs = useTicketRuns(held);
  return (
    <TicketRunsFrame
      held={held}
      current={{
        at: "Landing",
        cycle:
          runs === undefined ? undefined : ticketRunsLandingCycle(runs.cycles),
      }}
    >
      <TicketLandingOf held={held} state={held.reads.landingsState} />
    </TicketRunsFrame>
  );
}
