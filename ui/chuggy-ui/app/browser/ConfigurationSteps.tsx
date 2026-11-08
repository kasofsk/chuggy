/**
 * What a ticket runs with, one row per step under a row per phase: who runs
 * it, its model and what the ticket overrode of it, each row opening onto its
 * details, its prompt and its YAML.
 *
 * What is drawn is `core/configurationSteps.ts`'s reading of the
 * configuration. Below the narrow breakpoint a row stacks its cells, so the
 * table never scrolls sideways.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { stringify } from "yaml";

import { useCopyText } from "../copy/CopyProvider.tsx";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy } from "../core/copy.ts";
import type {
  ConfigurationStepDetail,
  ConfigurationStepGroup,
  ConfigurationStepPhase,
  ConfigurationStepPrompt,
  ConfigurationStepRow,
  ConfigurationSteps,
} from "../core/configurationSteps.ts";
import { Disclosure } from "./ui/Disclosure.tsx";
import { MarkdownReport } from "./ui/MarkdownReport.tsx";

import "./ticket/ticket.css";

/** A definition as the YAML it is written in, or its JSON where YAML cannot
 * say it. */
function definitionYaml(definition: unknown): string {
  try {
    return stringify(definition);
  } catch {
    return JSON.stringify(definition, null, 2);
  }
}

function ConfigurationStepOverridden(props: {
  readonly overridden: boolean;
}): ReactNode {
  const text = useCopyText();
  return props.overridden ? (
    <span className="config-step-overridden">
      {` · ${text({ id: "configuration-steps-overridden" })}`}
    </span>
  ) : null;
}

function ConfigurationStepDetails(props: {
  readonly details: readonly ConfigurationStepDetail[];
}): ReactNode {
  const text = useCopyText();
  if (props.details.length === 0) return null;
  return (
    <dl className="config-step-details">
      {props.details.map((detail) => (
        <div key={detail.name.id} className="config-step-detail">
          <dt>{text(detail.name)}</dt>
          <dd>
            {(detail.lines.length === 0 ? [undefined] : detail.lines).map(
              (line, at, all) => (
                <span key={at}>
                  {line === undefined ? (
                    <span className="config-step-absent">—</span>
                  ) : detail.code ? (
                    <code>{copyOrDataText(text, line)}</code>
                  ) : (
                    copyOrDataText(text, line)
                  )}
                  {at === all.length - 1 ? (
                    <ConfigurationStepOverridden
                      overridden={detail.overridden}
                    />
                  ) : null}
                </span>
              ),
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ConfigurationStepPromptBody(props: {
  readonly prompt: readonly ConfigurationStepPrompt[];
}): ReactNode {
  const text = useCopyText();
  return props.prompt.map((part, at) => (
    <div key={at} className="config-step-prompt-part">
      {part.heading === undefined && !part.overridden ? null : (
        <h4 className="eyebrow">
          {copyOrDataText(
            text,
            part.heading ?? { id: "configuration-steps-prompt" },
          )}
          <ConfigurationStepOverridden overridden={part.overridden} />
        </h4>
      )}
      <MarkdownReport text={part.lines.join("\n\n")} bare />
    </div>
  ));
}

/** A row's prompt and its YAML, each behind a control of its own. */
function ConfigurationStepViews(props: {
  readonly row: ConfigurationStepRow;
}): ReactNode {
  const text = useCopyText();
  const [promptOpen, setPromptOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const { row } = props;
  if (row.prompt.length === 0 && row.definition === undefined) return null;
  return (
    <div className="config-step-views">
      {row.prompt.length === 0 ? null : (
        <Disclosure
          open={promptOpen}
          onOpenChange={setPromptOpen}
          label={text(
            promptOpen
              ? { id: "configuration-steps-prompt-hide" }
              : { id: "configuration-steps-prompt-view" },
          )}
          look={{ variant: "default", size: "sm" }}
        >
          <div className="config-step-prompt">
            <ConfigurationStepPromptBody prompt={row.prompt} />
          </div>
        </Disclosure>
      )}
      {row.definition === undefined ? null : (
        <Disclosure
          open={yamlOpen}
          onOpenChange={setYamlOpen}
          label={text({ id: "configuration-steps-yaml" })}
          look={{ variant: "default", size: "sm" }}
        >
          <pre className="ticket-config-canonical">
            {definitionYaml(row.definition)}
          </pre>
        </Disclosure>
      )}
    </div>
  );
}

/** The cells of one row, after the place its chevron stands in. */
function ConfigurationStepCells(props: {
  readonly row: ConfigurationStepRow;
}): ReactNode {
  const text = useCopyText();
  const { row } = props;
  const runs = row.runs;
  return (
    <>
      <span className="config-step-name">
        <span>{copyOrDataText(text, row.step)}</span>
        {row.workload === undefined ? null : (
          <code className="config-step-workload">{row.workload}</code>
        )}
      </span>
      <span className="config-step-runs">
        {runs === undefined ? (
          <span className="config-step-absent">—</span>
        ) : (
          <>
            {copyOrDataText(text, runs.by)}
            {runs.from === undefined ? null : (
              <>
                {" · "}
                <code>{runs.from}</code>
              </>
            )}
            {runs.more === 0 ? null : ` +${String(runs.more)}`}
          </>
        )}
      </span>
      <span className="config-step-model">
        {row.evaluators.length > 0
          ? null
          : row.model === undefined
            ? "—"
            : copyOrDataText(text, row.model)}
      </span>
      <span className="config-step-overrides">
        {row.overrides.map((word) => copyOrDataText(text, word)).join(" · ")}
      </span>
    </>
  );
}

function ConfigurationStepLine(props: {
  readonly row: ConfigurationStepRow;
  readonly nested: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const { row } = props;
  const nested = props.nested ? "true" : undefined;
  const opens =
    row.details.length > 0 ||
    row.prompt.length > 0 ||
    row.definition !== undefined;
  return (
    <>
      {opens ? (
        <div className="config-step" data-nested={nested}>
          <Disclosure
            open={open}
            onOpenChange={setOpen}
            chevron
            label={<ConfigurationStepCells row={row} />}
          >
            <div className="config-step-body">
              <ConfigurationStepDetails details={row.details} />
              <ConfigurationStepViews row={row} />
            </div>
          </Disclosure>
        </div>
      ) : (
        <div className="config-step" data-nested={nested}>
          <div className="config-step-line">
            <span className="config-step-chevron" />
            <ConfigurationStepCells row={row} />
          </div>
        </div>
      )}
      {row.evaluators.map((evaluator, at) => (
        <ConfigurationStepLine key={at} row={evaluator} nested />
      ))}
    </>
  );
}

const configurationStepPhaseWords: Readonly<
  Record<ConfigurationStepPhase, Copy>
> = {
  Work: { id: "ticket-steps-phase-work" },
  Evaluation: { id: "ticket-steps-phase-evaluation" },
  Finalization: { id: "ticket-steps-phase-landing" },
};

function ConfigurationStepGroupDrawn(props: {
  readonly group: ConfigurationStepGroup;
}): ReactNode {
  const text = useCopyText();
  const { group } = props;
  return (
    <section className="config-steps-group" data-phase={group.phase}>
      <h3 className="config-steps-group-head">
        <span className="config-steps-phase">
          {text(configurationStepPhaseWords[group.phase])}
        </span>
        {group.note === undefined ? null : (
          <span className="config-steps-note">{text(group.note)}</span>
        )}
      </h3>
      {group.rows.map((row, at) => (
        <ConfigurationStepLine key={at} row={row} nested={false} />
      ))}
    </section>
  );
}

export function ConfigurationStepsTable(props: {
  readonly steps: ConfigurationSteps;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="config-steps">
      <div className="config-steps-columns">
        <span />
        <span>{text({ id: "configuration-steps-col-step" })}</span>
        <span>{text({ id: "configuration-steps-col-runs" })}</span>
        <span>{text({ id: "configuration-steps-col-model" })}</span>
        <span>{text({ id: "configuration-steps-col-overrides" })}</span>
      </div>
      {props.steps.groups.map((group) => (
        <ConfigurationStepGroupDrawn key={group.phase} group={group} />
      ))}
    </div>
  );
}
