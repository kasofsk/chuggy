/**
 * The ticket's executions as the machine's own structure: cycles newest first,
 * each holding the work run that produced an artifact and the program runs that
 * judged it.
 *
 * The current cycle is railed and open and the superseded ones are dimmed and
 * closed, because the question a reader opens this page with is about the
 * artifact the ticket holds now. A stage the program never reached is a row
 * saying so rather than a gap, which is the difference between "not reached"
 * and "not on this page" that a flat list cannot draw. Every figure is
 * `core/figures.ts`'s and every sum `runTotals.ts`'s, so nothing here counts;
 * the fabric's own relaunches are a note on the row and are not the cycle's
 * rework.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../../src/contract/responses.ts";
import { apiExecutions } from "../../core/apiRoutes.ts";
import { spanFigure, spendFigures, whenFigure } from "../../core/figures.ts";
import type { Spend } from "../../core/figures.ts";
import { executionRequirementLabel } from "../../core/labels.ts";
import { projectListFolded } from "../../core/projectQueryKeys.ts";
import type { ProjectListChange } from "../../core/projectQueryKeys.ts";
import { runSpendOf } from "../../core/runTotals.ts";
import { ticketExecutionsFolded } from "../../core/ticketExecutions.ts";
import type {
  Cycle,
  Ledger as LedgerFacts,
  ProgramRun,
  SetVerdict,
  StageRow,
  TaskSet,
  TicketAuthoring,
} from "../../core/ticketLedger.ts";
import {
  cycleLabel,
  cycleLastSet,
  retriesLabel,
  stageLabel,
  ticketLedger,
} from "../../core/ticketLedger.ts";
import { stageArm, standingTone, verdictTone } from "../../core/tones.ts";
import { usePanelList } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { ExecutionDetail } from "../TicketExecutions.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Ledger, LedgerBlock, LedgerGroup, LedgerRow } from "../ui/Ledger.tsx";

/** What a set spent, over however many of its tasks carry figures at all. */
function setSpend(set: TaskSet): Spend {
  const spend = runSpendOf(set.executions);
  return spendFigures(spend.totals, spend.totals?.costBasis);
}

/**
 * What the fabric did below this set, which is every relaunch of every task in
 * it and not the first task's alone.
 */
function setRelaunches(set: TaskSet): string | undefined {
  return retriesLabel(
    set.executions.reduce((held, row) => held + row.retriesSpent, 0),
  );
}

/**
 * How much of a set this page holds, kept out of the note so that a row which
 * is superseded, relaunched and short at once still draws two strings a reader
 * can scan rather than one past the copy budget.
 */
function setShortfall(set: TaskSet): string | undefined {
  return set.executions.length < set.expected
    ? `${String(set.executions.length)} of ${String(set.expected)} tasks on this page`
    : undefined;
}

/** A set's row note: where its artifact stands, and what the fabric did to it. */
function setNotes(set: TaskSet, standing: string | undefined): string {
  return [standing, setRelaunches(set)]
    .flatMap((note) => (note === undefined ? [] : [note]))
    .join(" · ");
}

function SetRowNote(props: {
  readonly set: TaskSet;
  readonly standing: string | undefined;
}): ReactNode {
  const shortfall = setShortfall(props.set);
  return (
    <>
      {setNotes(props.set, props.standing)}
      {shortfall === undefined ? null : (
        <span className="ledger-partial"> {shortfall}</span>
      )}
    </>
  );
}

interface RowChrome {
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly opened: string | undefined;
  readonly onToggle: (execution: string) => void;
}

function SetRow(props: {
  readonly chrome: RowChrome;
  readonly label: string;
  readonly set: TaskSet;
  readonly standing?: string;
}): ReactNode {
  const first = props.set.executions[0];
  const pill = {
    tone: verdictTone(props.set.verdict),
    text: props.set.verdict,
  };
  if (first === undefined)
    return <LedgerRow label={props.label} pill={pill} ghost />;
  const open = props.chrome.opened === first.execution;
  return (
    <LedgerRow
      label={props.label}
      identity={executionRequirementLabel(first)}
      pill={pill}
      when={whenFigure(
        props.set.span.from ?? first.registeredAt,
        props.set.span.to,
        props.chrome.nowMs,
      )}
      spent={setSpend(props.set)}
      note={<SetRowNote set={props.set} standing={props.standing} />}
      expand={{
        open,
        onToggle: () => {
          props.chrome.onToggle(first.execution);
        },
        children: (
          <ExecutionDetail
            partition={props.chrome.partition}
            execution={first.execution}
          />
        ),
      }}
    />
  );
}

function StageLine(props: {
  readonly chrome: RowChrome;
  readonly row: StageRow;
  readonly stageCount: number;
}): ReactNode {
  const label = stageLabel(props.row.stage, props.stageCount);
  const arm = stageArm(props.row);
  if (props.row.kind !== "Ran")
    return (
      <LedgerRow
        label={label}
        pill={{ tone: arm.tone, text: arm.word }}
        ghost
        note={props.row.kind === "Missing" ? "Not on this page" : undefined}
      />
    );
  return <SetRow chrome={props.chrome} label={label} set={props.row.set} />;
}

/** A run after the first inside one cycle is what a charged resume started. */
export function programRunEyebrow(run: ProgramRun, runs: number): string {
  if (runs === 1) return "Evaluation";
  const named = `Evaluation · run ${String(run.ordinal)}`;
  return run.ordinal === 1 ? named : `${named} · after resume`;
}

function ProgramRunBlock(props: {
  readonly chrome: RowChrome;
  readonly run: ProgramRun;
  readonly runs: number;
  readonly stageCount: number;
}): ReactNode {
  return (
    <LedgerBlock
      eyebrow={programRunEyebrow(props.run, props.runs)}
      pill={
        props.runs === 1
          ? undefined
          : {
              tone: standingTone(props.run.standing),
              text: props.run.standing,
            }
      }
    >
      {props.run.stages.map((row) => (
        <StageLine
          key={`${String(props.run.ordinal)}/${String(row.stage)}`}
          chrome={props.chrome}
          row={row}
          stageCount={props.stageCount}
        />
      ))}
    </LedgerBlock>
  );
}

/** What the cycle's work left behind, which is the note its work row carries. */
export function cycleArtifactNote(cycle: Cycle, cycles: number): string {
  switch (cycle.artifact) {
    case "Unknown":
      return "Work not on this page";
    case "None":
      return "No artifact";
    case "Produced":
      return cycle.standing === "Current"
        ? "Current artifact"
        : `Superseded by ${cycleLabel(Math.min(cycle.ordinal + 1, cycles)).toLowerCase()}`;
  }
}

/** The cycle in two fragments: what its work did, and what judged the artifact. */
export function cycleSummary(cycle: Cycle, stageCount: number): string {
  const work =
    cycle.work === undefined
      ? "Work not on this page"
      : `Work ${cycle.work.verdict.toLowerCase()}`;
  const last = cycleLastSet(cycle);
  if (last === undefined || last.taskKind !== "Evaluation") return work;
  const named =
    last.stage === undefined
      ? "Evaluation"
      : stageLabel(last.stage, stageCount);
  return `${work} · ${named} ${last.verdict.toLowerCase()}`;
}

function CycleRollup(props: {
  readonly cycle: Cycle;
  readonly nowMs: number;
}): ReactNode {
  const spend = spendFigures(
    props.cycle.spend.totals,
    props.cycle.spend.totals?.costBasis,
  );
  return (
    <>
      <Figure figure={spanFigure(props.cycle.span, props.nowMs)} />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure figure={spend.cost} />
      <i className="fig-sep" aria-hidden="true">
        ·
      </i>
      <Figure figure={spend.tokens} />
      {props.cycle.complete ? null : (
        <span className="ledger-partial"> Cycle partly on this page</span>
      )}
    </>
  );
}

function CycleGroup(props: {
  readonly chrome: RowChrome;
  readonly cycle: Cycle;
  readonly cycles: number;
  readonly stageCount: number;
}): ReactNode {
  const cycle = props.cycle;
  return (
    <LedgerGroup
      title={cycleLabel(cycle.ordinal)}
      standing={cycle.standing}
      summary={cycleSummary(cycle, props.stageCount)}
      rollup={<CycleRollup cycle={cycle} nowMs={props.chrome.nowMs} />}
      open={cycle.standing === "Current"}
    >
      <LedgerBlock>
        {cycle.work === undefined ? (
          <LedgerRow
            label="Work"
            pill={{ tone: "parked", text: "Missing" }}
            ghost
            note="Not on this page"
          />
        ) : (
          <SetRow
            chrome={props.chrome}
            label="Work"
            set={cycle.work}
            standing={cycleArtifactNote(cycle, props.cycles)}
          />
        )}
      </LedgerBlock>
      {cycle.programRuns.map((run) => (
        <ProgramRunBlock
          key={run.ordinal}
          chrome={props.chrome}
          run={run}
          runs={cycle.programRuns.length}
          stageCount={props.stageCount}
        />
      ))}
    </LedgerGroup>
  );
}

/** Newest first, which is the order a reader asks the ledger its question in. */
export function TicketCycles(props: {
  readonly chrome: RowChrome;
  readonly facts: LedgerFacts;
  readonly stageCount: number;
}): ReactNode {
  const cycles = [...props.facts.cycles].reverse();
  if (cycles.length === 0) return <EmptyState label="Nothing has run" />;
  return (
    <Ledger
      truncated={
        props.facts.truncated
          ? `Showing first ${String(props.facts.spend.executions)} executions`
          : undefined
      }
    >
      {cycles.map((cycle) => (
        <CycleGroup
          key={cycle.ordinal}
          chrome={props.chrome}
          cycle={cycle}
          cycles={props.facts.cycles.length}
          stageCount={props.stageCount}
        />
      ))}
    </Ledger>
  );
}

/** One execution read on its own, which is a set of one and settles like one. */
export function summaryVerdict(summary: ExecutionSummary): SetVerdict {
  if (summary.status === "Cancelled") return "Cancelled";
  if (summary.status !== "Terminal") return "Running";
  switch (summary.outcome) {
    case "Passed":
      return "Passed";
    case "Blocked":
      return "Blocked";
    case "Failed":
    case undefined:
      return "Failed";
  }
}

function ungroupedLabel(summary: ExecutionSummary): string {
  return summary.taskKind === "Work" || summary.stage === undefined
    ? "Work"
    : `Stage ${String(summary.stage + 1)}`;
}

/**
 * The page in task order when the draft has not arrived. Without the authoring
 * there is no program to group by, so the rows say they are ungrouped rather
 * than being drawn in a structure nothing supports.
 */
export function UngroupedRows(props: {
  readonly chrome: RowChrome;
  readonly page: ExecutionsResponse;
}): ReactNode {
  const ordered = [...props.page.executions].sort(
    (left, right) => left.task - right.task,
  );
  if (ordered.length === 0) return <EmptyState label="Nothing has run" />;
  return (
    <Ledger>
      <LedgerBlock eyebrow="Ungrouped · program not loaded">
        {ordered.map((summary) => (
          <SetRow
            key={summary.execution}
            chrome={props.chrome}
            label={ungroupedLabel(summary)}
            set={{
              executions: [summary],
              expected: 1,
              verdict: summaryVerdict(summary),
              span: { from: summary.registeredAt, to: summary.terminalAt },
            }}
          />
        ))}
      </LedgerBlock>
    </Ledger>
  );
}

/**
 * The page of executions this ticket's route answers with, read once here and
 * handed to whatever draws it. It is the read `TicketExecutions` held, with the
 * same key and the same fold, so a live frame still lands in it.
 */
export function useTicketExecutions(
  partition: PartitionIdentity,
  ticket: number,
): ReturnType<typeof usePanelList<ExecutionsResponse>> {
  const fold = useCallback(
    (previous: ExecutionsResponse | undefined, change: ProjectListChange) =>
      ticketExecutionsFolded(ticket, previous, change),
    [ticket],
  );
  return usePanelList(
    projectListFolded(partition, "Execution", `ticket:${String(ticket)}`, fold),
    (ports) => apiExecutions(ports, partition, { ticket }),
  );
}

/** One row is open at a time, which is the state the whole ledger shares. */
function TicketRows(props: {
  readonly partition: PartitionIdentity;
  readonly page: ExecutionsResponse;
  readonly authoring: TicketAuthoring | undefined;
  readonly nowMs: number;
}): ReactNode {
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const chrome: RowChrome = {
    partition: props.partition,
    nowMs: props.nowMs,
    opened,
    onToggle: (execution) => {
      setOpened(opened === execution ? undefined : execution);
    },
  };
  const authoring = props.authoring;
  if (authoring === undefined)
    return <UngroupedRows chrome={chrome} page={props.page} />;
  return (
    <TicketCycles
      chrome={chrome}
      facts={ticketLedger(props.page, authoring)}
      stageCount={authoring.program.length}
    />
  );
}

export function TicketLedgerPanel(props: {
  readonly partition: PartitionIdentity;
  readonly page: ReturnType<typeof usePanelList<ExecutionsResponse>>;
  readonly authoring: TicketAuthoring | undefined;
  readonly nowMs: number;
}): ReactNode {
  return (
    <DataPanel title="Cycles" state={props.page}>
      {(page) => (
        <TicketRows
          partition={props.partition}
          page={page}
          authoring={props.authoring}
          nowMs={props.nowMs}
        />
      )}
    </DataPanel>
  );
}
