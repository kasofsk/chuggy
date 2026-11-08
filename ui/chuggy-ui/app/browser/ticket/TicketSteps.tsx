/* eslint-disable copy/no-literal-text */
/**
 * The Overview's steps block: the current cycle's Work, Evaluation and
 * Finalization as columns of boxes, each box a step with its mark and one
 * line, and a link to its run's page or the landing's.
 *
 * What is drawn is `core/ticketSteps.ts`'s reading of the ledger and the plan.
 * A column is as wide as the boxes it holds, because every box takes one
 * track of the same grid; below the narrow breakpoint the columns stack.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { cycleLabel } from "../../core/ticketLedger.ts";
import type {
  TicketStepAddress,
  TicketStepBox,
  TicketStepColumn,
  TicketStepEvaluator,
  TicketStepLine,
  TicketSteps,
} from "../../core/ticketSteps.ts";
import { Chevron } from "../ui/Chevron.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunTime } from "./TicketRunTime.tsx";

import "./ticket.css";

type TicketStepsParams = PartitionIdentity & { readonly ticket: string };

/** A box's address: its run's page, the landing's, or no link at all. */
function TicketStepLink(props: {
  readonly address: TicketStepAddress;
  readonly params: TicketStepsParams;
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const { address, params } = props;
  if (address?.to === "Run")
    return (
      <Link
        to="/$tenant/$project/tickets/$ticket/runs/$task"
        params={{ ...params, task: String(address.task) }}
        className={props.className}
      >
        {props.children}
      </Link>
    );
  if (address?.to === "Landing")
    return (
      <Link
        to="/$tenant/$project/tickets/$ticket/landing"
        params={params}
        className={props.className}
      >
        {props.children}
      </Link>
    );
  return <div className={props.className}>{props.children}</div>;
}

/** A line as words, or how long its run took; a box says a run still going
 * is running, where an evaluator inside one leaves that to its mark. */
function TicketStepLineDrawn(props: {
  readonly line: TicketStepLine;
  readonly nowMs: number;
  readonly said?: boolean;
}): ReactNode {
  const { line } = props;
  if (line.line === "Words") return line.words;
  return (
    <TicketRunTime
      runs={line.runs}
      nowMs={props.nowMs}
      running={line.live && props.said !== false}
    />
  );
}

function TicketStepEvaluatorDrawn(props: {
  readonly evaluator: TicketStepEvaluator;
  readonly params: TicketStepsParams;
  readonly nowMs: number;
}): ReactNode {
  const { evaluator } = props;
  return (
    <li>
      <TicketStepLink
        address={evaluator.address}
        params={props.params}
        className="ticket-steps-evaluator"
      >
        <TicketRunMarkDrawn mark={evaluator.mark} tone={evaluator.tone} />
        <span className="ticket-steps-name">{evaluator.name}</span>
        <span className="ticket-steps-time">
          {evaluator.line === undefined ? null : (
            <TicketStepLineDrawn
              line={evaluator.line}
              nowMs={props.nowMs}
              said={false}
            />
          )}
        </span>
      </TicketStepLink>
    </li>
  );
}

function TicketStepBoxDrawn(props: {
  readonly box: TicketStepBox;
  readonly params: TicketStepsParams;
  readonly nowMs: number;
}): ReactNode {
  const { box } = props;
  return (
    <>
      <TicketStepLink
        address={box.address}
        params={props.params}
        className="ticket-steps-box"
      >
        <span className="ticket-steps-mark">
          <TicketRunMarkDrawn mark={box.mark} tone={box.tone} />
        </span>
        <span className="ticket-steps-name">{box.name}</span>
        <span className="ticket-steps-line">
          <TicketStepLineDrawn line={box.line} nowMs={props.nowMs} />
        </span>
      </TicketStepLink>
      {box.evaluators.length === 0 ? null : (
        <ul className="ticket-steps-evaluators">
          {box.evaluators.map((evaluator) => (
            <TicketStepEvaluatorDrawn
              key={evaluator.name}
              evaluator={evaluator}
              params={props.params}
              nowMs={props.nowMs}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** One phase: its heading over its first box, marked "in order" where it
 * holds several, and every box after it in a track of its own. */
function TicketStepColumnDrawn(props: {
  readonly column: TicketStepColumn;
  readonly last: boolean;
  readonly params: TicketStepsParams;
  readonly nowMs: number;
}): ReactNode {
  const { column } = props;
  return (
    <div
      role="group"
      aria-label={column.phase}
      className="ticket-steps-column"
      data-edge={column.edge}
    >
      {column.boxes.map((box, index) => (
        <div
          key={`${box.name}/${String(index)}`}
          className="ticket-steps-cell"
          data-first={index === 0 ? "" : undefined}
        >
          {index === 0 ? (
            <p className="ticket-steps-phase">
              {column.phase}
              {column.boxes.length > 1 ? (
                <span className="ticket-steps-order">in order</span>
              ) : null}
            </p>
          ) : (
            <p className="ticket-steps-phase" aria-hidden="true" />
          )}
          <TicketStepBoxDrawn
            box={box}
            params={props.params}
            nowMs={props.nowMs}
          />
          {props.last && index === column.boxes.length - 1 ? null : (
            <span className="ticket-steps-next" aria-hidden="true">
              <Chevron className="ticket-steps-chevron" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function TicketStepsDrawn(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
  readonly steps: TicketSteps;
  readonly nowMs: number;
}): ReactNode {
  const { steps } = props;
  const params = { ...props.partition, ticket: String(props.ticket) };
  return (
    <section className="ticket-steps" aria-labelledby="ticket-steps-title">
      <header className="ticket-steps-head">
        <h2 id="ticket-steps-title">
          {steps.cycle === undefined ? "Steps" : cycleLabel(steps.cycle)}
        </h2>
        <span className="ticket-steps-aside">
          {steps.cycle === undefined ? "None run yet" : steps.previous}
        </span>
        {steps.cycle === undefined ? null : (
          <Link
            to="/$tenant/$project/tickets/$ticket/runs"
            params={params}
            className="ticket-steps-all"
          >
            All runs
            <Chevron className="ticket-steps-chevron" />
          </Link>
        )}
      </header>
      <div className="ticket-steps-grid">
        {steps.columns.map((column, index) => (
          <TicketStepColumnDrawn
            key={column.phase}
            column={column}
            last={index === steps.columns.length - 1}
            params={params}
            nowMs={props.nowMs}
          />
        ))}
      </div>
    </section>
  );
}
