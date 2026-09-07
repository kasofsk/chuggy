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
  SelectorSettingsSaved,
  SelectorSettingsStripCell,
} from "../../core/selectorSettingsForm.ts";
import type { SelectorProjectOverrides } from "../../core/selectorSettingsForm.ts";
import { Button } from "../ui/Button.tsx";
import { Pill } from "../ui/Pill.tsx";
import { SelectorSettingsSavedNotice } from "./SelectorSection.tsx";

import "./selector.css";

function SelectorStripCell(props: {
  readonly cell: SelectorSettingsStripCell;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onPress: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const cell = props.cell;
  const overrides = selectorSettingsWrite(cell.pressed).overrides;
  return (
    <div className="selector-cell">
      <span className="selector-key">{cell.name}</span>
      <span className="selector-standing">
        {cell.tone === undefined ? null : (
          <i
            className="selector-dot"
            data-tone={cell.tone}
            aria-hidden="true"
          />
        )}
        {cell.value}
        {cell.inherited ? <Pill tone="neutral">Default</Pill> : null}
      </span>
      <Button
        size="sm"
        busy={props.busy}
        disabled={overrides === undefined || props.busy || !props.editable}
        onClick={() => {
          if (overrides !== undefined) props.onPress(overrides);
        }}
      >
        {cell.action}
      </Button>
    </div>
  );
}

export function SelectorStrip(props: {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly saved: SelectorSettingsSaved;
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
      {props.saved.saved === "Idle" ? null : (
        <div className="flex items-center gap-2">
          <SelectorSettingsSavedNotice saved={props.saved} />
        </div>
      )}
    </>
  );
}
