/**
 * What one decision may spend, as a row per limit that carries its own state:
 * on the installation's value, or the project's own and resettable, or moved by
 * the draft that is open.
 *
 * The row is the unit rather than the section, so a reader can see which
 * ceilings a save is about to move; the foot counts them. There is no reset-all
 * for the same reason.
 */

import type { ReactNode } from "react";

import { countFigure } from "../../core/figures.ts";
import {
  selectorSettingsLimitEdited,
  selectorSettingsLimitFigure,
  selectorSettingsLimitLabel,
  selectorSettingsLimitNames,
  selectorSettingsLimitOverridden,
  selectorSettingsLimitTyped,
  selectorSettingsLimitUnitWord,
  selectorSettingsSection,
  selectorSettingsSectionChangedCount,
  selectorSettingsSectionInherited,
} from "../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsLimitName,
  SelectorSettingsSaved,
} from "../../core/selectorSettingsForm.ts";
import type { SelectorProjectSettingsResponse } from "../../../../../src/contract/responses.ts";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Input } from "../ui/Input.tsx";
import { Pill } from "../ui/Pill.tsx";
import { SelectorSection } from "./SelectorSection.tsx";

import "./selector.css";

interface SelectorLimitRow {
  readonly name: SelectorSettingsLimitName;
  readonly draft: SelectorSettingsDraft;
  readonly effective: number;
  readonly installationEffective: number;
  readonly fault: string | undefined;
  readonly editing: boolean;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
}

/** What the row says about where its value came from: the installation's, or
 * the project's own, its default beside it and the one action that gives it
 * back. */
function SelectorLimitStanding(props: {
  readonly row: SelectorLimitRow;
}): ReactNode {
  const row = props.row;
  if (!selectorSettingsLimitOverridden(row.draft, row.name))
    return (
      <span className="selector-was">
        <Pill tone="neutral">Default</Pill>
      </span>
    );
  const installation = selectorSettingsLimitFigure(
    row.name,
    row.installationEffective,
  );
  return (
    <span className="selector-was">
      default <Figure figure={installation} />
      {row.editing ? (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            row.onChange(selectorSettingsLimitTyped(row.draft, row.name, ""));
          }}
        >
          Reset
        </Button>
      ) : null}
    </span>
  );
}

function SelectorLimit(props: { readonly row: SelectorLimitRow }): ReactNode {
  const row = props.row;
  const label = selectorSettingsLimitLabel(row.name);
  const edited = selectorSettingsLimitEdited(row.draft, row.name);
  const placeholder = selectorSettingsLimitOverridden(row.draft, row.name)
    ? undefined
    : String(row.installationEffective);
  return (
    <div className="selector-limit" data-edited={edited ? "" : undefined}>
      <span className="selector-limit-key">
        {edited ? <i className="selector-mark" aria-hidden="true" /> : null}
        {label}
      </span>
      {row.editing ? (
        <Input
          numeric
          label={label}
          unit={selectorSettingsLimitUnitWord(row.name)}
          value={row.draft.limits[row.name]}
          {...(placeholder === undefined ? {} : { placeholder })}
          invalid={row.fault !== undefined}
          onChange={(digits) => {
            row.onChange(
              selectorSettingsLimitTyped(row.draft, row.name, digits),
            );
          }}
        />
      ) : (
        <Figure figure={selectorSettingsLimitFigure(row.name, row.effective)} />
      )}
      <SelectorLimitStanding row={row} />
      {row.fault === undefined ? null : (
        <span className="selector-fault">{row.fault}</span>
      )}
    </div>
  );
}

export function SelectorLimitsSection(props: {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly faults: Readonly<Record<string, string>>;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly savable: boolean;
  readonly saved: SelectorSettingsSaved;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
}): ReactNode {
  const section = selectorSettingsSection("limits");
  const changed = selectorSettingsSectionChangedCount(props.draft, "limits");
  return (
    <SelectorSection
      title={section.title}
      about={section.about}
      inherited={selectorSettingsSectionInherited(props.draft, "limits")}
      editing={props.editing}
      editable={props.editable}
      savable={props.savable}
      saved={props.saved}
      onEdit={props.onEdit}
      onCancel={props.onCancel}
      onSave={props.onSave}
      onReload={props.onReload}
      footLead={
        <Figure
          figure={countFigure(changed, changed === 1 ? "change" : "changes")}
        />
      }
    >
      <div className="selector-limits">
        {selectorSettingsLimitNames.map((name) => (
          <SelectorLimit
            key={name}
            row={{
              name,
              draft: props.draft,
              effective: props.settings.effective.limits[name],
              installationEffective:
                props.settings.effective.installationLimits[name],
              fault: props.faults[`limits.${name}`],
              editing: props.editing,
              onChange: props.onChange,
            }}
          />
        ))}
      </div>
    </SelectorSection>
  );
}
