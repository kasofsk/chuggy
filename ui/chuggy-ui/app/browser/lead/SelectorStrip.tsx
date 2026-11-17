/**
 * What the selector is doing for this project right now, and the one press that
 * changes each of those facts.
 *
 * It leads the page because a paused selector is the first thing an operator
 * needs to see, and it has no edit mode: a press writes the whole override set
 * under the read revision, which is the same write a section's Save makes.
 */

import type { ReactNode } from "react";

import type { SelectorProjectSettingsResponse } from "../../../../../src/contract/responses.ts";
import {
  selectorSettingsDispatchCell,
  selectorSettingsModeCell,
  selectorSettingsWrite,
} from "../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsStripCell,
} from "../../core/selectorSettingsForm.ts";
import type { SelectorProjectOverrides } from "../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { SelectorSettingsRefusedLine } from "../settings/lead/SelectorSection.tsx";
import type { SelectorSettingsShown } from "../selectorSettingsWriting.ts";

import "../settings/lead/selector.css";

/** What the strip's last press did, in the one line it says it in. */
function SelectorStripSaved(props: {
  readonly saved: SelectorSettingsShown | undefined;
}): ReactNode {
  const text = useCopyText();
  const saved = props.saved;
  if (saved === undefined) return null;
  if (saved.isPending)
    return (
      <Notice
        tone="info"
        inline
        detail={text({ id: "lead-settings-writing" })}
      />
    );
  if (saved.error !== null)
    return <SelectorSettingsRefusedLine refused={saved.error} />;
  if (saved.isSuccess && saved.data !== undefined)
    return (
      <Notice
        tone="live"
        inline
        detail={text({
          id: "lead-settings-written",
          args: { revision: String(saved.data.revision) },
        })}
      />
    );
  return null;
}

/** Whether there is a line to draw for the strip's last press at all. */
function selectorStripNoticed(
  saved: SelectorSettingsShown | undefined,
): boolean {
  return (
    saved !== undefined &&
    (saved.isPending || saved.error !== null || saved.isSuccess)
  );
}

function SelectorStripCell(props: {
  readonly cell: SelectorSettingsStripCell;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onPress: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const text = useCopyText();
  const cell = props.cell;
  const overrides = selectorSettingsWrite(cell.pressed).overrides;
  return (
    <div className="selector-cell">
      <span className="selector-key">{text(cell.name)}</span>
      <span className="selector-standing">
        {cell.tone === undefined ? null : (
          <i
            className="selector-dot"
            data-tone={cell.tone}
            aria-hidden="true"
          />
        )}
        {text(cell.value)}
        {cell.inherited ? (
          <Pill tone="neutral">{text({ id: "lead-settings-default" })}</Pill>
        ) : null}
      </span>
      <Button
        size="sm"
        busy={props.busy}
        disabled={overrides === undefined || props.busy || !props.editable}
        onClick={() => {
          if (overrides !== undefined) props.onPress(overrides);
        }}
      >
        {text(cell.action)}
      </Button>
    </div>
  );
}

export function SelectorStrip(props: {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly onPress: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  return (
    <>
      <div className="selector-strip">
        <SelectorStripCell
          cell={selectorSettingsModeCell(props.draft, props.settings)}
          editable={props.editable}
          busy={props.busy}
          onPress={props.onPress}
        />
        <SelectorStripCell
          cell={selectorSettingsDispatchCell(props.draft, props.settings)}
          editable={props.editable}
          busy={props.busy}
          onPress={props.onPress}
        />
      </div>
      {selectorStripNoticed(props.saved) ? (
        <div className="flex items-center gap-2">
          <SelectorStripSaved saved={props.saved} />
        </div>
      ) : null}
    </>
  );
}
