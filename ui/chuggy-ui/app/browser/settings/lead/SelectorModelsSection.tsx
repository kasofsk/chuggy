/**
 * What the lead and a new thread run on, as a row per model and per effort that
 * carries its own state: on the default, or the project's own, or moved by the
 * draft that is open.
 *
 * A model is typed, because Claude Code takes any name it knows, and the
 * aliases are offered beside the box rather than instead of it. An effort is
 * chosen from the roster the wire takes. A refusal is drawn under the row with
 * the reason the wire's own schema gave.
 */

import type { ReactNode } from "react";
import { useId } from "react";

import { sessionEfforts } from "../../../../../../src/contract/http.ts";
import { copyOrDataText } from "../../../core/copy.ts";
import type { Copy } from "../../../core/copy.ts";
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
} from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import { Input } from "../../ui/Input.tsx";
import { Picker } from "../../ui/Picker.tsx";
import { Pill } from "../../ui/Pill.tsx";
import { SelectorRowsSection } from "./SelectorRowsSection.tsx";
import type { SelectorRowsChrome } from "./SelectorRowsSection.tsx";

import "./selector.css";

interface SelectorModelRow {
  readonly name: SelectorSettingsModelName;
  readonly draft: SelectorSettingsDraft;
  readonly fault: Copy | undefined;
  readonly editing: boolean;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
}

/** The box a model is typed into, and the aliases that fill it. */
function SelectorModelTyped(props: {
  readonly row: SelectorModelRow;
  readonly label: string;
  readonly describedBy: string;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const typed = (value: string) => {
    row.onChange(selectorSettingsModelTyped(row.draft, row.name, value));
  };
  return (
    <span className="flex items-center gap-2">
      <Input
        label={props.label}
        value={row.draft.models[row.name]}
        placeholder={text({ id: "lead-settings-default" })}
        invalid={row.fault !== undefined}
        {...(row.fault === undefined ? {} : { describedBy: props.describedBy })}
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
    </span>
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
    <Picker
      label={props.label}
      value={row.draft.models[row.name]}
      options={[
        { value: "", text: text({ id: "lead-settings-default" }) },
        ...sessionEfforts.map((effort) => ({
          value: effort,
          text: text(selectorSettingsEffortLabel(effort)),
        })),
      ]}
      onChoose={(value) => {
        row.onChange(selectorSettingsModelTyped(row.draft, row.name, value));
      }}
    />
  );
}

function SelectorModel(props: { readonly row: SelectorModelRow }): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const label = text(selectorSettingsModelLabel(row.name));
  const edited = selectorSettingsModelEdited(row.draft, row.name);
  const faultId = useId();
  const control = selectorSettingsModelRowIsEffort(row.name) ? (
    <SelectorEffortChosen row={row} label={label} />
  ) : (
    <SelectorModelTyped row={row} label={label} describedBy={faultId} />
  );
  return (
    <div className="selector-limit" data-edited={edited ? "" : undefined}>
      <span className="selector-limit-key">
        {edited ? <i className="selector-mark" aria-hidden="true" /> : null}
        {label}
      </span>
      {row.editing ? (
        control
      ) : (
        <span>
          {copyOrDataText(
            text,
            selectorSettingsModelValue(row.draft, row.name),
          )}
        </span>
      )}
      <span className="selector-was">
        {row.draft.models[row.name] === "" ? (
          <Pill tone="neutral">{text({ id: "lead-settings-default" })}</Pill>
        ) : null}
      </span>
      {row.fault === undefined ? null : (
        <span id={faultId} className="selector-fault">
          {text(row.fault)}
        </span>
      )}
    </div>
  );
}

export function SelectorModelsSection(props: SelectorRowsChrome): ReactNode {
  return (
    <SelectorRowsSection {...props} name="models">
      {selectorSettingsModelNames.map((name) => (
        <SelectorModel
          key={name}
          row={{
            name,
            draft: props.draft,
            fault: props.faults[name],
            editing: props.editing,
            onChange: props.onChange,
          }}
        />
      ))}
    </SelectorRowsSection>
  );
}
