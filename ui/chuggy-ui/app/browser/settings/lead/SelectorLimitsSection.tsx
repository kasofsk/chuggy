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
import { useId } from "react";

import {
  selectorSettingsLimitEdited,
  selectorSettingsLimitFigure,
  selectorSettingsLimitLabel,
  selectorSettingsLimitNames,
  selectorSettingsLimitOverridden,
  selectorSettingsLimitTyped,
  selectorSettingsLimitUnitWord,
} from "../../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsLimitName,
} from "../../../core/selectorSettingsForm.ts";
import type { SelectorProjectSettingsResponse } from "../../../../../../src/contract/responses.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import type { Copy } from "../../../core/copy.ts";
import { Button } from "../../ui/Button.tsx";
import { Figure } from "../../ui/Figure.tsx";
import { Input } from "../../ui/Input.tsx";
import { Pill } from "../../ui/Pill.tsx";
import { SelectorRowsSection } from "./SelectorRowsSection.tsx";
import type { SelectorRowsChrome } from "./SelectorRowsSection.tsx";

import "./selector.css";

interface SelectorLimitRow {
  readonly name: SelectorSettingsLimitName;
  readonly draft: SelectorSettingsDraft;
  readonly effective: number;
  readonly installationEffective: number;
  readonly fault: Copy | undefined;
  readonly editing: boolean;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
}

/** What the row says about where its value came from: the installation's, or
 * the project's own, its default beside it and the one action that gives it
 * back. */
function SelectorLimitStanding(props: {
  readonly row: SelectorLimitRow;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  if (!selectorSettingsLimitOverridden(row.draft, row.name))
    return (
      <span className="selector-was">
        <Pill tone="neutral">{text({ id: "lead-settings-default" })}</Pill>
      </span>
    );
  const installation = selectorSettingsLimitFigure(
    row.name,
    row.installationEffective,
  );
  return (
    <span className="selector-was">
      {text({ id: "lead-settings-default-lower" })}{" "}
      <Figure figure={installation} />
      {row.editing ? (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            row.onChange(selectorSettingsLimitTyped(row.draft, row.name, ""));
          }}
        >
          {text({ id: "lead-settings-reset" })}
        </Button>
      ) : null}
    </span>
  );
}

function SelectorLimit(props: { readonly row: SelectorLimitRow }): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const label = text(selectorSettingsLimitLabel(row.name));
  const edited = selectorSettingsLimitEdited(row.draft, row.name);
  const placeholder = selectorSettingsLimitOverridden(row.draft, row.name)
    ? undefined
    : String(row.installationEffective);
  const faultId = useId();
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
          unit={text(selectorSettingsLimitUnitWord(row.name))}
          value={row.draft.limits[row.name]}
          {...(placeholder === undefined ? {} : { placeholder })}
          invalid={row.fault !== undefined}
          {...(row.fault === undefined ? {} : { describedBy: faultId })}
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
        <span id={faultId} className="selector-fault">
          {text(row.fault)}
        </span>
      )}
    </div>
  );
}

export function SelectorLimitsSection(
  props: SelectorRowsChrome & {
    readonly settings: SelectorProjectSettingsResponse;
  },
): ReactNode {
  return (
    <SelectorRowsSection {...props} name="limits">
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
    </SelectorRowsSection>
  );
}
