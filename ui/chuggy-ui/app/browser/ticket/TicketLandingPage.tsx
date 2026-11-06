/**
 * The ticket's landing as a page of its Runs tab: the rail with Landing
 * marked, the newest landing's state, its pull request and the commits it
 * names, and under them every landing record the read holds.
 */

import type { ReactNode } from "react";

import { sinceFigure } from "../../core/figures.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import { ticketLandingLinkLabel } from "../../core/ticketLandings.ts";
import type {
  TicketLanding,
  TicketLandingsState,
} from "../../core/ticketLandings.ts";
import { ticketRunsLandingCycle } from "../../core/ticketRuns.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Pill } from "../ui/Pill.tsx";
import { useTicketPageHeld } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { LandingBlock } from "./TicketLandings.tsx";
import { TicketRunMarkDrawn, useTicketRuns } from "./TicketRuns.tsx";
import { TicketRunsFrame } from "./TicketRunPage.tsx";

import "./ticket.css";

function TicketLandingHead(props: {
  readonly landing: TicketLanding;
  readonly nowMs: number;
}): ReactNode {
  const { landing } = props;
  const prepared = landing.detail.preparedAt;
  return (
    <div className="ticket-run-head">
      <div className="ticket-run-heading">
        <TicketRunMarkDrawn mark="Merge" tone="finalization" />
        <h2>Landing</h2>
        <span className="ticket-run-cycle">{cycleLabel(landing.cycle)}</span>
        <Pill tone={landing.tone}>{landing.word}</Pill>
      </div>
      {prepared === undefined ? null : (
        <p className="ticket-run-meta">
          <Figure figure={sinceFigure(prepared, props.nowMs, "Prepared")} />
        </p>
      )}
    </div>
  );
}

function TicketLandingFields(props: {
  readonly landing: TicketLanding;
}): ReactNode {
  const { landing } = props;
  const proposal = landing.detail.proposal;
  const merge = proposal?.mergeCommit ?? landing.landedCommit;
  return (
    <Fields>
      <Field name="Pull request" absent={landing.link === undefined}>
        {landing.link === undefined ? (
          "None"
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
          <Field name="From">
            <code>{proposal.head}</code>
          </Field>
          <Field name="Into">
            <code>{proposal.base}</code>
          </Field>
        </>
      )}
      {landing.detail.candidateCommit === undefined ? null : (
        <Field name="Head">
          <Identity label={landing.detail.candidateCommit} />
        </Field>
      )}
      {merge === undefined ? null : (
        <Field name="Merge commit">
          <Identity label={merge} />
        </Field>
      )}
      <Field name="Attempts">{landing.detail.attempts}</Field>
    </Fields>
  );
}

function TicketLandingOf(props: {
  readonly held: TicketPageHeld;
  readonly state: TicketLandingsState;
}): ReactNode {
  if (props.state.state !== "Ready")
    return <PanelUnready state={props.state} />;
  const landings = props.state.value;
  const landing = landings.at(-1);
  if (landing === undefined) return <EmptyState label="No landing" />;
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
