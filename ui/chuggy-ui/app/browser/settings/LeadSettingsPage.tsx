/**
 * The project's lead settings: what it is running under, the setting groups a
 * reader edits one at a time, and every revision that got it here.
 *
 * A WRITE THE REVISION MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the settings that moved; the section names the revision and stops, and the
 * boxes this reader never touched take what now stands rather than carrying
 * their stale copy of it back over another administrator's write. Every box
 * left empty is an override cleared, which is what the route means by omitting
 * a field, and the installation's value stands in the section instead.
 *
 * EVERY WRITE ON THIS PAGE IS THE WHOLE OVERRIDE SET. A section's Save and a
 * revision's Restore both go through `selectorSettingsWriting.ts`'s one door,
 * so the overrides no section draws are carried by each of them alike — the
 * same door the Lead page's strip writes mode and dispatch mode through.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../../src/contract/responses.ts";
import {
  apiSelectorSettings,
  apiSelectorSettingsHistory,
} from "../../core/apiRoutes.ts";
import { projectLeadPresent } from "../../core/projectLead.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  selectorSettingsSectionCleared,
  selectorSettingsSectionRestored,
  selectorSettingsTextNames,
  selectorSettingsWrite,
} from "../../core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
  SelectorSettingsSaved,
  SelectorSettingsSectionName,
} from "../../core/selectorSettingsForm.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import { useLead } from "../LeadPage.tsx";
import {
  selectorSettingsResource,
  selectorSettingsSaved,
  useSelectorSettingsDraft,
  useSelectorSettingsWriting,
} from "../selectorSettingsWriting.ts";
import type { SelectorSettingsWriting } from "../selectorSettingsWriting.ts";
import { Notice } from "../ui/Notice.tsx";
import { SelectorLimitsSection } from "./lead/SelectorLimitsSection.tsx";
import { SelectorRevisions } from "./lead/SelectorRevisions.tsx";
import { SelectorTextSection } from "./lead/SelectorTextSection.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

/** No frame names either read, so the partition's own refetch is what reaches
 * them. */
export const selectorSettingsHistoryResource = "selector-settings-history";

/** Which part of the page the last write belongs to, so its answer is drawn
 * where it was asked for and nowhere else. */
type SelectorSettingsWriter = SelectorSettingsSectionName | "revisions";

/** What one section is handed: its own slice of the draft, whether it is the
 * open one, and the answer to its own last write. */
interface SelectorSettingsSectionChrome {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly editing: SelectorSettingsSectionName | undefined;
  readonly writing: SelectorSettingsWriting<SelectorSettingsWriter>;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onOpen: (name: SelectorSettingsSectionName | undefined) => void;
  readonly onSave: (name: SelectorSettingsSectionName) => void;
  readonly onCancel: (name: SelectorSettingsSectionName) => void;
}

function SelectorSettingsSections(props: {
  readonly chrome: SelectorSettingsSectionChrome;
}): ReactNode {
  const chrome = props.chrome;
  const editing = chrome.editing;
  const savable =
    selectorSettingsWrite(chrome.draft).overrides !== undefined &&
    chrome.writing.saved.saved !== "Writing";
  return (
    <>
      {selectorSettingsTextNames.map((name) => (
        <SelectorTextSection
          key={name}
          name={name}
          draft={chrome.draft}
          effective={chrome.settings.effective[name] ?? "None"}
          editing={editing === name}
          editable={editing === undefined}
          savable={savable}
          saved={selectorSettingsSaved(chrome.writing, name)}
          onChange={chrome.onChange}
          onEdit={() => {
            chrome.onOpen(name);
          }}
          onCancel={() => {
            chrome.onCancel(name);
          }}
          onReset={() => {
            chrome.onChange(selectorSettingsSectionCleared(chrome.draft, name));
          }}
          onSave={() => {
            chrome.onSave(name);
          }}
          onReload={chrome.writing.reload}
        />
      ))}
      <SelectorLimitsSection
        draft={chrome.draft}
        settings={chrome.settings}
        faults={selectorSettingsWrite(chrome.draft).faults}
        editing={editing === "limits"}
        editable={editing === undefined}
        savable={savable}
        saved={selectorSettingsSaved(chrome.writing, "limits")}
        onChange={chrome.onChange}
        onEdit={() => {
          chrome.onOpen("limits");
        }}
        onCancel={() => {
          chrome.onCancel("limits");
        }}
        onSave={() => {
          chrome.onSave("limits");
        }}
        onReload={chrome.writing.reload}
      />
    </>
  );
}

function SelectorSettingsForm(props: {
  readonly partition: PartitionIdentity;
  readonly settings: SelectorProjectSettingsResponse;
}): ReactNode {
  const held = useSelectorSettingsDraft(props.settings);
  const writing = useSelectorSettingsWriting<SelectorSettingsWriter>(
    props.partition,
    held,
  );
  const [editing, setEditing] = useState<
    SelectorSettingsSectionName | undefined
  >(undefined);
  const chrome: SelectorSettingsSectionChrome = {
    draft: held.draft,
    settings: props.settings,
    editing,
    writing,
    onChange: held.setDraft,
    onOpen: setEditing,
    onSave: (name) => {
      const overrides = selectorSettingsWrite(held.draft).overrides;
      if (overrides === undefined) return;
      writing.write(name, overrides, () => {
        setEditing(undefined);
      });
    },
    onCancel: (name) => {
      held.setDraft(selectorSettingsSectionRestored(held.draft, name));
      setEditing(undefined);
    },
  };
  return (
    <>
      <SelectorSettingsSections chrome={chrome} />
      <SelectorSettingsHistory
        partition={props.partition}
        busy={writing.saved.saved === "Writing"}
        saved={selectorSettingsSaved(writing, "revisions")}
        onRestore={(overrides) => {
          writing.write("revisions", overrides, () => undefined);
        }}
      />
    </>
  );
}

function SelectorSettingsHistory(props: {
  readonly partition: PartitionIdentity;
  readonly busy: boolean;
  readonly saved: SelectorSettingsSaved;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const partition = props.partition;
  const nowMs = useNowMs();
  const state = usePanelResource(
    partition,
    "Project",
    selectorSettingsHistoryResource,
    (ports) => apiSelectorSettingsHistory(ports, partition),
  );
  return (
    <SelectorRevisions
      state={state}
      nowMs={nowMs}
      busy={props.busy}
      saved={props.saved}
      onRestore={props.onRestore}
    />
  );
}

/** What stands above the settings where the project has no lead: they say how
 * a lead would dispatch, and there is none here to do it. */
function SelectorSettingsUnled(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  if (projectLeadPresent(useLead(props.partition)) !== false) return null;
  return (
    <Notice
      tone="info"
      heading="No lead"
      detail="Tickets are dispatched by hand"
    />
  );
}

export function LeadSettingsPage(): ReactNode {
  const params = useParams({ from: settingsRoutes.project.lead });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const state = usePanelResource(
    partition,
    "Project",
    selectorSettingsResource,
    (ports) => apiSelectorSettings(ports, partition),
  );
  return (
    <SettingsPage
      title="Lead"
      chips={
        state.state === "Ready" ? (
          <span className="text-ink-3 text-sm tabular-nums">
            {`Revision ${String(state.value.revision)}`}
          </span>
        ) : null
      }
    >
      <SelectorSettingsUnled partition={partition} />
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SelectorSettingsForm partition={partition} settings={state.value} />
      ) : null}
    </SettingsPage>
  );
}
