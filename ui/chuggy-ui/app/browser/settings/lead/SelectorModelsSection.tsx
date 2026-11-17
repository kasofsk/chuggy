/**
 * What the lead and a new thread run on, as a row per model and per effort that
 * carries its own state: on the default, or the project's own, or moved by the
 * draft that is open.
 *
 * A model is typed, because Claude Code takes any name it knows, and the
 * aliases are offered beside the box rather than instead of it. An effort is
 * chosen from the roster the wire takes. A refusal is drawn under the row with
 * the reason the wire's own schema gave.
 *
 * A SUBSIDIZED LEAD RUNS THE PROFILE'S MODEL AND EFFORT, so its two rows read
 * the profile's from the effective settings, their boxes are disabled, and one
 * line says why; beside them stands what the month's subsidy has spent of its
 * cap, where the lead read answers it.
 */

import type { ReactNode } from "react";
import { useId } from "react";

import { sessionEfforts } from "../../../../../../src/contract/http.ts";
import type { LeadResponse } from "../../../../../../src/contract/responses.ts";
import { copyOrDataText } from "../../../core/copy.ts";
import type { Copy, CopyOrData } from "../../../core/copy.ts";
import { costCappedText } from "../../../core/figures.ts";
import {
  selectorSettingsEffortLabel,
  selectorSettingsModelAliases,
  selectorSettingsModelEdited,
  selectorSettingsModelLabel,
  selectorSettingsModelNames,
  selectorSettingsModelRowIsEffort,
  selectorSettingsModelTyped,
  selectorSettingsModelValue,
} from "../../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsModelName,
  SelectorSettingsModelPinned,
} from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import { FormField } from "../../ui/FormField.tsx";
import { Input } from "../../ui/Input.tsx";
import { Picker } from "../../ui/Picker.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { SelectorRowsSection } from "./SelectorRowsSection.tsx";
import type { SelectorRowsChrome } from "./SelectorRowsSection.tsx";

import "./selector.css";

interface SelectorModelRow {
  readonly name: SelectorSettingsModelName;
  readonly draft: SelectorSettingsDraft;
  /** What the row reads as where a subsidized lead pins it. */
  readonly pinned: CopyOrData | undefined;
  /** The id of the line that says why a pinned row cannot be edited. */
  readonly pinnedBy: string;
  readonly fault: Copy | undefined;
  readonly editing: boolean;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
}

/** The box a model is typed into, and the aliases that fill it. */
function SelectorModelTyped(props: {
  readonly row: SelectorModelRow;
  readonly label: string;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const typed = (value: string) => {
    row.onChange(selectorSettingsModelTyped(row.draft, row.name, value));
  };
  return (
    <>
      <Input
        labelShown
        label={props.label}
        value={row.draft.models[row.name]}
        placeholder={text({ id: "lead-settings-default" })}
        {...(row.fault === undefined ? {} : { error: text(row.fault) })}
        onChange={typed}
      />
      <Picker
        label={text({ id: "lead-settings-model-alias" })}
        value={row.draft.models[row.name]}
        placeholder={text({ id: "lead-settings-model-alias" })}
        options={selectorSettingsModelAliases.map((alias) => ({
          value: alias,
          text: alias,
        }))}
        onChoose={typed}
      />
    </>
  );
}

/** The effort a row is set to, Default being no override. */
function SelectorEffortChosen(props: {
  readonly row: SelectorModelRow;
  readonly label: string;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  return (
    <FormField
      label={props.label}
      {...(row.fault === undefined ? {} : { error: text(row.fault) })}
    >
      {(field) => (
        <Picker
          label={props.label}
          field={field}
          value={row.draft.models[row.name]}
          options={[
            { value: "", text: text({ id: "lead-settings-default" }) },
            ...sessionEfforts.map((effort) => ({
              value: effort,
              text: text(selectorSettingsEffortLabel(effort)),
            })),
          ]}
          onChoose={(value) => {
            row.onChange(
              selectorSettingsModelTyped(row.draft, row.name, value),
            );
          }}
        />
      )}
    </FormField>
  );
}

/** A pinned row's box, disabled and described by the line that says why. */
function SelectorModelPinned(props: {
  readonly row: SelectorModelRow;
  readonly pinned: CopyOrData;
  readonly label: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="selector-pinned">
      <Input
        labelShown
        label={props.label}
        value={copyOrDataText(text, props.pinned)}
        readOnly
        disabled
        describedBy={props.row.pinnedBy}
      />
    </div>
  );
}

/** The badge a row carries: Pinned where a subsidized lead holds it, and
 * Default where the project never set it. */
function SelectorModelBadge(props: {
  readonly row: SelectorModelRow;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  if (row.pinned !== undefined)
    return (
      <StatusBadge tone="neutral" size="small">
        {text({ id: "lead-settings-model-pinned" })}
      </StatusBadge>
    );
  return row.draft.models[row.name] === "" ? (
    <StatusBadge tone="neutral" size="small">
      {text({ id: "lead-settings-default" })}
    </StatusBadge>
  ) : null;
}

function SelectorModelControl(props: {
  readonly row: SelectorModelRow;
  readonly label: string;
}): ReactNode {
  const row = props.row;
  if (row.pinned !== undefined)
    return (
      <SelectorModelPinned row={row} pinned={row.pinned} label={props.label} />
    );
  return selectorSettingsModelRowIsEffort(row.name) ? (
    <SelectorEffortChosen row={row} label={props.label} />
  ) : (
    <SelectorModelTyped row={row} label={props.label} />
  );
}

function SelectorModel(props: { readonly row: SelectorModelRow }): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const label = text(selectorSettingsModelLabel(row.name));
  const edited = selectorSettingsModelEdited(row.draft, row.name);
  const aliased =
    row.editing &&
    row.pinned === undefined &&
    !selectorSettingsModelRowIsEffort(row.name);
  return (
    <div
      className="selector-limit"
      data-edited={edited ? "" : undefined}
      data-aliased={aliased ? "" : undefined}
    >
      {row.editing ? (
        <SelectorModelControl row={row} label={label} />
      ) : (
        <>
          <span className="selector-limit-key">
            {edited ? <i className="selector-mark" aria-hidden="true" /> : null}
            {label}
          </span>
          <span>
            {copyOrDataText(
              text,
              row.pinned ?? selectorSettingsModelValue(row.draft, row.name),
            )}
          </span>
        </>
      )}
      <span className="selector-was">
        <SelectorModelBadge row={row} />
      </span>
    </div>
  );
}

/** What the month's subsidy has spent, against its cap. */
function SelectorModelSubsidy(props: {
  readonly subsidy: SelectorModelsSubsidy;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="selector-limit">
      <span className="selector-limit-key">
        {text({ id: "lead-settings-subsidy" })}
      </span>
      <span className="fig">
        {text(
          costCappedText(
            props.subsidy.tenantMicros,
            props.subsidy.tenantMonthlyMicros,
          ),
        )}
      </span>
    </div>
  );
}

/** The subsidy's spend this month and its cap, as the lead read answers them. */
export type SelectorModelsSubsidy = NonNullable<LeadResponse["subsidy"]>;

export function SelectorModelsSection(
  props: SelectorRowsChrome & {
    readonly pinned: SelectorSettingsModelPinned;
    readonly subsidy: SelectorModelsSubsidy | undefined;
  },
): ReactNode {
  const { pinned, subsidy, ...chrome } = props;
  const text = useCopyText();
  const pinnedBy = useId();
  return (
    <SelectorRowsSection {...chrome} name="models">
      {selectorSettingsModelNames.map((name) => (
        <SelectorModel
          key={name}
          row={{
            name,
            draft: chrome.draft,
            pinned: pinned[name],
            pinnedBy,
            fault: chrome.faults[name],
            editing: chrome.editing,
            onChange: chrome.onChange,
          }}
        />
      ))}
      {subsidy === undefined ? null : (
        <SelectorModelSubsidy subsidy={subsidy} />
      )}
      {Object.keys(pinned).length === 0 ? null : (
        <span id={pinnedBy} className="col-span-full pt-2 text-sm text-ink-3">
          {text({ id: "lead-settings-model-pinned-about" })}
        </span>
      )}
    </SelectorRowsSection>
  );
}
