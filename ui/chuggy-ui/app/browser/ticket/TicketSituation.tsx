/**
 * The short column beside the ledger: where the ticket is and what may be done
 * to it. The brief, the provenance and the configuration are in the main body
 * under the ledger; the details pane's `TicketPageDetails` is how a reader
 * gets to them.
 */

import type { MouseEvent, ReactNode } from "react";

import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import {
  escalationDetail,
  escalationDetailLine,
  phaseLabel,
  revokedDependencyLine,
} from "../../core/codeLabels.ts";
import type { WallFacts } from "../../core/codeLabels.ts";
import { costFigure, instantFigure } from "../../core/figures.ts";
import type {
  Cycle,
  Ledger as LedgerFacts,
  RanStage,
} from "../../core/ticketLedger.ts";
import { cycleLabel, ledgerLastSet } from "../../core/ticketLedger.ts";
import { useShellDetailsShow } from "../shell/slots.tsx";
import { useViewportAtLeastEm, viewportDeskEm } from "../shell/viewport.ts";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SectionList } from "../ui/SectionList.tsx";
import type { SectionEntry } from "../ui/SectionList.tsx";

/** The cycle the ticket's artifact belongs to, which is the last one on the page. */
function currentCycle(facts: LedgerFacts): Cycle | undefined {
  return facts.cycles.at(-1);
}

function wallFacts(facts: LedgerFacts, stageCount: number): WallFacts {
  return { lastSet: ledgerLastSet(facts), stageCount };
}

/** The stage a resume re-asked, which is the one whose highest generation is
 * past its first. */
function resumedStage(facts: LedgerFacts): number | undefined {
  const cycle = currentCycle(facts);
  const resumed = cycle?.stages.find(
    (row): row is RanStage =>
      row.kind === "Ran" &&
      row.evaluators.some((evaluator) => evaluator.generation > 1),
  );
  return resumed?.stage;
}

/** A resume shows in the ledger as the stage it re-asked sitting past its
 * first generation. */
function resumedFrom(facts: LedgerFacts): string | undefined {
  const cycle = currentCycle(facts);
  const stage = resumedStage(facts);
  if (cycle === undefined || stage === undefined) return undefined;
  return `Resumed at stage ${String(stage)} · ${cycleLabel(cycle.ordinal).toLowerCase()}`;
}

export function SituationNotice(props: {
  readonly ticket: TicketResponse;
  readonly facts: LedgerFacts;
  readonly stageCount: number;
  readonly nowMs: number;
}): ReactNode {
  const blocked = revokedDependencyLine(props.ticket.revokedDependencies);
  if (blocked !== undefined) {
    const at = instantFigure(props.ticket.changedAt, props.nowMs);
    return (
      <Notice tone="parked" role="status" heading="Blocked" detail={blocked}>
        <p className="pt-1">
          <Figure figure={at} />
        </p>
      </Notice>
    );
  }
  const escalation = props.ticket.escalation;
  if (escalation !== undefined) {
    const more = escalationDetailLine(
      escalation.kind,
      wallFacts(props.facts, props.stageCount),
    );
    const at = instantFigure(props.ticket.changedAt, props.nowMs);
    return (
      <Notice
        tone="parked"
        role="status"
        heading="Parked"
        detail={escalationDetail(escalation)}
        {...(more === undefined ? {} : { more })}
      >
        <p className="pt-1">
          <Figure figure={at} />
        </p>
      </Notice>
    );
  }
  const at = instantFigure(props.ticket.changedAt, props.nowMs);
  const resumed = resumedFrom(props.facts);
  return (
    <Notice
      tone={resumed === undefined ? "info" : "live"}
      role="status"
      heading={phaseLabel(props.ticket.phase)}
      {...(resumed === undefined ? {} : { detail: resumed })}
    >
      <p className="pt-1">
        <Figure figure={at} />
      </p>
    </Notice>
  );
}

export function TicketSituation(props: {
  readonly ticket: TicketResponse;
  readonly facts: LedgerFacts;
  readonly stageCount: number;
  readonly actions: ReactNode;
  readonly nowMs: number;
  readonly sticky: boolean;
}): ReactNode {
  return (
    <aside
      className={`grid min-w-0 gap-4 ${props.sticky ? "sticky top-4" : ""}`}
    >
      <SituationNotice
        ticket={props.ticket}
        facts={props.facts}
        stageCount={props.stageCount}
        nowMs={props.nowMs}
      />
      {props.actions}
    </aside>
  );
}

/**
 * The page's table of contents, drawn in the shell's details pane rather than
 * beside the ledger. A click closes the pane first where the pane and the page
 * share the middle row, so the anchor's target is not left behind it; at the
 * desk width the page stays beside the pane and nothing closes.
 */
export function TicketPageDetails(props: {
  readonly sections: readonly SectionEntry[];
}): ReactNode {
  const detailsShow = useShellDetailsShow();
  const desk = useViewportAtLeastEm(viewportDeskEm);
  const onNavigate = (event: MouseEvent<HTMLDivElement>): void => {
    if (!desk && (event.target as HTMLElement).closest("a") !== null)
      detailsShow(false);
  };
  return (
    <div onClick={onNavigate}>
      <Panel title="On this page" level={2}>
        <SectionList entries={props.sections} />
      </Panel>
    </div>
  );
}

/** The one figure the Usage anchor carries, which is what the ticket has cost. */
export function usageSectionFigure(
  ticket: TicketResponse,
): SectionEntry["figure"] {
  const totals = ticket.runTotals;
  return totals === undefined
    ? { kind: "Absent", why: "No run figures yet" }
    : costFigure(totals.costUsdMicros, totals.costBasis);
}
