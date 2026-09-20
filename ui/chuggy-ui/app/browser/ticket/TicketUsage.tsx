/**
 * What the ticket has spent: rolled up, then broken down by model and by the
 * stage of its plan that spent it.
 *
 * THERE IS NO BUDGET TO DRAW IT AGAINST. Ticket budgets are not on this wire,
 * so every figure here is a quantity and not a fraction — a meter with an
 * invented ceiling would be the only dishonest way to draw this.
 *
 * ONE SUM, AND IT IS `core/ticketUsage.ts`'s. Both tables and the rollup above
 * them are the same arithmetic over different sets, and every number is
 * formatted by `core/figures.ts`, so nothing on this page is rounded two ways
 * or added twice.
 *
 * THE FIGURES ARE A LIST PRICE AND SAY SO. `costBasis` is the wire's own word
 * for what the money is, and a rollup over runs that disagreed about it reports
 * the disagreement rather than picking one.
 */

import type { ReactNode } from "react";

import {
  costFigure,
  durationFigure,
  spendFigures,
  tokenCountFigure,
} from "../../core/figures.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import type { RunSpend } from "../../core/runTotals.ts";
import type { TicketUsage as TicketUsageValue } from "../../core/ticketUsage.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Table } from "../ui/Table.tsx";

/** The one absence a set of runs has, said the same way everywhere it appears. */
const usageAbsent: FigureValue = { kind: "Absent", why: "No run figures yet" };

function UsageTotals(props: { readonly total: RunSpend }): ReactNode {
  const totals = props.total.totals;
  const spend = spendFigures(totals, totals?.costBasis);
  return (
    <Fields variant="inline">
      <Field name="Cost">
        <Figure figure={spend.cost} />
      </Field>
      <Field name="Tokens">
        <Figure figure={spend.tokens} />
      </Field>
      <Field name="Turns">
        <span className="num">{totals?.turns ?? 0}</span>
      </Field>
      <Field name="Wall">
        <Figure
          figure={
            totals === undefined
              ? usageAbsent
              : durationFigure(totals.durationMs)
          }
        />
      </Field>
      <Field name="API">
        <Figure
          figure={
            totals === undefined
              ? usageAbsent
              : durationFigure(totals.durationApiMs)
          }
        />
      </Field>
      <Field name="Denials">
        <span className="num">{totals?.permissionDenials ?? 0}</span>
      </Field>
    </Fields>
  );
}

function UsageByModel(props: {
  readonly usage: TicketUsageValue;
}): ReactNode {
  const basis = props.usage.total.totals?.costBasis;
  if (basis === undefined || props.usage.byModel.length === 0) return null;
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
        {props.usage.byModel.map((model) => (
          <tr key={model.model}>
            <th scope="row">{model.model}</th>
            <td className="num">
              <Figure figure={tokenCountFigure(model.tokensInput)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(model.tokensOutput)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(model.tokensCacheCreation)} />
            </td>
            <td className="num">
              <Figure figure={tokenCountFigure(model.tokensCacheRead)} />
            </td>
            <td className="num">
              <Figure figure={costFigure(model.costUsdMicros, basis)} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StageCells(props: { readonly spend: RunSpend }): ReactNode {
  const totals = props.spend.totals;
  const spend = spendFigures(totals, totals?.costBasis);
  return (
    <>
      <td className="num">{props.spend.executions}</td>
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
              ? usageAbsent
              : durationFigure(totals.durationMs)
          }
        />
      </td>
    </>
  );
}

function UsageByStage(props: {
  readonly usage: TicketUsageValue;
}): ReactNode {
  if (props.usage.byStage.length === 0) return null;
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
        {props.usage.byStage.map((row) => (
          <tr key={row.ordinal}>
            <th scope="row">{row.label}</th>
            <StageCells spend={row.spend} />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function TicketUsage(props: {
  readonly usage: TicketUsageValue;
}): ReactNode {
  if (props.usage.total.executions === 0)
    return <EmptyState label="No run figures yet" />;
  return (
    <div className="grid gap-4">
      <UsageTotals total={props.usage.total} />
      <UsageByModel usage={props.usage} />
      <UsageByStage usage={props.usage} />
    </div>
  );
}
