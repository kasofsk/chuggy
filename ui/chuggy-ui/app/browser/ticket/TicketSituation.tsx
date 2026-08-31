/**
 * The short column beside the ledger: where the ticket is, what may be done to
 * it, what it is metered by, and where the rest of the page is.
 *
 * It holds exactly four things and none of them is detail — the brief, the
 * provenance and the configuration are in the main body under the ledger, and
 * the section list is how a reader gets to them. Anchors rather than tabs,
 * because tabs hide content, break find-in-page and cannot be linked to, and
 * the ledger is what this page is.
 */

import type { ReactNode } from "react";

import type { TicketResponse } from "../../../../../src/contract/responses.ts";
import {
  escalationDetailLine,
  escalationReasonLabel,
  phaseLabel,
} from "../../core/codeLabels.ts";
import type { WallFacts } from "../../core/codeLabels.ts";
import { costFigure } from "../../core/figures.ts";
import type { TicketAccounts } from "../../core/ticketAccounts.ts";
import type { Cycle, Ledger as LedgerFacts } from "../../core/ticketLedger.ts";
import { cycleLabel, ledgerLastSet } from "../../core/ticketLedger.ts";
import { ActionWithCost } from "../ui/ActionWithCost.tsx";
import { BudgetMeter } from "../ui/BudgetMeter.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SectionList } from "../ui/SectionList.tsx";
import type { SectionEntry } from "../ui/SectionList.tsx";

/** What the machine has no operation for today, said where the operator asks. */
export const reworkTopUpRefusal = "Not available in this release";

/** The cycle the ticket's artifact belongs to, which is the last one on the page. */
function currentCycle(facts: LedgerFacts): Cycle | undefined {
  return facts.cycles.at(-1);
}

function wallFacts(
  facts: LedgerFacts,
  accounts: TicketAccounts,
  stageCount: number,
): WallFacts {
  return {
    lastSet: ledgerLastSet(facts),
    stageCount,
    reworkMax: accounts.rework.max,
    finalizationMax: accounts.finalization.max,
  };
}

/** A resume shows in the ledger as a second program run inside one cycle. */
function resumedFrom(facts: LedgerFacts): string | undefined {
  const cycle = currentCycle(facts);
  if (cycle === undefined || cycle.programRuns.length < 2) return undefined;
  return `Resumed from stage 1 · ${cycleLabel(cycle.ordinal).toLowerCase()}`;
}

export function SituationNotice(props: {
  readonly ticket: TicketResponse;
  readonly facts: LedgerFacts;
  readonly accounts: TicketAccounts;
  readonly stageCount: number;
}): ReactNode {
  const reason = props.ticket.reason;
  if (reason !== undefined) {
    const more = escalationDetailLine(
      reason,
      wallFacts(props.facts, props.accounts, props.stageCount),
    );
    return (
      <Notice
        tone="parked"
        role="status"
        heading="Parked"
        detail={escalationReasonLabel(reason)}
        {...(more === undefined ? {} : { more })}
      />
    );
  }
  const resumed = resumedFrom(props.facts);
  const rework = props.accounts.rework;
  const exhausted =
    rework.policy === "Budgeted" && rework.left === 0
      ? `Rework ${String(rework.spent)}/${String(rework.max ?? 0)} used · a failure parks it`
      : undefined;
  return (
    <Notice
      tone={resumed === undefined ? "info" : "live"}
      role="status"
      heading={phaseLabel(props.ticket.phase)}
      {...(resumed === undefined ? {} : { detail: resumed })}
      {...(exhausted === undefined ? {} : { more: exhausted })}
    />
  );
}

export function SituationBudgets(props: {
  readonly accounts: TicketAccounts;
  readonly onTopUp: () => void;
}): ReactNode {
  return (
    <>
      <BudgetMeter
        name="Rework"
        account={props.accounts.rework}
        how="1 per failed stage"
        action={
          <ActionWithCost
            action="Add rework"
            effect="Adds one rework cycle"
            refusedBecause={reworkTopUpRefusal}
            onChoose={props.onTopUp}
          />
        }
      />
      <BudgetMeter
        name="Gas"
        account={props.accounts.gas}
        how="1 per work entry or paid resume"
      />
      <BudgetMeter
        name="Finalization"
        account={props.accounts.finalization}
        how="Failures cost gas"
      />
    </>
  );
}

export function TicketSituation(props: {
  readonly ticket: TicketResponse;
  readonly facts: LedgerFacts;
  readonly accounts: TicketAccounts;
  readonly stageCount: number;
  readonly sections: readonly SectionEntry[];
  readonly actions: ReactNode;
}): ReactNode {
  return (
    <aside className="situation">
      <SituationNotice
        ticket={props.ticket}
        facts={props.facts}
        accounts={props.accounts}
        stageCount={props.stageCount}
      />
      {props.actions}
      <Panel title="Budgets" level={2}>
        <div className="situation-budgets">
          <SituationBudgets
            accounts={props.accounts}
            onTopUp={() => {
              return;
            }}
          />
        </div>
      </Panel>
      <Panel title="On this page" level={2}>
        <SectionList entries={props.sections} />
      </Panel>
    </aside>
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
