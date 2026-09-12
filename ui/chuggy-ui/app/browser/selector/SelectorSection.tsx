/**
 * One selector setting group as a card: whether it stands on the installation's
 * value, and what its own last write answered.
 *
 * The chrome is `SettingsSection`'s and only what is the selector's is here:
 * the Default pill, and the notice this route's five answers are drawn as.
 */

import type { ReactNode } from "react";

import { instantFigure } from "../../core/figures.ts";
import type { SelectorSettingsSaved } from "../../core/selectorSettingsForm.ts";
import { useNowMs } from "../Freshness.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";

import "./selector.css";

type SelectorSettingsConflict = Extract<
  SelectorSettingsSaved,
  { readonly saved: "Conflict" }
>;

/** Who moved the revision this write lost the fence on, and when: the fact a
 * reader needs before deciding whether Reload is theirs to press. */
function SelectorSettingsMovedBy(props: {
  readonly movedBy: NonNullable<SelectorSettingsConflict["movedBy"]>;
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

/** What the last write did, in the one line a form says it in. */
export function SelectorSettingsSavedNotice(props: {
  readonly saved: SelectorSettingsSaved;
}): ReactNode {
  const saved = props.saved;
  switch (saved.saved) {
    case "Idle":
      return null;
    case "Writing":
      return <Notice tone="info" inline detail="Writing" />;
    case "Written":
      return (
        <Notice
          tone="live"
          inline
          detail={`Written · ${String(saved.revision)}`}
        />
      );
    case "Conflict":
      return saved.movedBy === undefined ? (
        <Notice
          tone="parked"
          inline
          detail={`Conflict · ${String(saved.revision)}`}
        />
      ) : (
        <Notice tone="parked" inline>
          <SelectorSettingsMovedBy movedBy={saved.movedBy} />
        </Notice>
      );
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
      );
  }
}

export function SelectorSection(props: {
  readonly title: string;
  readonly about: string;
  readonly inherited: boolean;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly savable: boolean;
  readonly saved: SelectorSettingsSaved;
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
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <SelectorSettingsSavedNotice saved={saved} /> })}
      {...(saved.saved === "Conflict" ? { onReload: props.onReload } : {})}
      onEdit={props.onEdit}
      onCancel={props.onCancel}
      onSave={props.onSave}
    >
      {props.children}
    </SettingsSection>
  );
}
