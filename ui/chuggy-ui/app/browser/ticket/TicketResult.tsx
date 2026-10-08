/**
 * What a ledger row's result expander opens: the report, or the commands a
 * command stage ran.
 *
 * Each reads its output only once it is mounted, which is when its expander is
 * opened, and under the key the details' preview reads the same output by. The
 * row holds that read without requesting it, so a stage's commands that are
 * refused or do not parse relabel its expander "Report" once the read answers.
 * A work summary that is refused draws the result's report instead.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ExecutionResponse,
  OutputContentResponse,
} from "../../../../../src/contract/responses.ts";
import { apiOutputContent } from "../../core/apiRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  runResultCommandsRead,
  runResultOpenedOf,
  runResultOpenedSettled,
} from "../../core/runResult.ts";
import type { RunCommand, RunResultOpened } from "../../core/runResult.ts";
import { runCommandTone } from "../../core/tones.ts";
import { usePanelResource, usePanelResourcesHeld } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { Pill } from "../ui/Pill.tsx";

function runResultOutputResource(execution: string, ordinal: number): string {
  return `${execution}/artifacts/${String(ordinal)}`;
}

/** One output of one execution, read as the details' preview reads it. */
function useRunResultOutput(
  partition: PartitionIdentity,
  execution: string,
  ordinal: number,
): PanelState<OutputContentResponse> {
  return usePanelResource(
    partition,
    "Execution",
    runResultOutputResource(execution, ordinal),
    (ports) => apiOutputContent(ports, partition, execution, ordinal),
  );
}

/** The row's result expander, as its listing chose it and as the read of a
 * stage's commands, where one was opened, has answered since. */
export function useRunResultOpened(
  partition: PartitionIdentity,
  execution: string,
  read: ExecutionResponse | undefined,
): RunResultOpened | undefined {
  const opened = read === undefined ? undefined : runResultOpenedOf(read);
  const commands = opened?.opened === "Commands" ? opened.commands : undefined;
  const [held] = usePanelResourcesHeld(
    partition,
    "Execution",
    commands === undefined
      ? []
      : [runResultOutputResource(execution, commands)],
    (_resource, ports) =>
      apiOutputContent(ports, partition, execution, commands ?? 0),
  );
  return opened === undefined
    ? undefined
    : runResultOpenedSettled(opened, held);
}

/** The output's text where it was read as text, and none where it was refused. */
function runResultText(
  state: PanelState<OutputContentResponse>,
): string | undefined {
  return state.state === "Ready" && state.value.encoding === "Utf8"
    ? state.value.content
    : undefined;
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
  const commands = runResultCommandsRead(state);
  if (commands === undefined) return null;
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
