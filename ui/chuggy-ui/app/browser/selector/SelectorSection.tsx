/**
 * One setting group as a card: what it is, whether it stands on the
 * installation's value, and the edit it opens.
 *
 * A section is read until its Edit is pressed and only one is open at a time,
 * so the chrome is here and each section supplies only its own body and the
 * left half of its foot.
 */

import type { ReactNode } from "react";

import { instantFigure } from "../../core/figures.ts";
import type { SelectorSettingsSaved } from "../../core/selectorSettingsForm.ts";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";

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

/** What the last write of this section did, beside the one action a conflict
 * leaves open: taking the settings that moved. */
function SelectorSectionSaved(props: {
  readonly saved: SelectorSettingsSaved;
  readonly onReload: () => void;
}): ReactNode {
  if (props.saved.saved === "Idle") return null;
  return (
    <div className="flex items-center gap-2">
      <SelectorSettingsSavedNotice saved={props.saved} />
      {props.saved.saved === "Conflict" ? (
        <Button size="sm" onClick={props.onReload}>
          Reload
        </Button>
      ) : null}
    </div>
  );
}

function SelectorSectionFoot(props: {
  readonly lead: ReactNode;
  readonly savable: boolean;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactNode {
  return (
    <>
      {props.lead}
      <span className="grow" />
      <Button variant="quiet" size="sm" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!props.savable}
        onClick={props.onSave}
      >
        Save changes
      </Button>
    </>
  );
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
  return (
    <Panel
      variant="section"
      title={
        <span className="flex items-center gap-2">
          {props.title}
          {props.inherited ? <Pill tone="neutral">Default</Pill> : null}
        </span>
      }
      about={props.about}
      meta={
        props.editing ? undefined : (
          <Button
            variant="quiet"
            size="sm"
            disabled={!props.editable}
            onClick={props.onEdit}
          >
            Edit
          </Button>
        )
      }
      foot={
        props.editing ? (
          <SelectorSectionFoot
            lead={props.footLead}
            savable={props.savable}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ) : undefined
      }
    >
      {props.children}
      <SelectorSectionSaved saved={props.saved} onReload={props.onReload} />
    </Panel>
  );
}
