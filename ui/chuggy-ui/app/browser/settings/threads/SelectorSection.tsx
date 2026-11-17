/**
 * One selector setting group as a card: whether it stands on the default,
 * and what its own last write answered.
 *
 * The chrome is `SettingsSection`'s and only what is the selector's is here:
 * the Default badge, and the line this route's refusals are drawn as.
 */

import type { ReactNode } from "react";

import { instantFigure } from "../../../core/figures.ts";
import type { SelectorSettingsConflictResponse } from "../../../../../../src/contract/responses.ts";
import type { ConsoleWriteRefused } from "../../../core/consoleWrite.ts";
import { selectorSettingsConflictOf } from "../../../core/selectorSettingsForm.ts";
import { useCopyText } from "../../../copy/CopyProvider.tsx";
import { ConsoleWriteRefusedWords } from "../../consoleWrite.tsx";
import { useNowMs } from "../../Freshness.tsx";
import type { SelectorSettingsShown } from "../../selectorSettingsWriting.ts";
import { Figure } from "../../ui/Figure.tsx";
import { Identity } from "../../ui/Identity.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { SettingsSection } from "../../ui/SettingsSection.tsx";
import type { SettingsSectionRefusal } from "../../ui/SettingsSection.tsx";

import "./selector.css";

/** Who moved the revision this write lost the fence on, and when: the fact a
 * reader needs before deciding whether Reload is theirs to press. */
function SelectorSettingsMovedBy(props: {
  readonly movedBy: NonNullable<SelectorSettingsConflictResponse["movedBy"]>;
}): ReactNode {
  const nowMs = useNowMs();
  const text = useCopyText();
  const subject = props.movedBy.administrator.subject;
  return (
    <>
      {text({ id: "settings-threads-changed-by" })}{" "}
      <Identity label={{ text: subject, title: subject }} />{" "}
      {text({ id: "settings-threads-changed-at" })}{" "}
      <Figure figure={instantFigure(props.movedBy.recordedAt, nowMs)} />
    </>
  );
}

/** Whether the shown write lost its fence, which is what offers Reload. */
export function selectorSettingsConflicted(
  saved: SelectorSettingsShown | undefined,
): boolean {
  return selectorSettingsConflictOf(saved?.error?.failure) !== undefined;
}

/** A refusal of the shown write in the one line a section says it in: who
 * moved the revision where the fence was lost to a write the route names. */
export function SelectorSettingsRefusedLine(props: {
  readonly refused: ConsoleWriteRefused;
}): ReactNode {
  const conflict = selectorSettingsConflictOf(props.refused.failure);
  if (conflict === undefined)
    return (
      <Notice tone="danger" inline>
        <ConsoleWriteRefusedWords refused={props.refused} />
      </Notice>
    );
  return (
    <Notice tone="parked" inline>
      {conflict.movedBy === undefined ? (
        <ConsoleWriteRefusedWords refused={props.refused} />
      ) : (
        <SelectorSettingsMovedBy movedBy={conflict.movedBy} />
      )}
    </Notice>
  );
}

/** The shown write's refusal as its section draws it, of no one field. */
function selectorSettingsRefusalOf(
  saved: SelectorSettingsShown | undefined,
): SettingsSectionRefusal | undefined {
  const refused = saved?.error ?? null;
  if (refused === null) return undefined;
  return {
    at: "Section",
    refused,
    line: <SelectorSettingsRefusedLine refused={refused} />,
  };
}

export function SelectorSection(props: {
  readonly title: string;
  readonly about: string;
  readonly inherited: boolean;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly changed: boolean;
  readonly ready: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly footLead: ReactNode;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const saved = props.saved;
  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          {props.title}
          {props.inherited ? (
            <StatusBadge tone="neutral" size="small">
              {text({ id: "settings-threads-default" })}
            </StatusBadge>
          ) : null}
        </span>
      }
      about={props.about}
      editing={props.editing}
      editable={props.editable}
      changed={props.changed}
      ready={props.ready}
      saving={saved?.isPending === true}
      refusal={selectorSettingsRefusalOf(saved)}
      footLead={props.footLead}
      {...(selectorSettingsConflicted(saved)
        ? { onReload: props.onReload }
        : {})}
      onEdit={props.onEdit}
      onCancel={props.onCancel}
      onSave={props.onSave}
    >
      {props.children}
    </SettingsSection>
  );
}
