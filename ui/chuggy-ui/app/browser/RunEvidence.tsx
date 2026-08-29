/**
 * What one run did: the summary it recorded, what it spent turn by turn, the
 * configuration it was given, and the transcript of its steps.
 *
 * Every pane hangs off the attempt that produced it, because the attempt is the
 * run; an attempt from a worker that wrote no evidence draws that as itself
 * rather than as an empty panel. The turns and the configuration are read only
 * when a reader opens them, so an expanded execution costs the reads it shows.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  RunTurnsResponse,
} from "../../../../src/contract/responses.ts";
import { apiRunConfiguration, apiRunTurns } from "../core/apiRoutes.ts";
import {
  runConfigurationArgvSentence,
  runConfigurationCapabilitiesSentence,
  runConfigurationFileSentence,
  runConfigurationHead,
  runConfigurationOmittedSentence,
  runConfigurationOrdered,
  runConfigurationRead,
  runConfigurationSourceSentence,
} from "../core/runConfiguration.ts";
import type { RunConfigurationFile } from "../core/runConfiguration.ts";
import { runSummaryOf } from "../core/runSummary.ts";
import {
  runCostLabel,
  runCountLabel,
  runDurationLabel,
} from "../core/runTotals.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { usePanelQuery } from "./api.ts";
import { MarkdownReport } from "./MarkdownReport.tsx";
import { Panel } from "./Panel.tsx";
import { RunTranscript } from "./RunTranscript.tsx";

/** The most turn pages one reader may walk through in one sitting. */
export const runTurnPagesMax = 32;

type ExecutionAttempt = ExecutionResponse["attempts"][number];
type RunTotalsValue = NonNullable<
  NonNullable<ExecutionAttempt["run"]>["totals"]
>;

function attemptKey(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  read: string,
): ProjectQueryKey {
  return projectResourceKey(
    partition,
    "Execution",
    `${execution}/attempts/${attempt}/${read}`,
  );
}

export function RunTotalsLine(props: {
  readonly totals: RunTotalsValue;
}): ReactNode {
  const totals = props.totals;
  return (
    <p className="run-totals">
      <span className="run-cost">
        {runCostLabel(totals.costUsdMicros, totals.costBasis)}
      </span>
      <span className="run-tokens">
        {runCountLabel(totals.tokensInput)} in,{" "}
        {runCountLabel(totals.tokensOutput)} out,{" "}
        {runCountLabel(totals.tokensCacheCreation)} cache written,{" "}
        {runCountLabel(totals.tokensCacheRead)} cache read
      </span>
      <span className="run-turns">{runCountLabel(totals.turns)} turns</span>
      <span className="run-duration">
        {runDurationLabel(totals.durationMs)}
      </span>
    </p>
  );
}

function RunTurnRows(props: { readonly page: RunTurnsResponse }): ReactNode {
  return (
    <table className="turns">
      <thead>
        <tr>
          <th>turn</th>
          <th>model</th>
          <th>in</th>
          <th>out</th>
          <th>cache written</th>
          <th>cache read</th>
          <th>recorded</th>
        </tr>
      </thead>
      <tbody>
        {props.page.turns.map((turn) => (
          <tr key={turn.ordinal}>
            <td>{turn.ordinal}</td>
            <td>{turn.model}</td>
            <td>{runCountLabel(turn.tokensInput)}</td>
            <td>{runCountLabel(turn.tokensOutput)}</td>
            <td>{runCountLabel(turn.tokensCacheCreation)}</td>
            <td>{runCountLabel(turn.tokensCacheRead)}</td>
            <td>{turn.recordedAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunTurns(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
}): ReactNode {
  const [walked, setWalked] = useState<readonly number[]>([]);
  const after = walked.at(-1);
  const state = usePanelQuery(
    attemptKey(
      props.partition,
      props.execution,
      props.attempt,
      `turns/${String(after ?? 0)}`,
    ),
    (ports) =>
      apiRunTurns(ports, props.partition, props.execution, props.attempt, {
        after,
      }),
  );
  return (
    <Panel title="turns" state={state}>
      {(page) => (
        <div className="run-turn-pages">
          {page.turns.length === 0 ? (
            <p className="panel-note">no turn was recorded for this run</p>
          ) : (
            <RunTurnRows page={page} />
          )}
          <div className="actions">
            <button
              type="button"
              disabled={walked.length === 0}
              onClick={() => {
                setWalked(walked.slice(0, -1));
              }}
            >
              earlier
            </button>
            <button
              type="button"
              disabled={
                page.nextAfter === undefined || walked.length >= runTurnPagesMax
              }
              onClick={() => {
                if (page.nextAfter !== undefined)
                  setWalked([...walked, page.nextAfter]);
              }}
            >
              later
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function RunConfigurationFileRow(props: {
  readonly file: RunConfigurationFile;
}): ReactNode {
  const [shown, setShown] = useState(false);
  const file = props.file;
  const sentence = runConfigurationFileSentence(file);
  return (
    <li className="configuration-file">
      <span className="artifact-role">
        {runConfigurationSourceSentence(file.source)}
      </span>
      <code>{file.path}</code>
      <span className="artifact-bytes">{runCountLabel(file.bytes)} bytes</span>
      {sentence === undefined ? null : (
        <span className="panel-absent">{sentence}</span>
      )}
      {file.content === undefined ? null : (
        <button
          type="button"
          aria-expanded={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? "hide" : "show"}
        </button>
      )}
      {shown && file.content !== undefined ? (
        <pre className="preview">{file.content}</pre>
      ) : null}
    </li>
  );
}

function RunConfigurationBody(props: { readonly content: string }): ReactNode {
  const reading = runConfigurationRead(props.content);
  if (reading.reading === "Unreadable")
    return <p className="panel-failed">could not be read — {reading.reason}</p>;
  const snapshot = reading.snapshot;
  const head = runConfigurationHead(snapshot);
  const argv = runConfigurationArgvSentence(snapshot);
  const omitted = runConfigurationOmittedSentence(snapshot);
  return (
    <div className="configuration">
      <dl className="fields">
        <div className="field">
          <dt>model</dt>
          <dd>{head.model ?? "none was reported"}</dd>
        </div>
        <div className="field">
          <dt>permission mode</dt>
          <dd>{head.permissionMode ?? "none was reported"}</dd>
        </div>
        <div className="field">
          <dt>working directory</dt>
          <dd>{head.cwd ?? "none was reported"}</dd>
        </div>
        <div className="field">
          <dt>tools and skills</dt>
          <dd>{runConfigurationCapabilitiesSentence(head)}</dd>
        </div>
        <div className="field">
          <dt>command line</dt>
          <dd>
            {argv ?? <code className="argv">{snapshot.argv.join(" ")}</code>}
          </dd>
        </div>
      </dl>
      <ul className="artifacts">
        {runConfigurationOrdered(snapshot.files).map((file) => (
          <RunConfigurationFileRow key={`kept/${file.path}`} file={file} />
        ))}
        {runConfigurationOrdered(snapshot.dropped).map((file) => (
          <RunConfigurationFileRow key={`dropped/${file.path}`} file={file} />
        ))}
      </ul>
      {omitted === undefined ? null : <p className="panel-absent">{omitted}</p>}
    </div>
  );
}

function RunConfiguration(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: string;
}): ReactNode {
  const state = usePanelQuery(
    attemptKey(
      props.partition,
      props.execution,
      props.attempt,
      "configuration",
    ),
    (ports) =>
      apiRunConfiguration(
        ports,
        props.partition,
        props.execution,
        props.attempt,
      ),
  );
  return (
    <Panel title="configuration" state={state}>
      {(read) => <RunConfigurationBody content={read.content} />}
    </Panel>
  );
}

function RunSummary(props: {
  readonly attempt: ExecutionAttempt;
  readonly result: ExecutionResponse["result"];
}): ReactNode {
  const summary = runSummaryOf(props.attempt, props.result);
  return summary.summary === "Report" ? (
    <MarkdownReport text={summary.report} />
  ) : (
    <p className="panel-note">{summary.sentence}</p>
  );
}

function RunEvidenceReads(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly attempt: ExecutionAttempt;
}): ReactNode {
  const [turns, setTurns] = useState(false);
  const [configuration, setConfiguration] = useState(false);
  const run = props.attempt.run;
  if (run === undefined)
    return (
      <p className="panel-note">
        this attempt recorded no run evidence — the worker that ran it wrote
        none
      </p>
    );
  return (
    <div className="run-reads">
      {run.totals === undefined ? (
        <p className="panel-note">this run recorded no figures</p>
      ) : (
        <RunTotalsLine totals={run.totals} />
      )}
      <div className="actions">
        <button
          type="button"
          aria-expanded={turns}
          onClick={() => {
            setTurns(!turns);
          }}
        >
          {turns ? "hide turns" : `turns (${runCountLabel(run.turnsRecorded)})`}
        </button>
        <button
          type="button"
          aria-expanded={configuration}
          disabled={run.configuration === undefined}
          onClick={() => {
            setConfiguration(!configuration);
          }}
        >
          {configuration ? "hide configuration" : "configuration"}
        </button>
      </div>
      {turns ? (
        <RunTurns
          partition={props.partition}
          execution={props.execution}
          attempt={props.attempt.attempt}
        />
      ) : null}
      {configuration && run.configuration !== undefined ? (
        <RunConfiguration
          partition={props.partition}
          execution={props.execution}
          attempt={props.attempt.attempt}
        />
      ) : null}
      {run.transcript === undefined ? (
        <p className="panel-note">no transcript was recorded for this run</p>
      ) : (
        <RunTranscript
          partition={props.partition}
          execution={props.execution}
          attempt={props.attempt.attempt}
          highWaterBatch={run.transcript.highWaterBatch}
        />
      )}
    </div>
  );
}

function RunAttempt(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionResponse;
  readonly attempt: ExecutionAttempt;
}): ReactNode {
  const attempt = props.attempt;
  return (
    <li className="run" data-attempt={attempt.attempt}>
      <p className="run-head">
        <span className="run-number">run {attempt.number}</span>
        <span className="run-state">{attempt.state}</span>
        <span className="execution-source">opened {attempt.openedAt}</span>
      </p>
      <RunSummary attempt={attempt} result={props.execution.result} />
      <RunEvidenceReads
        partition={props.partition}
        execution={props.execution.execution}
        attempt={attempt}
      />
    </li>
  );
}

/** Every run this execution took, newest last, as the attempts the wire lists. */
export function RunEvidence(props: {
  readonly partition: PartitionIdentity;
  readonly execution: ExecutionResponse;
}): ReactNode {
  const attempts = props.execution.attempts;
  return attempts.length === 0 ? (
    <p className="panel-note">nothing has run for this execution yet</p>
  ) : (
    <ul className="runs">
      {attempts.map((attempt) => (
        <RunAttempt
          key={attempt.attempt}
          partition={props.partition}
          execution={props.execution}
          attempt={attempt}
        />
      ))}
    </ul>
  );
}
