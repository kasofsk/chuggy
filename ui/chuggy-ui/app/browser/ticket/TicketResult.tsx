/**
 * What a ledger row's result expander opens: the report, or the commands a
 * command stage ran.
 *
 * Each reads its output only once it is mounted, which is when its expander is
 * opened, and under the key the details' preview reads the same output by. An
 * output that is refused, or is not what its renderer says it is, draws the
 * result's report instead, so a reader is never left with less than the row's
 * line already promised.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { OutputContentResponse } from "../../../../../src/contract/responses.ts";
import { apiOutputContent } from "../../core/apiRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { runResultCommandsOf } from "../../core/runResult.ts";
import type { RunCommand, RunResultOpened } from "../../core/runResult.ts";
import { runCommandTone } from "../../core/tones.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Pill } from "../ui/Pill.tsx";

/** One output of one execution, read as the details' preview reads it. */
function useRunResultOutput(
  partition: PartitionIdentity,
  execution: string,
  ordinal: number,
): PanelState<OutputContentResponse> {
  return usePanelResource(
    partition,
    "Execution",
    `${execution}/artifacts/${String(ordinal)}`,
    (ports) => apiOutputContent(ports, partition, execution, ordinal),
  );
}

/** The output's text where it was read as text, and none where it was refused. */
function runResultText(
  state: PanelState<OutputContentResponse>,
): string | undefined {
  return state.state === "Ready" && state.value.encoding === "Utf8"
    ? state.value.content
    : undefined;
}

function RunResultReportText(props: {
  readonly report: string | undefined;
}): ReactNode {
  return props.report === undefined ? (
    <p className="panel-note">No report</p>
  ) : (
    <MarkdownReport text={props.report} />
  );
}

function RunResultSummary(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly summary: number;
  readonly report: string;
}): ReactNode {
  const state = useRunResultOutput(
    props.partition,
    props.execution,
    props.summary,
  );
  if (state.state === "Pending") return <PanelUnready state={state} />;
  return <MarkdownReport text={runResultText(state) ?? props.report} />;
}

function RunResultCommand(props: {
  readonly command: RunCommand;
  readonly report: string | undefined;
  readonly last: boolean;
}): ReactNode {
  const command = props.command;
  const [shown, setShown] = useState(command.open);
  const ended = command.truncated && props.last ? props.report : undefined;
  return (
    <li className="flex flex-wrap items-baseline gap-2" data-end={command.end}>
      <Pill tone={runCommandTone(command.end)}>{command.end}</Pill>
      <Disclosure
        open={shown}
        onOpenChange={setShown}
        label={<code>{command.command}</code>}
        look={{ variant: "quiet", size: "sm" }}
      >
        <div className="basis-full grid gap-2">
          <pre className="preview">{command.output}</pre>
          {command.truncated ? (
            <p className="text-ink-3 text-xs">End cut</p>
          ) : null}
          {ended === undefined ? null : (
            <p className="text-ink-2 text-sm whitespace-pre-wrap wrap-anywhere">
              {ended}
            </p>
          )}
        </div>
      </Disclosure>
    </li>
  );
}

function RunResultCommands(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly commands: number;
  readonly report: string | undefined;
}): ReactNode {
  const state = useRunResultOutput(
    props.partition,
    props.execution,
    props.commands,
  );
  if (state.state === "Pending") return <PanelUnready state={state} />;
  const text = runResultText(state);
  const commands = text === undefined ? undefined : runResultCommandsOf(text);
  if (commands === undefined)
    return <RunResultReportText report={props.report} />;
  return (
    <ul className="grid gap-2">
      {commands.map((command, index) => (
        <RunResultCommand
          key={index}
          command={command}
          report={props.report}
          last={index === commands.length - 1}
        />
      ))}
    </ul>
  );
}

/** The body of a row's result expander, as `runResultOpenedOf` chose it. */
export function RunResultOpenedBody(props: {
  readonly partition: PartitionIdentity;
  readonly execution: string;
  readonly opened: RunResultOpened;
}): ReactNode {
  const opened = props.opened;
  return (
    <div className="grid gap-2 px-4 py-2">
      {opened.opened === "Commands" ? (
        <RunResultCommands
          partition={props.partition}
          execution={props.execution}
          commands={opened.commands}
          report={opened.report}
        />
      ) : opened.summary === undefined ? (
        <MarkdownReport text={opened.report} />
      ) : (
        <RunResultSummary
          partition={props.partition}
          execution={props.execution}
          summary={opened.summary}
          report={opened.report}
        />
      )}
    </div>
  );
}
