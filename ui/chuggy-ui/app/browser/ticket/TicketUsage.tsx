/**
 * What the ticket has spent, by model and by stage.
 *
 * The roll-up and the by-model table are the ticket read's own figures, because
 * the server summed them over every execution and this screen may hold only a
 * page. The by-stage table is grouped here from the page and priced through
 * `runSpendOf`, which reports the basis every measured run agreed on and
 * reports disagreement as disagreement; `runStageRows` takes the first run's
 * basis instead, which is the finding kasofsk/chuggy#454 names, so this does
 * not use it.
 */

import type { ReactNode } from "react";

import type {
  ExecutionSummary,
  ExecutionsResponse,
  RunTotals,
} from "../../../../../src/contract/responses.ts";
import {
  costFigure,
  durationFigure,
  spendFigures,
  tokenCountFigure,
  tokensFigure,
} from "../../core/figures.ts";
import { runSpendOf } from "../../core/runTotals.ts";
import { runsLabel } from "./ticketPageFacts.ts";
import type { RunSpend } from "../../core/runTotals.ts";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Table } from "../ui/Table.tsx";

/** One row of the by-stage table: what the program ran, and what it cost. */
export interface StageSpendRow {
  readonly label: string;
  readonly stage: number;
  readonly spend: RunSpend;
}

/** Work comes before every stage, which is the order the program runs them in. */
const stageOrdinalWork = -1;

function stageOrdinalOf(summary: ExecutionSummary): number {
  return summary.taskKind === "Work" || summary.stage === undefined
    ? stageOrdinalWork
    : summary.stage;
}

function stageRowLabel(stage: number): string {
  return stage === stageOrdinalWork ? "Work" : `Stage ${String(stage + 1)}`;
}

/**
 * The page's executions grouped on the stage that ran them, work first and then
 * the program's own order. The order is the stage ordinal and never the drawn
 * label, which would sort `Stage 10` between `Stage 1` and `Stage 2`.
 */
export function stageSpendRows(
  page: ExecutionsResponse,
): readonly StageSpendRow[] {
  const grouped = new Map<number, ExecutionSummary[]>();
  for (const summary of page.executions) {
    const stage = stageOrdinalOf(summary);
    const held = grouped.get(stage);
    if (held === undefined) grouped.set(stage, [summary]);
    else held.push(summary);
  }
  return [...grouped]
    .map(([stage, executions]) => ({
      label: stageRowLabel(stage),
      stage,
      spend: runSpendOf(executions),
    }))
    .sort((left, right) => left.stage - right.stage);
}

function UsageTotals(props: {
  readonly totals: RunTotals;
  readonly page: ExecutionsResponse | undefined;
}): ReactNode {
  const totals = props.totals;
  return (
    <Fields variant="inline">
      <Field name="Cost">
        <Figure figure={costFigure(totals.costUsdMicros, totals.costBasis)} />
      </Field>
      <Field name="Tokens">
        <Figure figure={tokensFigure(totals)} />
      </Field>
      <Field name="Turns">
        <span className="num">{totals.turns}</span>
      </Field>
      <Field name="Wall">
        <Figure figure={durationFigure(totals.durationMs)} />
      </Field>
      <Field name="API">
        <Figure figure={durationFigure(totals.durationApiMs)} />
      </Field>
      <Field name="Runs">
        <span className="num">{runsLabel(props.page)}</span>
      </Field>
      <Field name="Denials">
        <span className="num">{totals.permissionDenials}</span>
      </Field>
    </Fields>
  );
}

function UsageByModel(props: { readonly totals: RunTotals }): ReactNode {
  return (
    <Table caption="Usage by model">
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col" className="num">
            In
          </th>
          <th scope="col" className="num">
            Out
          </th>
          <th scope="col" className="num">
            Cache write
          </th>
          <th scope="col" className="num">
            Cache read
          </th>
          <th scope="col" className="num">
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {props.totals.models.map((usage) => (
          <tr key={usage.model}>
            <th scope="row">{usage.model}</th>
            <td className="num">
              <Figure figure={tokenCountFigure(usage.tokensInput)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(usage.tokensOutput)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(usage.tokensCacheCreation)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(usage.tokensCacheRead)} />
            </td>
            <td className="num">
              <Figure
                figure={costFigure(usage.costUsdMicros, props.totals.costBasis)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StageSpendCells(props: { readonly row: StageSpendRow }): ReactNode {
  const spend = spendFigures(
    props.row.spend.totals,
    props.row.spend.totals?.costBasis,
  );
  const totals = props.row.spend.totals;
  return (
    <>
      <td className="num">{props.row.spend.executions}</td>
      <td className="num">
        <Figure figure={spend.cost} />
      </td>
      <td className="num">
        <Figure figure={spend.tokens} />
      </td>
      <td className="num">
        <Figure
          figure={
            totals === undefined
              ? { kind: "Absent", why: "No run figures yet" }
              : durationFigure(totals.durationMs)
          }
        />
      </td>
    </>
  );
}

function UsageByStage(props: { readonly page: ExecutionsResponse }): ReactNode {
  return (
    <Table caption="Usage by stage">
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col" className="num">
            Runs
          </th>
          <th scope="col" className="num">
            Cost
          </th>
          <th scope="col" className="num">
            Tokens
          </th>
          <th scope="col" className="num">
            Wall
          </th>
        </tr>
      </thead>
      <tbody>
        {stageSpendRows(props.page).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <StageSpendCells row={row} />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function TicketUsage(props: {
  readonly totals: RunTotals | undefined;
  readonly page: ExecutionsResponse | undefined;
}): ReactNode {
  return (
    <div className="ticket-usage">
      {props.totals === undefined ? (
        <EmptyState label="No run figures yet" />
      ) : (
        <>
          <UsageTotals totals={props.totals} page={props.page} />
          <UsageByModel totals={props.totals} />
        </>
      )}
      {props.page === undefined ? null : <UsageByStage page={props.page} />}
    </div>
  );
}
