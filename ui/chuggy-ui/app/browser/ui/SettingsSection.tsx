/**
 * One setting group as a card: its heading at the level under the page's, the
 * line saying what it is for, the Edit that opens it, and the foot its Cancel
 * and its one Save sit in.
 *
 * A section is read until its Edit is pressed and only one is open at a time,
 * so the chrome is here and a page supplies its own body and the left half of
 * its foot. Saving is drawn one way for every section: Save is offered once the
 * draft differs from what was read and can be written, says it is saving while
 * the write is out, and a landing is the write's own toast. A refusal is drawn
 * beside the field at fault, by the page, or above the actions where it is of
 * no one field; focus moves to it as it arrives in an open section.
 */

import { useEffect, useRef } from "react";
import type { ReactNode, Ref, RefObject } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { Button } from "./Button.tsx";
import { Notice } from "./Notice.tsx";
import { Panel } from "./Panel.tsx";

/** A refusal of the section's write, `refused` itself telling one from the
 * next: drawn beside the field at fault, whose control the page marks
 * invalid, or as `line` where it is of no one field. */
export type SettingsSectionRefusal =
  | { readonly at: "Field"; readonly refused: Error }
  | {
      readonly at: "Section";
      readonly refused: Error;
      readonly line: ReactNode;
    };

/** Focus on the refusal as it arrives in an open section: the control under
 * `body` marked invalid where it is a field's, and `line` where it is the
 * section's. */
export function useSettingsSectionRefusalFocus(
  refusal: SettingsSectionRefusal | undefined,
  editing: boolean,
  body: RefObject<HTMLElement | null>,
  line: RefObject<HTMLElement | null>,
): void {
  const refused = refusal?.refused;
  const at = refusal?.at;
  useEffect(() => {
    if (refused === undefined || !editing) return;
    const target =
      at === "Field"
        ? body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        : line.current;
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus moves once per refusal, not once per edit
  }, [refused, at]);
}

/** A refusal of no one field, beside the one action a conflict leaves open:
 * taking what now stands. */
function SettingsSectionRefused({
  refusal,
  onReload,
  ref,
}: {
  readonly refusal: SettingsSectionRefusal | undefined;
  readonly onReload: (() => void) | undefined;
  readonly ref: Ref<HTMLDivElement>;
}): ReactNode {
  const text = useCopyText();
  if (refusal?.at !== "Section") return null;
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-wrap items-center gap-2">
      {refusal.line}
      {onReload === undefined ? null : (
        <Button size="sm" onClick={onReload}>
          {text({ id: "ui-reload" })}
        </Button>
      )}
    </div>
  );
}

/** A write taken up by a section drawn again while it was out, which has no
 * open Save to say so. */
function SettingsSectionSavingClosed(props: {
  readonly saving: boolean;
  readonly editing: boolean;
}): ReactNode {
  const text = useCopyText();
  if (!props.saving || props.editing) return null;
  return <Notice tone="info" inline detail={text({ id: "ui-saving" })} />;
}

function SettingsSectionFoot(props: {
  readonly lead: ReactNode;
  readonly savable: boolean;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      {props.lead}
      <span className="grow" />
      <Button variant="quiet" size="sm" onClick={props.onCancel}>
        {text({ id: "ui-cancel" })}
      </Button>
      <Button
        variant="primary"
        size="sm"
        busy={props.saving}
        disabled={!props.savable || props.saving}
        onClick={props.onSave}
      >
        {props.saving ? text({ id: "ui-saving" }) : text({ id: "ui-save" })}
      </Button>
    </>
  );
}

export function SettingsSection(props: {
  readonly title: ReactNode;
  readonly about: string;
  readonly editing: boolean;
  readonly editable: boolean;
  /** A section its reader may only read, which draws no Edit. */
  readonly readOnly?: boolean;
  /** The draft differs from what was read. */
  readonly changed: boolean;
  /** The draft can be written as it stands, absent where it always can. */
  readonly ready?: boolean;
  readonly saving: boolean;
  readonly refusal?: SettingsSectionRefusal | undefined;
  readonly footLead: ReactNode;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload?: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const body = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  useSettingsSectionRefusalFocus(props.refusal, props.editing, body, line);
  return (
    <Panel
      variant="section"
      level={2}
      title={props.title}
      about={props.about}
      meta={
        props.editing || props.readOnly === true ? undefined : (
          <Button
            variant="quiet"
            size="sm"
            disabled={!props.editable}
            onClick={props.onEdit}
          >
            {text({ id: "ui-edit" })}
          </Button>
        )
      }
      foot={
        props.editing ? (
          <SettingsSectionFoot
            lead={props.footLead}
            savable={props.changed && props.ready !== false}
            saving={props.saving}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ) : undefined
      }
    >
      <div ref={body} className="contents">
        {props.children}
      </div>
      <SettingsSectionSavingClosed
        saving={props.saving}
        editing={props.editing}
      />
      <SettingsSectionRefused
        refusal={props.refusal}
        onReload={props.onReload}
        ref={line}
      />
    </Panel>
  );
}
