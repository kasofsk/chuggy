/**
 * Every recorded revision of these settings, what each one moved, and the one
 * action that puts a revision's overrides back.
 *
 * What changed is derived in the browser from the override sets the history
 * already carries, so this costs the server nothing; the oldest row of a page
 * has no predecessor to compare against and says so rather than claiming the
 * revision set everything.
 */

import { Collapsible } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import type { SelectorSettingsHistoryResponse } from "../../../../../src/contract/responses.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { selectorSettingsHistoryDiffs } from "../../core/selectorSettingsHistory.ts";
import type {
  SelectorSettingsFieldChange,
  SelectorSettingsRevisionDiff,
} from "../../core/selectorSettingsHistory.ts";
import type { SelectorProjectOverrides } from "../../core/selectorSettingsForm.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Button, buttonLookClassName } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Panel } from "../ui/Panel.tsx";

import "./selector.css";

/** How many revisions stand before the rest are asked for, which is as many as
 * a reader scans without the list becoming the page. */
export const selectorRevisionsShownMax = 5;

function SelectorRevisionChanged(props: {
  readonly changes: readonly SelectorSettingsFieldChange[] | undefined;
}): ReactNode {
  const changes = props.changes;
  if (changes === undefined)
    return (
      <Figure figure={{ kind: "Absent", why: "No earlier revision read" }} />
    );
  if (changes.length === 0)
    return (
      <span className="selector-changed" data-none="">
        No change
      </span>
    );
  return (
    <span className="selector-changed">
      {changes.map((change) => change.label).join(", ")}
    </span>
  );
}

function SelectorRevisionDiff(props: {
  readonly changes: readonly SelectorSettingsFieldChange[];
}): ReactNode {
  return (
    <dl className="selector-diff">
      {props.changes.map((change) => (
        <div
          key={change.label}
          className="selector-diff-row"
          data-mono={change.mono ? "" : undefined}
        >
          <dt>{change.label}</dt>
          <dd>
            <span className="selector-before">{change.before}</span>{" "}
            <span className="selector-after">{change.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SelectorRevision(props: {
  readonly diff: SelectorSettingsRevisionDiff;
  readonly nowMs: number;
  readonly restorable: boolean;
  readonly busy: boolean;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const { diff, onRestore } = props;
  const changes = diff.changes ?? [];
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="selector-revision">
        <span className="num">{diff.revision.revision}</span>
        <span className="truncate">{diff.revision.administrator.subject}</span>
        <Figure figure={instantFigure(diff.revision.recordedAt, props.nowMs)} />
        <SelectorRevisionChanged changes={diff.changes} />
        <span className="flex items-center gap-2">
          {changes.length === 0 ? null : (
            <Collapsible.Trigger
              className={buttonLookClassName({ variant: "quiet", size: "sm" })}
            >
              {open ? "Hide diff" : "Diff"}
            </Collapsible.Trigger>
          )}
          {props.restorable ? (
            <Button
              variant="quiet"
              size="sm"
              disabled={props.busy}
              onClick={() => {
                onRestore(diff.revision.overrides);
              }}
            >
              Restore
            </Button>
          ) : null}
        </span>
      </div>
      <Collapsible.Content>
        <SelectorRevisionDiff changes={changes} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function SelectorRevisionList(props: {
  readonly history: SelectorSettingsHistoryResponse;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const [all, setAll] = useState(false);
  const diffs = selectorSettingsHistoryDiffs(props.history.revisions);
  if (diffs.length === 0) return <EmptyState label="No revisions" />;
  const shown = all ? diffs : diffs.slice(0, selectorRevisionsShownMax);
  return (
    <div className="grid justify-items-start gap-2">
      <div className="selector-revisions w-full">
        {shown.map((diff, at) => (
          <SelectorRevision
            key={diff.revision.revision}
            diff={diff}
            nowMs={props.nowMs}
            restorable={at > 0}
            busy={props.busy}
            onRestore={props.onRestore}
          />
        ))}
      </div>
      {all || diffs.length <= selectorRevisionsShownMax ? null : (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setAll(true);
          }}
        >
          {`Show all ${String(diffs.length)}`}
        </Button>
      )}
    </div>
  );
}

export function SelectorRevisions(props: {
  readonly state: PanelState<SelectorSettingsHistoryResponse>;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const state = props.state;
  return (
    <Panel
      variant="section"
      title="Revisions"
      about="Every save, newest first."
    >
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SelectorRevisionList
          history={state.value}
          nowMs={props.nowMs}
          busy={props.busy}
          onRestore={props.onRestore}
        />
      ) : null}
    </Panel>
  );
}
