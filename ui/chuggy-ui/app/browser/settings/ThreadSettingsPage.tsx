/**
 * The project's thread settings: what its threads run under, the setting groups
 * a reader edits one at a time, and every revision that got it here.
 *
 * A WRITE THE REVISION MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the settings that moved; the section names the revision and stops, and the
 * boxes this reader never touched take what now stands rather than carrying
 * their stale copy of it back over another administrator's write. Every box
 * left empty is an override cleared, which is what the route means by omitting
 * a field, and the default stands in the section instead.
 *
 * EVERY WRITE ON THIS PAGE IS THE WHOLE OVERRIDE SET. A section's Save and a
 * revision's Restore both go through `selectorSettingsWriting.ts`'s one door.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../../src/contract/responses.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import type { Copy } from "../../core/copy.ts";
import {
  selectorSettingsSection,
  selectorSettingsSectionCleared,
  selectorSettingsSectionRestored,
  selectorSettingsTextNames,
  selectorSettingsWrite,
} from "../../core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
  SelectorSettingsSectionName,
} from "../../core/selectorSettingsForm.ts";
import {
  selectorSettingsHistoryQuery,
  selectorSettingsQuery,
} from "../../core/projectQueries.ts";
import { usePanelState } from "../api.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useNowMs } from "../Freshness.tsx";
import {
  selectorSettingsShown,
  useSelectorSettingsDraft,
  useSelectorSettingsWriting,
} from "../selectorSettingsWriting.ts";
import type {
  SelectorSettingsPressed,
  SelectorSettingsShown,
  SelectorSettingsWriting,
} from "../selectorSettingsWriting.ts";
import { SelectorModelsSection } from "./threads/SelectorModelsSection.tsx";
import type { SelectorRowsChrome } from "./threads/SelectorRowsSection.tsx";
import { SelectorRevisions } from "./threads/SelectorRevisions.tsx";
import { SelectorTextSection } from "./threads/SelectorTextSection.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { ProjectDeletion } from "./UnrunDeletion.tsx";

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

/** The Models section's chrome, as the page holds it. */
function selectorModelsChrome(
  chrome: SelectorSettingsSectionChrome,
  ready: boolean,
): SelectorRowsChrome {
  const name = "models";
  return {
    draft: chrome.draft,
    faults: selectorSettingsWrite(chrome.draft).faults,
    editing: chrome.editing === name,
    editable: chrome.editing === undefined,
    ready,
    saved: selectorSettingsShown(chrome.writing, name),
    onChange: chrome.onChange,
    onEdit: () => {
      chrome.onOpen(name);
    },
    onCancel: () => {
      chrome.onCancel(name);
    },
    onSave: () => {
      chrome.onSave(name);
    },
    onReload: chrome.writing.reload,
  };
}

function SelectorSettingsSections(props: {
  readonly chrome: SelectorSettingsSectionChrome;
}): ReactNode {
  const text = useCopyText();
  const chrome = props.chrome;
  const editing = chrome.editing;
  const ready = selectorSettingsWrite(chrome.draft).overrides !== undefined;
  return (
    <>
      {selectorSettingsTextNames.map((name) => (
        <SelectorTextSection
          key={name}
          name={name}
          draft={chrome.draft}
          effective={
            chrome.settings.effective[name] ??
            text({ id: "settings-threads-effective-none" })
          }
          editing={editing === name}
          editable={editing === undefined}
          ready={ready}
          saved={selectorSettingsShown(chrome.writing, name)}
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
      <SelectorModelsSection {...selectorModelsChrome(chrome, ready)} />
    </>
  );
}

/** What a landed write's toast says: the section saved, or the revision a
 * restore was written as. */
function selectorSettingsLandedSaid(
  settings: SelectorProjectSettingsResponse,
  pressed: SelectorSettingsPressed<SelectorSettingsWriter>,
): Copy {
  const revision = String(settings.revision);
  if (pressed.writer === "revisions")
    return { id: "settings-threads-history-restored", args: { revision } };
  return {
    id: "settings-threads-saved",
    args: { section: selectorSettingsSection(pressed.writer).title, revision },
  };
}

function SelectorSettingsForm(props: {
  readonly partition: PartitionIdentity;
  readonly settings: SelectorProjectSettingsResponse;
}): ReactNode {
  const held = useSelectorSettingsDraft(props.settings);
  const writing = useSelectorSettingsWriting<SelectorSettingsWriter>(
    props.partition,
    held,
    selectorSettingsLandedSaid,
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
        busy={writing.saving.isPending}
        saved={selectorSettingsShown(writing, "revisions")}
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
  readonly saved: SelectorSettingsShown | undefined;
  readonly onRestore: (overrides: SelectorProjectOverrides) => void;
}): ReactNode {
  const partition = props.partition;
  const nowMs = useNowMs();
  const state = usePanelState(selectorSettingsHistoryQuery(partition));
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

export function ThreadSettingsPage(): ReactNode {
  const text = useCopyText();
  const params = useParams({ from: settingsRoutes.project.threads });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const state = usePanelState(selectorSettingsQuery(partition));
  return (
    <SettingsPage
      title={text({ id: "settings-threads-title" })}
      chips={
        state.state === "Ready" ? (
          <span className="text-ink-3 text-sm tabular-nums">
            {text({
              id: "settings-threads-revision",
              args: { revision: String(state.value.revision) },
            })}
          </span>
        ) : null
      }
    >
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SelectorSettingsForm partition={partition} settings={state.value} />
      ) : null}
      <ProjectDeletion partition={partition} />
    </SettingsPage>
  );
}
