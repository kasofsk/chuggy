/**
 * The ticket's executions as the machine's own structure: cycles newest first,
 * each holding the work run that produced an artifact and the stages that
 * judged it, an evaluator drawn at every generation it has reached.
 *
 * The current cycle is railed and open and the superseded ones are dimmed and
 * closed, because the question a reader opens this page with is about the
 * artifact the ticket holds now. A stage the program never reached is a row
 * saying so rather than a gap, which is the difference between "not reached"
 * and "not on this page" that a flat list cannot draw. Every figure is
 * `core/figures.ts`'s and every sum `runTotals.ts`'s, so nothing here counts;
 * the fabric's own relaunches are a note on the row and are not the cycle's
 * rework. An evaluator a stage resumed draws its earlier generation too,
 * dimmed and beneath the one that replaced it, so what a reader sums over the
 * rows never falls short of the cycle's own rollup beside them.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../../src/contract/responses.ts";
import { apiExecution, apiExecutions } from "../../core/apiRoutes.ts";
import { spanFigure, spendFigures, whenFigure } from "../../core/figures.ts";
import type { Spend } from "../../core/figures.ts";
import { executionRequirementLabel } from "../../core/labels.ts";
import { projectListFolded } from "../../core/projectQueryKeys.ts";
import type { ProjectListChange } from "../../core/projectQueryKeys.ts";
import { runReasonAttempt } from "../../core/runReason.ts";
import { runResultLineOf, runResultOpenedOf } from "../../core/runResult.ts";
import { generationLabel, runSpendOf } from "../../core/runTotals.ts";
import { runTranscriptAttempt } from "../../core/runTranscript.ts";
import {
  ticketLandingOpened,
  ticketLandingsHeld,
  ticketLandingsJoined,
  ticketLandingSummary,
} from "../../core/ticketLandings.ts";
import type {
  TicketLanding,
  TicketLandingsJoined,
  TicketLandingsState,
} from "../../core/ticketLandings.ts";
import { ticketExecutionsFolded } from "../../core/ticketExecutions.ts";
import type {
  Cycle,
  EvaluatorRow,
  Ledger as LedgerFacts,
  RanStage,
  StageRow,
  TaskSet,
  TicketProgram,
} from "../../core/ticketLedger.ts";
import {
  cycleLabel,
  cycleLastSet,
  relaunchesLabel,
  setVerdict,
  stageEvaluatorsCurrent,
  stageLabel,
  ticketLedger,
} from "../../core/ticketLedger.ts";
import { stageArm, verdictTone } from "../../core/tones.ts";
import { usePanelList, usePanelResource } from "../api.ts";
import { DataPanel } from "../DataPanel.tsx";
import { useRunReason } from "../RunEvidence.tsx";
import { RunConversationFollowed } from "../RunTranscript.tsx";
import { ExecutionDetail } from "../TicketExecutions.tsx";
import { LandingBlock } from "./TicketLandings.tsx";
import { RunResultOpenedBody } from "./TicketResult.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import {
  Ledger,
  LedgerBlock,
  LedgerGroup,
  LedgerReason,
  LedgerRow,
} from "../ui/Ledger.tsx";
import type { LedgerRowExpand } from "../ui/Ledger.tsx";

/**
 * When the earliest task of a set first ran, which is what separates the wait
 * from the run. A set holding one task the wire carries no start for has none:
 * a queue time over part of a fan-out would be a figure about no whole thing.
 */
function setStartedAt(set: TaskSet): string | undefined {
  const started = set.executions.map((row) => row.startedAt);
  if (started.some((at) => at === undefined)) return undefined;
  return started
    .flatMap((at) => (at === undefined ? [] : [at]))
    .sort()
    .at(0);
}

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
  return relaunchesLabel(
    set.executions.reduce((held, row) => held + (row.relaunches ?? 0), 0),
  );
}

/**
 * How much of a work set this page holds, kept out of the note so that a row
 * which is superseded, relaunched and short at once still draws two strings a
 * reader can scan rather than one past the copy budget.
 */
function setShortfall(set: TaskSet): string | undefined {
  return set.executions.length < set.expected
    ? `${String(set.executions.length)} of ${String(set.expected)} tasks on this page`
    : undefined;
}

/**
 * How much of a stage's roster this page holds, drawn on the row of its last
 * evaluator so a stage which is short is still said once and not once per
 * evaluator it did hold.
 */
function stageShortfall(stage: RanStage): string | undefined {
  const current = stageEvaluatorsCurrent(stage).length;
  return current < stage.expected
    ? `${String(current)} of ${String(stage.expected)} evaluators on this page`
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
  readonly shortfall?: string | undefined;
  readonly opened?: string | undefined;
}): ReactNode {
  const shortfall = props.shortfall ?? setShortfall(props.set);
  return (
    <>
      {setNotes(props.set, props.standing)}
      {props.opened === undefined ? null : (
        <span className="text-tone-fail text-xs"> {props.opened}</span>
      )}
      {shortfall === undefined ? null : (
        <span className="text-tone-parked text-xs"> {shortfall}</span>
      )}
    </>
  );
}

/** What a row opens beneath itself: everything its run left, the run's
 * conversation alone, or its result whole. */
type RowDetail = "Details" | "Conversation" | "Report" | "Commands";

interface RowOpened {
  readonly execution: string;
  readonly detail: RowDetail;
}

interface RowChrome {
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
  readonly opened: RowOpened | undefined;
  readonly onToggle: (opened: RowOpened) => void;
}

interface SetRowProps {
  readonly chrome: RowChrome;
  readonly label: string;
  readonly set: TaskSet;
  readonly standing?: string;
  readonly shortfall?: string;
  /** Why the cycle this row's work opened exists, where a failed landing opened it. */
  readonly opened?: string | undefined;
  readonly superseded?: boolean;
}

function setRowExpand(
  chrome: RowChrome,
  execution: string,
  detail: RowDetail,
  hide: string,
  children: ReactNode,
): LedgerRowExpand {
  return {
    label: detail,
    hide,
    open:
      chrome.opened?.execution === execution && chrome.opened.detail === detail,
    onToggle: () => {
      chrome.onToggle({ execution, detail });
    },
    children,
  };
}

/** The result whole, as its report or as the commands a stage ran. */
function setRowResultExpands(
  chrome: RowChrome,
  execution: string,
  read: ExecutionResponse | undefined,
): readonly LedgerRowExpand[] {
  const opened = read === undefined ? undefined : runResultOpenedOf(read);
  if (opened === undefined) return [];
  return [
    setRowExpand(
      chrome,
      execution,
      opened.opened,
      opened.opened === "Commands" ? "Hide commands" : "Hide report",
      <RunResultOpenedBody
        partition={chrome.partition}
        execution={execution}
        opened={opened}
      />,
    ),
  ];
}

/** The row's expanders: the run's conversation, where one of its attempts
 * recorded a transcript, its result, and its details. */
function setRowExpands(
  chrome: RowChrome,
  execution: string,
  read: ExecutionResponse | undefined,
): readonly LedgerRowExpand[] {
  const { partition } = chrome;
  const attempt = read === undefined ? undefined : runTranscriptAttempt(read);
  return [
    ...(attempt === undefined
      ? []
      : [
          setRowExpand(
            chrome,
            execution,
            "Conversation",
            "Hide conversation",
            <RunConversationFollowed
              key={attempt.attempt}
              partition={partition}
              execution={execution}
              attempt={attempt}
              highWaterBatch={attempt.run.transcript.highWaterBatch}
            />,
          ),
        ]),
    ...setRowResultExpands(chrome, execution, read),
    setRowExpand(
      chrome,
      execution,
      "Details",
      "Hide",
      <ExecutionDetail
        partition={partition}
        execution={execution}
        nowMs={chrome.nowMs}
      />,
    ),
  ];
}

/** Why the row's run ended without a result, in its worker's words. */
function RunReasonLine(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
}): ReactNode {
  const reason = useRunReason(props.partition, props.execution, props.attempt);
  return reason === undefined ? null : (
    <LedgerReason line={reason.line} full={reason.full} />
  );
}

/** The line beneath a row: its worker's reason where it left one, and
 * otherwise the opening of its result's report. */
function SetRowReason(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly read: ExecutionResponse | undefined;
}): ReactNode {
  const read = props.read;
  if (read === undefined) return null;
  const reasoned = runReasonAttempt(read);
  if (reasoned !== undefined)
    return (
      <RunReasonLine
        partition={props.partition}
        execution={props.execution}
        attempt={reasoned}
      />
    );
  const line = runResultLineOf(read);
  return line === undefined ? null : (
    <LedgerReason line={line.line} full={line.full} />
  );
}

/** The execution is read under the key the details read it by. */
function SetRowRan(
  props: SetRowProps & { readonly first: ExecutionSummary },
): ReactNode {
  const first = props.first;
  const { partition } = props.chrome;
  const state = usePanelResource(
    partition,
    "Execution",
    first.execution,
    (ports) => apiExecution(ports, partition, first.execution),
  );
  const read = state.state === "Ready" ? state.value : undefined;
  return (
    <LedgerRow
      label={props.label}
      identity={executionRequirementLabel(first)}
      pill={{ tone: verdictTone(props.set.verdict), text: props.set.verdict }}
      when={whenFigure(
        {
          registeredAt: props.set.span.from ?? first.registeredAt,
          startedAt: setStartedAt(props.set),
          terminalAt: props.set.span.to,
        },
        props.chrome.nowMs,
      )}
      spent={setSpend(props.set)}
      note={
        <SetRowNote
          set={props.set}
          standing={props.standing}
          shortfall={props.shortfall}
          opened={props.opened}
        />
      }
      reason={
        <SetRowReason
          partition={partition}
          execution={first.execution}
          read={read}
        />
      }
      {...(props.superseded === undefined
        ? {}
        : { superseded: props.superseded })}
      expands={setRowExpands(props.chrome, first.execution, read)}
    />
  );
}

function SetRow(props: SetRowProps): ReactNode {
  const first = props.set.executions[0];
  if (first === undefined)
    return (
      <LedgerRow
        label={props.label}
        pill={{ tone: verdictTone(props.set.verdict), text: props.set.verdict }}
        ghost
      />
    );
  return <SetRowRan {...props} first={first} />;
}

/** An evaluator's own label: the stage, and its key where the stage names
 * more than one — a stage of one evaluator needs no key to tell its row apart. */
function evaluatorLabel(
  stage: number,
  stageCount: number,
  key: number,
  many: boolean,
): string {
  const label = stageLabel(stage, stageCount);
  return many ? `${label} · ${String(key)}` : label;
}

/** What an evaluator's row says of itself beyond its verdict: which
 * generation it stands at now, or that a later one replaced it. */
function evaluatorStanding(row: EvaluatorRow): string | undefined {
  return row.standing === "Superseded"
    ? "Superseded"
    : generationLabel(row.generation);
}

/** An evaluator's own row: which generation it names, and the roster's own
 * shortfall on the last current evaluator the page holds for the stage. */
function EvaluatorLine(props: {
  readonly chrome: RowChrome;
  readonly stage: RanStage;
  readonly row: EvaluatorRow;
  readonly last: boolean;
  readonly stageCount: number;
}): ReactNode {
  const many = stageEvaluatorsCurrent(props.stage).length > 1;
  const standing = evaluatorStanding(props.row);
  const shortfall = props.last ? stageShortfall(props.stage) : undefined;
  return (
    <SetRow
      chrome={props.chrome}
      label={evaluatorLabel(
        props.stage.stage,
        props.stageCount,
        props.row.key,
        many,
      )}
      set={props.row.set}
      superseded={props.row.standing === "Superseded"}
      {...(standing === undefined ? {} : { standing })}
      {...(shortfall === undefined ? {} : { shortfall })}
    />
  );
}

function StageLine(props: {
  readonly chrome: RowChrome;
  readonly row: StageRow;
  readonly stageCount: number;
}): ReactNode {
  if (props.row.kind !== "Ran") {
    const label = stageLabel(props.row.stage, props.stageCount);
    const arm = stageArm(props.row);
    return (
      <LedgerRow
        label={label}
        pill={{ tone: arm.tone, text: arm.word }}
        ghost
        note={props.row.kind === "Missing" ? "Not on this page" : undefined}
      />
    );
  }
  const stage = props.row;
  const lastCurrent = stage.evaluators.reduce(
    (held, row, index) => (row.standing === "Current" ? index : held),
    -1,
  );
  return (
    <>
      {stage.evaluators.map((row, index) => (
        <EvaluatorLine
          key={`${String(stage.stage)}/${String(row.key)}/${String(row.generation)}`}
          chrome={props.chrome}
          stage={stage}
          row={row}
          last={index === lastCurrent}
          stageCount={props.stageCount}
        />
      ))}
    </>
  );
}

/** What the cycle's work left behind, named by the cycle that superseded it. */
export function cycleArtifactNote(
  cycle: Cycle,
  supersededBy: number | undefined,
): string {
  switch (cycle.artifact) {
    case "Unknown":
      return "Work not on this page";
    case "None":
      return "No artifact";
    case "Produced":
      if (cycle.standing === "Current") return "Current artifact";
      return supersededBy === undefined
        ? "Superseded"
        : `Superseded by ${cycleLabel(supersededBy).toLowerCase()}`;
  }
}

/** What the cycle's work did and what judged the artifact. */
function cycleSummaryRan(cycle: Cycle, stageCount: number): string {
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

/** The cycle in fragments: what its work did, what judged the artifact, and
 * where its newest landing stands. */
export function cycleSummary(
  cycle: Cycle,
  stageCount: number,
  landing: TicketLanding | undefined,
): string {
  const ran = cycleSummaryRan(cycle, stageCount);
  return landing === undefined
    ? ran
    : `${ran} · ${ticketLandingSummary(landing)}`;
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
        <span className="text-tone-parked text-xs">
          {" "}
          Cycle partly on this page
        </span>
      )}
    </>
  );
}

function CycleGroup(props: {
  readonly chrome: RowChrome;
  readonly cycle: Cycle;
  readonly supersededBy: number | undefined;
  readonly stageCount: number;
  readonly landings: TicketLandingsJoined;
}): ReactNode {
  const cycle = props.cycle;
  const landings = props.landings.byCycle.get(cycle.ordinal) ?? [];
  return (
    <LedgerGroup
      title={cycleLabel(cycle.ordinal)}
      standing={cycle.standing}
      summary={cycleSummary(cycle, props.stageCount, landings.at(-1))}
      rollup={<CycleRollup cycle={cycle} nowMs={props.chrome.nowMs} />}
      open={cycle.standing === "Current"}
      lazy
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
            standing={cycleArtifactNote(cycle, props.supersededBy)}
            opened={ticketLandingOpened(props.landings, cycle.ordinal)}
          />
        )}
      </LedgerBlock>
      {cycle.stages.length === 0 ? null : (
        <LedgerBlock eyebrow="Evaluation">
          {cycle.stages.map((row) => (
            <StageLine
              key={row.stage}
              chrome={props.chrome}
              row={row}
              stageCount={props.stageCount}
            />
          ))}
        </LedgerBlock>
      )}
      <LandingBlock
        landings={landings}
        cycleNamed={false}
        nowMs={props.chrome.nowMs}
      />
    </LedgerGroup>
  );
}

/** Newest first, which is the order a reader asks the ledger its question in. */
export function TicketCycles(props: {
  readonly chrome: RowChrome;
  readonly facts: LedgerFacts;
  readonly stageCount: number;
  readonly landings: TicketLandingsJoined;
}): ReactNode {
  const cycles = [...props.facts.cycles].reverse();
  const unheld = (
    <LandingBlock
      landings={props.landings.unheld}
      cycleNamed
      nowMs={props.chrome.nowMs}
    />
  );
  if (cycles.length === 0)
    return props.landings.unheld.length === 0 ? (
      <EmptyState label="Nothing has run" />
    ) : (
      <Ledger>{unheld}</Ledger>
    );
  return (
    <Ledger
      truncated={
        props.facts.truncated
          ? `Showing first ${String(props.facts.spend.executions)} executions`
          : undefined
      }
    >
      {cycles.map((cycle, index) => (
        <CycleGroup
          key={cycle.ordinal}
          chrome={props.chrome}
          cycle={cycle}
          supersededBy={cycles[index - 1]?.ordinal}
          stageCount={props.stageCount}
          landings={props.landings}
        />
      ))}
      {unheld}
    </Ledger>
  );
}

function ungroupedLabel(summary: ExecutionSummary): string {
  return summary.identity.type === "WorkTask"
    ? "Work"
    : `Stage ${String(summary.identity.value.stage)}`;
}

/**
 * The page in task order when the ticket's read carries no program. Without
 * one there is nothing to group by, so the rows say they are ungrouped rather
 * than being drawn in a structure nothing supports.
 */
export function UngroupedRows(props: {
  readonly chrome: RowChrome;
  readonly page: ExecutionsResponse;
  readonly landings: readonly TicketLanding[];
}): ReactNode {
  const ordered = [...props.page.executions].sort(
    (left, right) => left.task - right.task,
  );
  const unheld = (
    <LandingBlock
      landings={props.landings}
      cycleNamed
      nowMs={props.chrome.nowMs}
    />
  );
  if (ordered.length === 0)
    return props.landings.length === 0 ? (
      <EmptyState label="Nothing has run" />
    ) : (
      <Ledger>{unheld}</Ledger>
    );
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
              verdict: setVerdict([summary]),
              span: { from: summary.registeredAt, to: summary.terminalAt },
            }}
          />
        ))}
      </LedgerBlock>
      {unheld}
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

/** One row's one detail is open at a time, which is the state the whole
 * ledger shares: pressing another replaces it. */
function TicketRows(props: {
  readonly partition: PartitionIdentity;
  readonly page: ExecutionsResponse;
  readonly program: TicketProgram | undefined;
  readonly landings: readonly TicketLanding[];
  readonly nowMs: number;
}): ReactNode {
  const [opened, setOpened] = useState<RowOpened | undefined>(undefined);
  const chrome: RowChrome = {
    partition: props.partition,
    nowMs: props.nowMs,
    opened,
    onToggle: (pressed) => {
      const again =
        opened?.execution === pressed.execution &&
        opened.detail === pressed.detail;
      setOpened(again ? undefined : pressed);
    },
  };
  const program = props.program;
  if (program === undefined)
    return (
      <UngroupedRows
        chrome={chrome}
        page={props.page}
        landings={props.landings}
      />
    );
  const facts = ticketLedger(props.page, program);
  return (
    <TicketCycles
      chrome={chrome}
      facts={facts}
      stageCount={program.length}
      landings={ticketLandingsJoined(
        props.landings,
        facts.cycles.map((cycle) => cycle.ordinal),
      )}
    />
  );
}

export function TicketLedgerPanel(props: {
  readonly partition: PartitionIdentity;
  readonly page: ReturnType<typeof usePanelList<ExecutionsResponse>>;
  readonly program: TicketProgram | undefined;
  readonly landings: TicketLandingsState;
  readonly nowMs: number;
}): ReactNode {
  return (
    <DataPanel title="Cycles" state={props.page}>
      {(page) => (
        <TicketRows
          partition={props.partition}
          page={page}
          program={props.program}
          landings={ticketLandingsHeld(props.landings)}
          nowMs={props.nowMs}
        />
      )}
    </DataPanel>
  );
}
