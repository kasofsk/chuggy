/**
 * One selector setting group as a card: whether it stands on the installation's
 * value, and what its own last write answered.
 *
 * The chrome is `SettingsSection`'s and only what is the selector's is here:
 * the Default pill, and the notice this route's five answers are drawn as.
 */

import type { ReactNode } from "react";

import { instantFigure } from "../../../core/figures.ts";
import type { SelectorSettingsConflictResponse } from "../../../../../../src/contract/responses.ts";
import { selectorSettingsConflictOf } from "../../../core/selectorSettingsForm.ts";
import { ConsoleWriteRefusedWords } from "../../consoleWrite.tsx";
import { useNowMs } from "../../Freshness.tsx";
import type { SelectorSettingsShown } from "../../selectorSettingsWriting.ts";
import { Figure } from "../../ui/Figure.tsx";
import { Identity } from "../../ui/Identity.tsx";
import { Notice } from "../../ui/Notice.tsx";
import { Pill } from "../../ui/Pill.tsx";
import { SettingsSection } from "../../ui/SettingsSection.tsx";

import "./selector.css";

/** Who moved the revision this write lost the fence on, and when: the fact a
 * reader needs before deciding whether Reload is theirs to press. */
function SelectorSettingsMovedBy(props: {
  readonly movedBy: NonNullable<SelectorSettingsConflictResponse["movedBy"]>;
}): ReactNode {
  const nowMs = useNowMs();
  const subject = props.movedBy.administrator.subject;
  return (
    <>
      {"Changed by "}
      <Identity label={{ text: subject, title: subject }} />
      {" at "}
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

/** What the last write did, in the one line a form says it in. */
export function SelectorSettingsSavedNotice(props: {
  readonly saved: SelectorSettingsShown | undefined;
}): ReactNode {
  const saved = props.saved;
  if (saved === undefined) return null;
  if (saved.isPending) return <Notice tone="info" inline detail="Writing" />;
  if (saved.error !== null) {
    const conflict = selectorSettingsConflictOf(saved.error.failure);
    if (conflict === undefined)
      return (
        <Notice tone="danger" inline>
          <ConsoleWriteRefusedWords refused={saved.error} />
        </Notice>
      );
    return conflict.movedBy === undefined ? (
      <Notice tone="parked" inline>
        <ConsoleWriteRefusedWords refused={saved.error} />
      </Notice>
    ) : (
      <Notice tone="parked" inline>
        <SelectorSettingsMovedBy movedBy={conflict.movedBy} />
      </Notice>
    );
  }
  if (saved.isSuccess && saved.data !== undefined)
    return (
      <Notice
        tone="live"
        inline
        detail={`Written · ${String(saved.data.revision)}`}
      />
    );
  return null;
}

/** Whether there is a line to draw for the shown write at all. */
export function selectorSettingsNoticed(
  saved: SelectorSettingsShown | undefined,
): boolean {
  return (
    saved !== undefined &&
    (saved.isPending || saved.error !== null || saved.isSuccess)
  );
}

export function SelectorSection(props: {
  readonly title: string;
  readonly about: string;
  readonly inherited: boolean;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly savable: boolean;
  readonly saved: SelectorSettingsShown | undefined;
  readonly footLead: ReactNode;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const saved = props.saved;
  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          {props.title}
          {props.inherited ? <Pill tone="neutral">Default</Pill> : null}
        </span>
      }
      about={props.about}
      editing={props.editing}
      editable={props.editable}
      savable={props.savable}
      footLead={props.footLead}
      {...(selectorSettingsNoticed(saved)
        ? { notice: <SelectorSettingsSavedNotice saved={saved} /> }
        : {})}
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
