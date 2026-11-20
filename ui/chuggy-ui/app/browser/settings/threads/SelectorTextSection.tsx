/**
 * One prose setting: the whole of what the project runs under while the section
 * is read, and a box that grows to the text while it is edited.
 */

import type { ReactNode } from "react";

import {
  selectorSettingsSection,
  selectorSettingsSectionChangedCount,
  selectorSettingsSectionInherited,
  selectorSettingsTextOverriddenAtRead,
  selectorSettingsTextTyped,
} from "../../../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsTextName,
} from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { Textarea } from "../../ui/Textarea.tsx";
import type { SelectorSettingsShown } from "../../selectorSettingsWriting.ts";
import { SelectorSection } from "./SelectorSection.tsx";

import "./selector.css";

function SelectorTextBody(props: { readonly text: string }): ReactNode {
  return <div className="selector-prose">{props.text}</div>;
}

export function SelectorTextSection(props: {
  readonly name: SelectorSettingsTextName;
  readonly draft: SelectorSettingsDraft;
  readonly effective: string;
  readonly editing: boolean;
  readonly editable: boolean;
  /** The draft can be written as it stands. */
  readonly ready: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
}): ReactNode {
  const text = useCopyText();
  const section = selectorSettingsSection(props.name);
  const title = text(section.title);
  const placeholder = selectorSettingsTextOverriddenAtRead(
    props.draft,
    props.name,
  )
    ? undefined
    : props.effective;
  return (
    <SelectorSection
      title={title}
      about={text(section.about)}
      inherited={selectorSettingsSectionInherited(props.draft, props.name)}
      editing={props.editing}
      editable={props.editable}
      changed={selectorSettingsSectionChangedCount(props.draft, props.name) > 0}
      ready={props.ready}
      saved={props.saved}
      onEdit={props.onEdit}
      onCancel={props.onCancel}
      onSave={props.onSave}
      onReload={props.onReload}
      footLead={
        <Button variant="quiet" size="sm" onClick={props.onReset}>
          {text({ id: "settings-threads-reset-default" })}
        </Button>
      }
    >
      {props.editing ? (
        <Textarea
          labelShown
          label={title}
          value={props.draft[props.name]}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(text) => {
            props.onChange(
              selectorSettingsTextTyped(props.draft, props.name, text),
            );
          }}
        />
      ) : (
        <SelectorTextBody text={props.effective} />
      )}
    </SelectorSection>
  );
}
