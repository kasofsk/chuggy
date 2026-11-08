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
import {
  executionQuery,
  ticketExecutionsQuery,
} from "../../core/executionQueries.ts";
import { spendFigures } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { runReasonAttempt, runRefusalOf } from "../../core/runReason.ts";
import { runResultLineOf } from "../../core/runResult.ts";
import {
  ticketLandingsHeld,
  ticketLandingsJoined,
} from "../../core/ticketLandings.ts";
import {
  cycleLabel,
  cycleStandingLabel,
  ticketLedger,
} from "../../core/ticketLedger.ts";
import type { CopyText } from "../../core/copy.ts";
import {
  ticketRunLandingMarked,
  ticketRunMarkOf,
  ticketRunsOf,
  ticketRunsRowName,
} from "../../core/ticketRuns.ts";
import type {
  TicketRunGap,
  TicketRunLanding,
  TicketRunMarked,
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
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";
import { TicketRunTime } from "./TicketRunTime.tsx";
import { readValue } from "./TicketPageHeld.tsx";
import type { TicketPageHeld } from "./TicketPageHeld.tsx";
import { useCopyText } from "../../copy/CopyProvider.tsx";

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

/** A row's mark and tone: a run by its verdict, a landing by its state, and
 * none for the landing of a ticket that lands nothing. */
export function ticketRunsRowMark(
  row: TicketRunsRow,
): TicketRunMarked | { readonly mark: undefined; readonly tone: Tone } {
  switch (row.kind) {
    case "Run":
      return {
        mark: ticketRunMarkOf(row.verdict),
        tone: verdictTone(row.verdict),
      };
    case "Gap":
      return { mark: "Open", tone: "retired" };
    case "Landing":
      if (!row.lands) return { mark: undefined, tone: "retired" };
      return row.landing === undefined
        ? { mark: "Open", tone: "retired" }
        : ticketRunLandingMarked(row.landing);
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
      { names: held.facts.plan.names, lands: held.facts.plan.lands },
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

/** A run's line, read under the key the run page reads its execution by. */
export function TicketRunLine(props: {
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

/** What a row that is not a run says: why it has none, or its landing's state. */
function ticketRunsRowWords(
  row: TicketRunGap | TicketRunLanding,
  text: CopyText,
): string {
  if (row.kind === "Gap") return row.words;
  if (!row.lands) return text({ id: "ticket-value-none" });
  return row.landing?.word ?? text({ id: "ticket-landing-not-reached" });
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
  if (row.kind === "Landing" && row.lands)
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
  const text = useCopyText();
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
          ) : (
            ticketRunsRowWords(row, text)
          )}
        </span>
        <span className="ticket-runs-time">
          {row.kind === "Run" ? (
            <TicketRunTime runs={[row.execution]} nowMs={props.nowMs} />
          ) : null}
        </span>
        <span className="ticket-runs-cost">
          {spend === undefined ? null : <Figure figure={spend.cost} />}
        </span>
        {row.kind === "Gap" || (row.kind === "Landing" && !row.lands) ? (
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
  const text = useCopyText();
  const standingLabel = cycleStandingLabel(cycle.standing);
  return (
    <section
      className="ticket-runs-cycle"
      aria-label={cycleLabel(cycle.ordinal)}
    >
      <header className="ticket-runs-head">
        <h3>{cycleLabel(cycle.ordinal)}</h3>
        {standingLabel === undefined ? null : (
          <Pill tone="neutral">{text(standingLabel)}</Pill>
        )}
        <span className="ticket-runs-outcome">{cycle.outcome}</span>
        <span className="ticket-runs-rollup">
          <TicketRunTime runs={cycle.executions} nowMs={props.nowMs} />
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
  const text = useCopyText();
  if (runs.cycles.length === 0)
    return <EmptyState label={text({ id: "ticket-nothing-has-run" })} />;
  return (
    <div className="ticket-runs">
      {runs.truncated === undefined ? null : (
        <Notice
          tone="parked"
          inline
          detail={text({
            id: "ticket-run-showing-first",
            args: {
              run: { id: "ticket-run-count", args: { count: runs.truncated } },
            },
          })}
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
            <TicketRunTime runs={[row.execution]} nowMs={props.nowMs} />
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
  const text = useCopyText();
  return (
    <nav aria-label={text({ id: "ticket-tab-runs" })} className="ticket-rail">
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
