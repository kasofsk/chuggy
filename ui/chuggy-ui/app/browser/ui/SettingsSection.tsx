/**
 * One setting group as a card: what it is, the Edit that opens it, the foot its
 * cancel and save sit in, and the line its last write left.
 *
 * A section is read until its Edit is pressed and only one is open at a time,
 * so the chrome is here and a page supplies its own body, the left half of its
 * foot, and the notice its own write answers with. The notice is a node rather
 * than a state because what a write can answer is the route's, and no two
 * routes answer the same set.
 */

import type { ReactNode } from "react";

import { Button } from "./Button.tsx";
import { Panel } from "./Panel.tsx";

/** What the last write of this section did, beside the one action a conflict
 * leaves open: taking what now stands. */
function SettingsSectionSaved(props: {
  readonly notice: ReactNode;
  readonly onReload: (() => void) | undefined;
}): ReactNode {
  if (props.notice === undefined) return null;
  return (
    <div className="flex items-center gap-2">
      {props.notice}
      {props.onReload === undefined ? null : (
        <Button size="sm" onClick={props.onReload}>
          Reload
        </Button>
      )}
    </div>
  );
}

function SettingsSectionFoot(props: {
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

export function SettingsSection(props: {
  readonly title: ReactNode;
  readonly about: string;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly savable: boolean;
  readonly notice?: ReactNode;
  readonly footLead: ReactNode;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onReload?: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Panel
      variant="section"
      title={props.title}
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
          <SettingsSectionFoot
            lead={props.footLead}
            savable={props.savable}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ) : undefined
      }
    >
      {props.children}
      <SettingsSectionSaved notice={props.notice} onReload={props.onReload} />
    </Panel>
  );
}
