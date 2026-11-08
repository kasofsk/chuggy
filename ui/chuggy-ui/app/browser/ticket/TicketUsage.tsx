/**
 * The Usage tab: what the ticket's runs cost and took, as four tiles, by step
 * and by model, and where delivery stands where the ticket's repository
 * declares actions.
 *
 * Cost, tokens, turns and the by-model table are the ticket read's own
 * roll-up, which the server summed over every execution. Run time and the
 * by-step table are summed here over the executions read by
 * `core/ticketUsage.ts`, as the Runs tab and the sidebar sum them, and a short
 * page says so.
 */

import type { ReactNode } from "react";

import type { RunTotals } from "../../../../../src/contract/responses.ts";
import type { RunCostBasis } from "../../../../../src/contract/rosters.ts";
import {
  costAmountFigure,
  costFigure,
  durationFigure,
  tokenCountFigure,
  tokensTotal,
} from "../../core/figures.ts";
import type { Figure as FigureValue } from "../../core/figures.ts";
import { ticketDeliveryDrawn } from "../../core/ticketDelivery.ts";
import { ticketUsageStepsOf } from "../../core/ticketUsage.ts";
import type { TicketUsageStep } from "../../core/ticketUsage.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../ui/Table.tsx";
import { TicketDelivery } from "./TicketDelivery.tsx";
import { readValue } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";

import "./ticket.css";

const ticketUsageUnmeasured: FigureValue = {
  kind: "Absent",
  why: { id: "figures-absent-run" },
};

/** The basis a ticket's cost was priced on, in a reader's words. */
function ticketUsageBasisLabel(basis: RunCostBasis, text: CopyText): string {
  switch (basis) {
    case "List":
      return text({ id: "ticket-usage-basis-list" });
  }
}

function TicketUsageTile(props: {
  readonly name: string;
  readonly note: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ticket-usage-tile">
      <dt>{props.name}</dt>
      <dd className="ticket-usage-tile-figure">{props.children}</dd>
      <dd className="ticket-usage-tile-note">{props.note}</dd>
    </div>
  );
}

function TicketUsageTiles(props: {
  readonly totals: RunTotals | undefined;
  readonly total: TicketUsageStep;
}): ReactNode {
  const totals = props.totals;
  const text = useCopyText();
  return (
    <dl className="ticket-usage-tiles">
      <TicketUsageTile
        name={text({ id: "ticket-field-cost" })}
        note={
          totals === undefined
            ? ""
            : ticketUsageBasisLabel(totals.costBasis, text)
        }
      >
        <Figure
          figure={
            totals === undefined
              ? ticketUsageUnmeasured
              : costAmountFigure(totals.costUsdMicros)
          }
        />
      </TicketUsageTile>
      <TicketUsageTile
        name={text({ id: "ticket-field-run-time" })}
        note={text({
          id: "ticket-run-count",
          args: { count: props.total.runs },
        })}
      >
        <Figure figure={props.total.time.ran} />
      </TicketUsageTile>
      <TicketUsageTile
        name={text({ id: "ticket-field-tokens" })}
        note={
          totals === undefined
            ? ""
            : text({
                id: "ticket-usage-models-note",
                args: { count: totals.models.length },
              })
        }
      >
        <Figure
          figure={
            totals === undefined
              ? ticketUsageUnmeasured
              : tokenCountFigure(tokensTotal(totals))
          }
        />
      </TicketUsageTile>
      <TicketUsageTile
        name={text({ id: "ticket-field-turns" })}
        note={text({ id: "ticket-usage-agent-runs" })}
      >
        {totals === undefined ? (
          <Figure figure={ticketUsageUnmeasured} />
        ) : (
          <span className="num">{totals.turns}</span>
        )}
      </TicketUsageTile>
    </dl>
  );
}

function TicketUsageStepCells(props: {
  readonly step: TicketUsageStep;
}): ReactNode {
  const { step } = props;
  const totals = step.spend.totals;
  return (
    <>
      <td className="num">{step.runs}</td>
      <td className="num">
        <Figure figure={step.time.ran} />
      </td>
      <td className="num">
        <Figure figure={step.time.waited} />
      </td>
      <td className="num">
        <Figure
          figure={
            totals === undefined
              ? ticketUsageUnmeasured
              : tokenCountFigure(tokensTotal(totals))
          }
        />
      </td>
      <td className="num">
        <Figure
          figure={
            totals === undefined
              ? ticketUsageUnmeasured
              : costFigure(totals.costUsdMicros, totals.costBasis)
          }
        />
      </td>
    </>
  );
}

function TicketUsageBySteps(props: {
  readonly steps: readonly TicketUsageStep[];
  readonly total: TicketUsageStep;
}): ReactNode {
  const text = useCopyText();
  return (
    <Table caption={text({ id: "ticket-usage-by-step-caption" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "ticket-usage-col-step" })}</th>
          <th scope="col" className="num">
            {text({ id: "ticket-usage-col-runs" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-field-run-time" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-field-waited" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-field-tokens" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-field-cost" })}
          </th>
        </tr>
      </thead>
      <tbody>
        {props.steps.map((step) => (
          <tr key={step.label}>
            <th scope="row">{step.label}</th>
            <TicketUsageStepCells step={step} />
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{props.total.label}</th>
          <TicketUsageStepCells step={props.total} />
        </tr>
      </tfoot>
    </Table>
  );
}

function TicketUsageByModel(props: { readonly totals: RunTotals }): ReactNode {
  const text = useCopyText();
  return (
    <Table caption={text({ id: "ticket-usage-by-model-caption" })}>
      <thead>
        <tr>
          <th scope="col">{text({ id: "ticket-field-model" })}</th>
          <th scope="col" className="num">
            {text({ id: "ticket-usage-col-input" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-usage-col-output" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-usage-col-cache-write" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-usage-col-cache-read" })}
          </th>
          <th scope="col" className="num">
            {text({ id: "ticket-field-cost" })}
          </th>
        </tr>
      </thead>
      <tbody>
        {props.totals.models.map((usage) => (
          <tr key={usage.model}>
            <th scope="row">
              <code>{usage.model}</code>
            </th>
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

function TicketUsageSection(props: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="ticket-usage-section" aria-labelledby={props.id}>
      <h2 className="ticket-usage-title" id={props.id}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function TicketUsageMinor(props: { readonly totals: RunTotals }): ReactNode {
  const text = useCopyText();
  return (
    <div className="ticket-usage-minor">
      <Fields variant="inline">
        <Field name={text({ id: "ticket-field-api-time" })}>
          <Figure figure={durationFigure(props.totals.durationApiMs)} />
        </Field>
        <Field name={text({ id: "ticket-usage-permission-denials" })}>
          <span className="num">{props.totals.permissionDenials}</span>
        </Field>
      </Fields>
    </div>
  );
}

function TicketUsageFigures(props: {
  readonly held: TicketPageHeld;
}): ReactNode {
  const { held } = props;
  const text = useCopyText();
  const page = readValue(held.reads.pageState);
  if (page === undefined) return <PanelUnready state={held.reads.pageState} />;
  const usage = ticketUsageStepsOf(
    page.executions,
    held.facts.plan.names,
    held.nowMs,
    text,
  );
  if (usage === undefined)
    return <EmptyState label={text({ id: "ticket-nothing-has-run" })} />;
  const totals = readValue(held.reads.ticketState)?.runTotals;
  return (
    <>
      <TicketUsageTiles totals={totals} total={usage.total} />
      <TicketUsageSection
        id="ticket-usage-steps"
        title={text({ id: "ticket-usage-by-step-title" })}
      >
        {held.facts.truncated ? (
          <Notice
            tone="parked"
            inline
            detail={text({
              id: "ticket-usage-steps-over",
              args: {
                run: {
                  id: "ticket-run-count",
                  args: { count: usage.total.runs },
                },
              },
            })}
          />
        ) : null}
        <TicketUsageBySteps steps={usage.steps} total={usage.total} />
      </TicketUsageSection>
      {totals === undefined ? null : (
        <>
          <TicketUsageSection
            id="ticket-usage-models"
            title={text({ id: "ticket-usage-by-model-title" })}
          >
            <TicketUsageByModel totals={totals} />
          </TicketUsageSection>
          <TicketUsageMinor totals={totals} />
        </>
      )}
    </>
  );
}

export function TicketUsage(props: {
  readonly held: TicketPageHeld;
}): ReactNode {
  const delivery = props.held.reads.deliveryState;
  const text = useCopyText();
  return (
    <div className="ticket-usage">
      <TicketUsageFigures held={props.held} />
      {ticketDeliveryDrawn(delivery) ? (
        <TicketUsageSection
          id="ticket-delivery"
          title={text({ id: "ticket-usage-delivery-title" })}
        >
          <TicketDelivery state={delivery} />
        </TicketUsageSection>
      ) : null}
    </div>
  );
}
