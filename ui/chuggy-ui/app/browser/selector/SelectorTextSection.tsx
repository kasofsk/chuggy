/**
 * One prose setting: the whole of what the project runs under while the section
 * is read, and a box that grows to the text while it is edited.
 */

import type { ReactNode } from "react";

import {
  selectorSettingsSection,
  selectorSettingsSectionInherited,
  selectorSettingsTextOverriddenAtRead,
  selectorSettingsTextTyped,
} from "../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsSaved,
  SelectorSettingsTextName,
} from "../../core/selectorSettingsForm.ts";
import { Button } from "../ui/Button.tsx";
import { Textarea } from "../ui/Textarea.tsx";
import { SelectorSection } from "./SelectorSection.tsx";

import "./selector.css";

function SelectorTextBody(props: {
  readonly text: string;
  readonly mono: boolean;
}): ReactNode {
  return (
    <div className="selector-prose" data-mono={props.mono ? "" : undefined}>
      {props.text}
    </div>
  );
}

export function SelectorTextSection(props: {
  readonly name: SelectorSettingsTextName;
  readonly draft: SelectorSettingsDraft;
  readonly effective: string;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly savable: boolean;
  readonly saved: SelectorSettingsSaved;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
}): ReactNode {
  const section = selectorSettingsSection(props.name);
  const mono = props.name === "basePrompt";
  const placeholder = selectorSettingsTextOverriddenAtRead(
    props.draft,
    props.name,
  )
    ? undefined
    : props.effective;
  return (
    <SelectorSection
      title={section.title}
      about={section.about}
      inherited={selectorSettingsSectionInherited(props.draft, props.name)}
      editing={props.editing}
      editable={props.editable}
      savable={props.savable}
      saved={props.saved}
      onEdit={props.onEdit}
      onCancel={props.onCancel}
      onSave={props.onSave}
      onReload={props.onReload}
      footLead={
        <Button variant="quiet" size="sm" onClick={props.onReset}>
          Reset to default
        </Button>
      }
    >
      {props.editing ? (
        <Textarea
          label={section.title}
          mono={mono}
          value={props.draft[props.name]}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(text) => {
            props.onChange(
              selectorSettingsTextTyped(props.draft, props.name, text),
            );
          }}
        />
      ) : (
        <SelectorTextBody text={props.effective} mono={mono} />
      )}
    </SelectorSection>
  );
}
