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

import type { SelectorSettingsHistoryResponse } from "../../../../../../src/contract/responses.ts";
import { instantFigure } from "../../../core/figures.ts";
import type { PanelState } from "../../../core/freshness.ts";
import {
  selectorSettingsHistoryDefaultWord,
  selectorSettingsHistoryDiffs,
  selectorSettingsHistoryEmptyWord,
} from "../../../core/selectorSettingsHistory.ts";
import type {
  SelectorSettingsFieldChange,
  SelectorSettingsRevisionDiff,
} from "../../../core/selectorSettingsHistory.ts";
import type { SelectorProjectOverrides } from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import type { CopyText } from "../../../core/copy.ts";
import { PanelUnready } from "../../DataPanel.tsx";
import type { SelectorSettingsShown } from "../../selectorSettingsWriting.ts";
import { Button, buttonLookClassName } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Figure } from "../../ui/Figure.tsx";
import { Panel } from "../../ui/Panel.tsx";
import {
  SelectorSettingsSavedNotice,
  selectorSettingsNoticed,
} from "./SelectorSection.tsx";

import "./selector.css";

/** How many revisions stand before the rest are asked for, which is as many as
 * a reader scans without the list becoming the page. */
export const selectorRevisionsShownMax = 5;

/** A field's before or after text: the catalog's word for the two sentinels
 * an override field with no value is drawn as, or the value itself, which is
 * data. */
function selectorRevisionFieldText(text: CopyText, value: string): string {
  if (value === selectorSettingsHistoryDefaultWord)
    return text({ id: "lead-settings-default" });
  if (value === selectorSettingsHistoryEmptyWord)
    return text({ id: "lead-history-none" });
  return value;
}

function SelectorRevisionChanged(props: {
  readonly changes: readonly SelectorSettingsFieldChange[] | undefined;
}): ReactNode {
  const text = useCopyText();
  const changes = props.changes;
  if (changes === undefined)
    return (
      <Figure
        figure={{ kind: "Absent", why: { id: "figures-absent-revision" } }}
      />
    );
  if (changes.length === 0)
    return (
      <span className="selector-changed" data-none="">
        {text({ id: "lead-history-no-change" })}
      </span>
    );
  return (
    <span className="selector-changed">
      {changes.map((change) => text(change.label)).join(", ")}
    </span>
  );
}

function SelectorRevisionDiff(props: {
  readonly changes: readonly SelectorSettingsFieldChange[];
}): ReactNode {
  const text = useCopyText();
  return (
    <dl className="selector-diff">
      {props.changes.map((change) => (
        <div
          key={change.label.id}
          className="selector-diff-row"
          data-mono={change.mono ? "" : undefined}
        >
          <dt>{text(change.label)}</dt>
          <dd>
            <span className="selector-before">
              {selectorRevisionFieldText(text, change.before)}
            </span>{" "}
            <span className="selector-after">
              {selectorRevisionFieldText(text, change.after)}
            </span>
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
  const text = useCopyText();
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
              {text({
                id: open ? "lead-history-hide-diff" : "lead-history-diff",
              })}
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
              {text({ id: "lead-history-restore" })}
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
  const text = useCopyText();
  const [all, setAll] = useState(false);
  const diffs = selectorSettingsHistoryDiffs(props.history.revisions);
  if (diffs.length === 0)
    return <EmptyState label={text({ id: "lead-history-none-recorded" })} />;
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
          {text({ id: "lead-history-show-all", args: { count: diffs.length } })}
        </Button>
      )}
    </div>
  );
}

export function SelectorRevisions(props: {
  readonly state: PanelState<SelectorSettingsHistoryResponse>;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const state = props.state;
  const text = useCopyText();
  return (
    <Panel
      variant="section"
      title={text({ id: "lead-history-title" })}
      about={text({ id: "lead-history-about" })}
      foot={
        selectorSettingsNoticed(props.saved) ? (
          <SelectorSettingsSavedNotice saved={props.saved} />
        ) : undefined
      }
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
