/**
 * One prose setting: the whole of what the project runs under while the section
 * is read, and a box that grows to the text while it is edited.
 *
 * The passage is shown whole because a setting a reader cannot see the end of
 * is a setting they cannot check; only a passage past the height a quoted block
 * stops at is clipped, and it says how much it is holding back.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { countFigure } from "../../core/figures.ts";
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
import { Disclosure } from "../ui/Disclosure.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Textarea } from "../ui/Textarea.tsx";
import { SelectorSection } from "./SelectorSection.tsx";

import "./selector.css";

/** Past this a passage is clipped at rest, because a section holding more than
 * this pushes every section under it off the screen. */
export const selectorTextShownCharsMax = 600;

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

function SelectorTextRead(props: {
  readonly text: string;
  readonly mono: boolean;
}): ReactNode {
  const [shown, setShown] = useState(false);
  if (props.text.length <= selectorTextShownCharsMax)
    return <SelectorTextBody text={props.text} mono={props.mono} />;
  return (
    <div className="grid gap-2 justify-items-start">
      {shown ? null : (
        <div className="selector-clip">
          <SelectorTextBody text={props.text} mono={props.mono} />
        </div>
      )}
      <Disclosure
        open={shown}
        onOpenChange={setShown}
        look={{ variant: "quiet", size: "sm" }}
        label={
          shown ? (
            "Show less"
          ) : (
            <span className="flex items-center gap-2">
              Show all
              <Figure figure={countFigure(props.text.length, "characters")} />
            </span>
          )
        }
      >
        <SelectorTextBody text={props.text} mono={props.mono} />
      </Disclosure>
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
        <SelectorTextRead text={props.effective} mono={mono} />
      )}
    </SelectorSection>
  );
}
