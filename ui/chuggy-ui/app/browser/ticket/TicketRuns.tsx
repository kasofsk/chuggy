/**
 * The ticket's runs: the Runs tab's list of cycles, newest first, every row a
 * link to its run's own page, and the rail the run and landing pages list the
 * same runs in.
 *
 * What is drawn is `core/ticketRuns.ts`'s reading of the ledger; each row of
 * the list reads its own execution for the one line it says, and the rail
 * reads nothing beyond the page of executions the ticket already holds.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  ExecutionsResponse,
} from "../../../../../src/contract/responses.ts";
import { configurationQuery } from "../../core/configurationQueries.ts";
import {
  executionQuery,
  ticketExecutionsQuery,
} from "../../core/executionQueries.ts";
import { spanRanFigure, spendFigures } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { runReasonAttempt, runRefusalOf } from "../../core/runReason.ts";
import { runResultLineOf } from "../../core/runResult.ts";
import {
  ticketLandingsHeld,
  ticketLandingsJoined,
} from "../../core/ticketLandings.ts";
import { cycleLabel, ticketLedger } from "../../core/ticketLedger.ts";
import {
  ticketRunMarkOf,
  ticketRunsNamesOf,
  ticketRunsOf,
  ticketRunsRowName,
} from "../../core/ticketRuns.ts";
import type {
  TicketRunMark,
  TicketRunsCycle,
  TicketRunsRow,
} from "../../core/ticketRuns.ts";
import { verdictTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useRunReason } from "../RunEvidence.tsx";
import { Chevron } from "../ui/Chevron.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { readValue } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";

import "./ticket.css";

/**
 * The page of executions this ticket's route answers with, read once by the
 * page and handed to every tab, so a live frame lands in it.
 */
export function useTicketExecutions(
  partition: PartitionIdentity,
  ticket: number,
): PanelState<ExecutionsResponse> {
  return usePanelState(ticketExecutionsQuery(partition, ticket));
}

function TicketRunMarkPaths(props: {
  readonly mark: TicketRunMark;
}): ReactNode {
  switch (props.mark) {
    case "Check":
      return <path d="M5.3 8.2 L7.2 10 L10.8 6.2" />;
    case "Cross":
      return <path d="M5.9 5.9 L10.1 10.1 M10.1 5.9 L5.9 10.1" />;
    case "Spin":
      return <path d="M8 2 A6 6 0 0 1 14 8" />;
    case "Alert":
      return <path d="M8 4.8 V8.6 M8 11 V11.2" />;
    case "Slash":
      return <path d="M3.8 12.2 L12.2 3.8" />;
    case "Open":
    case "Merge":
      return null;
  }
}

/** A run's status as a mark, its word left to the row or the pill beside it. */
export function TicketRunMarkDrawn(props: {
  readonly mark: TicketRunMark;
  readonly tone: Tone;
}): ReactNode {
  const ring = props.mark !== "Merge";
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="ticket-run-mark"
      data-tone={props.tone}
      data-mark={props.mark}
    >
      {props.mark === "Merge" ? (
        <>
          <circle cx="5" cy="3.5" r="1.6" />
          <circle cx="5" cy="12.5" r="1.6" />
          <circle cx="11.5" cy="8" r="1.6" />
          <path d="M5 5.1 V10.9 M5 5.1 C5 7.5 7.5 8 9.9 8" />
        </>
      ) : null}
      {ring ? (
        <circle
          cx="8"
          cy="8"
          r="6"
          className={props.mark === "Spin" ? "ticket-run-track" : undefined}
        />
      ) : null}
      <TicketRunMarkPaths mark={props.mark} />
    </svg>
  );
}

/** A row's mark and tone: a run by its verdict, a landing by its state. */
export function ticketRunsRowMark(row: TicketRunsRow): {
  readonly mark: TicketRunMark;
  readonly tone: Tone;
} {
  switch (row.kind) {
    case "Run":
      return {
        mark: ticketRunMarkOf(row.verdict),
        tone: verdictTone(row.verdict),
      };
    case "Gap":
      return { mark: "Open", tone: "retired" };
    case "Landing":
      return row.landing === undefined
        ? { mark: "Open", tone: "retired" }
        : { mark: "Merge", tone: "finalization" };
  }
}

/** The ticket's runs as the Runs tab and the rail list them, newest first. */
export interface TicketRunsHeld {
  readonly cycles: readonly TicketRunsCycle[];
  /** How many executions the page holds where the route holds more. */
  readonly truncated: number | undefined;
}

/** The runs the page has read, named as the plan the ticket's configuration
 * selects names its stages, and none until the page of executions answers. */
export function useTicketRuns(
  held: TicketPageHeld,
): TicketRunsHeld | undefined {
  const ticket = readValue(held.reads.ticketState);
  const revision = ticket?.configurationRevision ?? "";
  const configuration = usePanelState({
    ...configurationQuery(held.partition, revision),
    enabled: revision !== "",
  });
  const page = readValue(held.reads.pageState);
  if (page === undefined) return undefined;
  const program = held.facts.program ?? [];
  const ledger = ticketLedger(page, program);
  return {
    cycles: ticketRunsOf(
      ledger,
      ticketLandingsJoined(
        ticketLandingsHeld(held.reads.landingsState),
        ledger.cycles.map((cycle) => cycle.ordinal),
      ),
      {
        names: ticketRunsNamesOf(
          readValue(configuration)?.canonical,
          ticket?.selection,
        ),
        stageCount: program.length,
      },
    ),
    truncated: ledger.truncated ? ledger.spend.executions : undefined,
  };
}

/** Why a run ended without a result, in its worker's words. */
function TicketRunReasonLine(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
}): ReactNode {
  return useRunReason(props.partition, props.execution, props.attempt)?.line;
}

/** A run's one line: its worker's reason where it left one, the pool's where
 * one refused it, and otherwise the opening of its result's report. */
export function TicketRunLineOf(props: {
  readonly partition: PartitionIdentity;
  readonly read: ExecutionResponse;
}): ReactNode {
  const read = props.read;
  const reasoned = runReasonAttempt(read);
  if (reasoned !== undefined)
    return (
      <TicketRunReasonLine
        partition={props.partition}
        execution={read.execution}
        attempt={reasoned}
      />
    );
  return runRefusalOf(read)?.line ?? runResultLineOf(read)?.line;
}

/** The row's line, read under the key the run page reads its execution by. */
function TicketRunLine(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
}): ReactNode {
  const state = usePanelState(
    executionQuery(props.partition, props.execution, "Streamed"),
  );
  const read = readValue(state);
  return read === undefined ? null : (
    <TicketRunLineOf partition={props.partition} read={read} />
  );
}

type TicketRunsParams = PartitionIdentity & { readonly ticket: string };

/** A row's address: its run's page, or the ticket's landing. */
function TicketRunsRowLink(props: {
  readonly row: TicketRunsRow;
  readonly params: TicketRunsParams;
  readonly className: string;
  readonly current?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { row, params } = props;
  const current = props.current === true ? "page" : undefined;
  if (row.kind === "Run")
    return (
      <Link
        to="/$tenant/$project/tickets/$ticket/runs/$task"
        params={{ ...params, task: String(row.task) }}
        className={props.className}
        aria-current={current}
      >
        {props.children}
      </Link>
    );
  if (row.kind === "Landing")
    return (
      <Link
        to="/$tenant/$project/tickets/$ticket/landing"
        params={params}
        className={props.className}
        aria-current={current}
      >
        {props.children}
      </Link>
    );
  return <span className={props.className}>{props.children}</span>;
}

function TicketRunsRowDrawn(props: {
  readonly row: TicketRunsRow;
  readonly params: TicketRunsParams;
  readonly nowMs: number;
}): ReactNode {
  const { row, params } = props;
  const marked = ticketRunsRowMark(row);
  const spend =
    row.kind === "Run"
      ? spendFigures(
          row.execution.runTotals,
          row.execution.runTotals?.costBasis,
        )
      : undefined;
  return (
    <li data-superseded={row.kind === "Run" && row.superseded ? "" : undefined}>
      <TicketRunsRowLink row={row} params={params} className="ticket-runs-row">
        <TicketRunMarkDrawn mark={marked.mark} tone={marked.tone} />
        <span className="ticket-runs-name">{ticketRunsRowName(row)}</span>
        <span className="ticket-runs-line">
          {row.kind === "Run" ? (
            <TicketRunLine
              partition={params}
              execution={row.execution.execution}
            />
          ) : row.kind === "Gap" ? (
            row.words
          ) : (
            (row.landing?.word ?? "Not reached")
          )}
        </span>
        <span className="ticket-runs-time">
          {row.kind === "Run" ? (
            <Figure figure={spanRanFigure(row.span, props.nowMs)} />
          ) : null}
        </span>
        <span className="ticket-runs-cost">
          {spend === undefined ? null : <Figure figure={spend.cost} />}
        </span>
        {row.kind === "Gap" ? (
          <span />
        ) : (
          <Chevron className="ticket-runs-chevron" />
        )}
      </TicketRunsRowLink>
    </li>
  );
}

function TicketRunsCycleDrawn(props: {
  readonly cycle: TicketRunsCycle;
  readonly params: TicketRunsParams;
  readonly nowMs: number;
}): ReactNode {
  const cycle = props.cycle;
  const spend = spendFigures(cycle.spend.totals, cycle.spend.totals?.costBasis);
  return (
    <section
      className="ticket-runs-cycle"
      aria-label={cycleLabel(cycle.ordinal)}
    >
      <header className="ticket-runs-head">
        <h3>{cycleLabel(cycle.ordinal)}</h3>
        {cycle.standing === "Current" ? (
          <Pill tone="neutral">Current</Pill>
        ) : null}
        <span className="ticket-runs-outcome">{cycle.outcome}</span>
        <span className="ticket-runs-rollup">
          <Figure figure={spanRanFigure(cycle.span, props.nowMs)} />
          <i className="fig-sep" aria-hidden="true">
            ·
          </i>
          <Figure figure={spend.cost} />
        </span>
      </header>
      <ul className="ticket-runs-rows">
        {cycle.rows.map((row, index) => (
          <TicketRunsRowDrawn
            key={row.kind === "Run" ? row.task : `${row.kind}/${String(index)}`}
            row={row}
            params={props.params}
            nowMs={props.nowMs}
          />
        ))}
      </ul>
    </section>
  );
}

function TicketRunsBody(props: {
  readonly held: TicketPageHeld;
  readonly runs: TicketRunsHeld;
}): ReactNode {
  const { held, runs } = props;
  const params = { ...held.partition, ticket: String(held.ticket) };
  if (runs.cycles.length === 0) return <EmptyState label="Nothing has run" />;
  return (
    <div className="ticket-runs">
      {runs.truncated === undefined ? null : (
        <Notice
          tone="parked"
          inline
          detail={`Showing first ${String(runs.truncated)} executions`}
        />
      )}
      {runs.cycles.map((cycle) => (
        <TicketRunsCycleDrawn
          key={cycle.ordinal}
          cycle={cycle}
          params={params}
          nowMs={held.nowMs}
        />
      ))}
    </div>
  );
}

/** The Runs tab: every cycle newest first, every run a link to its page. */
export function TicketRunsList(props: {
  readonly held: TicketPageHeld;
}): ReactNode {
  const runs = useTicketRuns(props.held);
  return runs === undefined ? (
    <PanelUnready state={props.held.reads.pageState} />
  ) : (
    <TicketRunsBody held={props.held} runs={runs} />
  );
}

/** What the rail marks as the page the reader is on. */
export type TicketRunsRailCurrent =
  | { readonly at: "Run"; readonly task: number }
  | { readonly at: "Landing"; readonly cycle: number | undefined };

function ticketRunsRailCurrent(
  cycle: number,
  row: TicketRunsRow,
  current: TicketRunsRailCurrent,
): boolean {
  return current.at === "Run"
    ? row.kind === "Run" && row.task === current.task
    : row.kind === "Landing" && cycle === current.cycle;
}

function TicketRailRow(props: {
  readonly row: TicketRunsRow;
  readonly params: TicketRunsParams;
  readonly current: boolean;
  readonly nowMs: number;
}): ReactNode {
  const row = props.row;
  const marked = ticketRunsRowMark(row);
  return (
    <li>
      <TicketRunsRowLink
        row={row}
        params={props.params}
        className="ticket-rail-row"
        current={props.current}
      >
        <TicketRunMarkDrawn mark={marked.mark} tone={marked.tone} />
        <span className="ticket-rail-name">{ticketRunsRowName(row)}</span>
        <span className="ticket-rail-time">
          {row.kind === "Run" ? (
            <Figure figure={spanRanFigure(row.span, props.nowMs)} />
          ) : null}
        </span>
      </TicketRunsRowLink>
    </li>
  );
}

/** The ticket's runs beside one of them, grouped by cycle, newest first. */
export function TicketRunsRail(props: {
  readonly held: TicketPageHeld;
  readonly runs: TicketRunsHeld;
  readonly current: TicketRunsRailCurrent;
}): ReactNode {
  const { held } = props;
  const params = { ...held.partition, ticket: String(held.ticket) };
  return (
    <nav aria-label="Runs" className="ticket-rail">
      {props.runs.cycles.map((cycle) => (
        <div key={cycle.ordinal} className="ticket-rail-cycle">
          <p className="ticket-rail-head">{cycleLabel(cycle.ordinal)}</p>
          <ul>
            {cycle.rows
              .filter((row) => row.kind !== "Gap")
              .map((row, index) => (
                <TicketRailRow
                  key={
                    row.kind === "Run" ? row.task : `landing/${String(index)}`
                  }
                  row={row}
                  params={params}
                  current={ticketRunsRailCurrent(
                    cycle.ordinal,
                    row,
                    props.current,
                  )}
                  nowMs={held.nowMs}
                />
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
