/**
 * The ticket's executions in the machine's own structure: one group per work
 * cycle, holding the run that produced an artifact and the runs that judged it.
 *
 * THE ARRANGEMENT IS READ, NOT RECOVERED. Every row sits where its `taskKey`
 * says it sits, so nothing here sorts rows to find out what they are. A key
 * this console cannot read is drawn under its own block as unparsed, with the
 * key visible: a run placed in a cycle nobody can check it belongs to would be
 * a worse answer than one drawn beside the ledger.
 *
 * A ROW CARRIES ITS TASK KEY AND ITS ATTEMPT, which is what a run's evidence is
 * read by. The evidence screens are not here; what is here is the handle they
 * are reached with, so a reader can name the run they want.
 */

import type { ReactNode } from "react";

import type { AdoptedExecution } from "../../core/adoptedExecutions.ts";
import { adoptedExecutionStateLabel } from "../../core/codeLabels.ts";
import { spendFigures, whenFigure } from "../../core/figures.ts";
import { ticketLedgerExecutions } from "../../core/ticketLedger.ts";
import type {
  TicketLedger,
  TicketLedgerCycle,
  TicketLedgerUnplaced,
  TicketLedgerUnplacedReason,
} from "../../core/ticketLedger.ts";
import { adoptedExecutionStateTone } from "../../core/tones.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Ledger, LedgerBlock, LedgerGroup, LedgerRow } from "../ui/Ledger.tsx";

/** What the page holds is not what the ticket has, where the read came back full. */
export const ledgerShortPageNote =
  "This page is full, so the ticket may have runs below it that were not read.";

function unplacedText(why: TicketLedgerUnplacedReason): string {
  switch (why) {
    case "Unreadable":
      return "Unparsed key";
    case "OtherTicket":
      return "Names another ticket";
  }
}

/** A run's attempt, and the attempts the machine counted but heard nothing about. */
function rowNote(execution: AdoptedExecution): string {
  const unreported = execution.attemptsUnreported;
  return [
    `attempt ${String(execution.attempt)}`,
    ...(unreported === 0 ? [] : [`${String(unreported)} unreported`]),
    ...(execution.pool === undefined ? [] : [execution.pool]),
  ].join(" · ");
}

function ExecutionRow(props: {
  readonly label: string;
  readonly execution: AdoptedExecution;
  readonly nowMs: number;
}): ReactNode {
  const execution = props.execution;
  return (
    <LedgerRow
      label={props.label}
      identity={{
        text: execution.taskKey,
        title: `The machine's name for this task: ${execution.taskKey}`,
      }}
      pill={{
        tone: adoptedExecutionStateTone(execution.state),
        text: adoptedExecutionStateLabel(execution.state),
      }}
      when={whenFigure(
        {
          registeredAt: execution.queuedAt,
          ...(execution.lastReportedAt === undefined
            ? {}
            : { terminalAt: execution.lastReportedAt }),
        },
        props.nowMs,
      )}
      spent={spendFigures(execution.totals, execution.totals?.costBasis)}
      note={rowNote(execution)}
    />
  );
}

/** One cycle's evaluations, blocked by the stage that ran them. */
function CycleEvaluations(props: {
  readonly cycle: TicketLedgerCycle;
  readonly nowMs: number;
}): ReactNode {
  const stages = [
    ...new Set(props.cycle.evaluations.map((held) => held.stage)),
  ];
  return (
    <>
      {stages.map((stage) => (
        <LedgerBlock key={stage} eyebrow={`Stage ${String(stage + 1)}`}>
          {props.cycle.evaluations
            .filter((held) => held.stage === stage)
            .map((held) => (
              <ExecutionRow
                key={held.execution.taskKey}
                label={`Evaluator ${String(held.evaluator + 1)} · generation ${String(held.generation)}`}
                execution={held.execution}
                nowMs={props.nowMs}
              />
            ))}
        </LedgerBlock>
      ))}
    </>
  );
}

/** How many runs a cycle holds, and whether its work run reached this page. */
function cycleSummary(cycle: TicketLedgerCycle): string {
  const runs = cycle.evaluations.length + (cycle.work === undefined ? 0 : 1);
  return [
    `${String(runs)} runs`,
    ...(cycle.work === undefined ? ["no work run on this page"] : []),
  ].join(" · ");
}

function Cycle(props: {
  readonly cycle: TicketLedgerCycle;
  readonly current: boolean;
  readonly nowMs: number;
}): ReactNode {
  const cycle = props.cycle;
  return (
    <LedgerGroup
      title={`Cycle ${String(cycle.cycle)}`}
      standing={props.current ? "Current" : "Superseded"}
      summary={cycleSummary(cycle)}
      open={props.current}
    >
      {cycle.work === undefined ? null : (
        <LedgerBlock eyebrow="Work">
          <ExecutionRow
            label="Work"
            execution={cycle.work}
            nowMs={props.nowMs}
          />
        </LedgerBlock>
      )}
      <CycleEvaluations cycle={cycle} nowMs={props.nowMs} />
    </LedgerGroup>
  );
}

function Unplaced(props: {
  readonly unplaced: readonly TicketLedgerUnplaced[];
  readonly nowMs: number;
}): ReactNode {
  return (
    <LedgerBlock
      eyebrow="Outside the cycles"
      pill={{ tone: "parked", text: "Not placed" }}
    >
      {props.unplaced.map((held) => (
        <ExecutionRow
          key={held.execution.taskKey}
          label={unplacedText(held.why)}
          execution={held.execution}
          nowMs={props.nowMs}
        />
      ))}
    </LedgerBlock>
  );
}

export function TicketLedgerPanel(props: {
  readonly ledger: TicketLedger;
  readonly short: boolean;
  readonly nowMs: number;
}): ReactNode {
  const ledger = props.ledger;
  const last = ledger.cycles.at(-1)?.cycle;
  if (ledger.cycles.length === 0 && ledger.unplaced.length === 0)
    return <EmptyState label="Nothing has run for this ticket yet" />;
  return (
    <Ledger {...(props.short ? { truncated: ledgerShortPageNote } : {})}>
      {ledger.cycles.map((cycle) => (
        <Cycle
          key={cycle.cycle}
          cycle={cycle}
          current={cycle.cycle === last}
          nowMs={props.nowMs}
        />
      ))}
      {ledger.unplaced.length === 0 ? null : (
        <Unplaced unplaced={ledger.unplaced} nowMs={props.nowMs} />
      )}
    </Ledger>
  );
}

/** How much the groups below hold, for the line beside the panel's title. */
export function ticketLedgerSummary(ledger: TicketLedger): string {
  const runs = ticketLedgerExecutions(ledger).length;
  return `${String(ledger.cycles.length)} cycles · ${String(runs)} runs`;
}
