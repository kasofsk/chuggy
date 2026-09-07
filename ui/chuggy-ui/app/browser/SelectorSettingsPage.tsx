/**
 * The project's selector settings: what it is running under, the setting groups
 * a reader edits one at a time, and every revision that got it here.
 *
 * A WRITE THE REVISION MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the settings that moved; the section names the revision and stops, and the
 * boxes this reader never touched take what now stands rather than carrying
 * their stale copy of it back over another administrator's write. Every box
 * left empty is an override cleared, which is what the route means by omitting
 * a field, and the installation's value stands in the section instead.
 *
 * EVERY WRITE ON THIS PAGE IS THE WHOLE OVERRIDE SET. A section's Save, the
 * strip's one press and a revision's Restore all go through the same door, so
 * the overrides no section draws are carried by each of them alike.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { SelectorProjectSettingsResponse } from "../../../../src/contract/responses.ts";
import {
  apiSelectorSettings,
  apiSelectorSettingsHistory,
  apiWriteSelectorSettings,
} from "../core/apiRoutes.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import {
  selectorSettingsAnswered,
  selectorSettingsDraft,
  selectorSettingsRebased,
  selectorSettingsSectionCleared,
  selectorSettingsSectionRestored,
  selectorSettingsTextNames,
  selectorSettingsWrite,
} from "../core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
  SelectorSettingsSaved,
  SelectorSettingsSectionName,
} from "../core/selectorSettingsForm.ts";
import { useApiPorts, usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { SelectorLimitsSection } from "./selector/SelectorLimitsSection.tsx";
import { SelectorRevisions } from "./selector/SelectorRevisions.tsx";
import { SelectorStrip } from "./selector/SelectorStrip.tsx";
import { SelectorTextSection } from "./selector/SelectorTextSection.tsx";
import { TopBarSlot } from "./shell/slots.tsx";

/** No frame names either read, so the partition's own refetch is what reaches
 * them. */
export const selectorSettingsResource = "selector-settings";
export const selectorSettingsHistoryResource = "selector-settings-history";

/** Which part of the page the last write belongs to, so its answer is drawn
 * where it was asked for and nowhere else. */
type SelectorSettingsWriter =
  SelectorSettingsSectionName | "strip" | "revisions";

interface SelectorSettingsHeld {
  readonly draft: SelectorSettingsDraft;
  readonly setDraft: (draft: SelectorSettingsDraft) => void;
}

/**
 * The draft, seeded from the read and rebased when THE READ moves — not when
 * the draft and the read merely differ, since a conflict moves the draft's own
 * revision ahead of the read's. It is a rebase rather than a reseed because a
 * read can move under an open form at any moment, including between a Save
 * click and its answer, and a reseed would take back text the reader had typed
 * in that window.
 */
function useSelectorSettingsDraft(
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsHeld {
  const [draft, setDraft] = useState<SelectorSettingsDraft>(() =>
    selectorSettingsDraft(settings),
  );
  const [seen, setSeen] = useState(settings.revision);
  if (seen !== settings.revision) {
    setSeen(settings.revision);
    const rebased = selectorSettingsRebased(draft, settings);
    setDraft(rebased);
    return { draft: rebased, setDraft };
  }
  return { draft, setDraft };
}

/**
 * What a write's own answer does to the page: a write that landed IS the newest
 * read, so it is written into the settings key rather than left for a refetch
 * nothing schedules — the route raises no `Project` frame, and the console
 * would otherwise resend the revision it has just moved and be told by itself
 * that somebody else wrote. A conflict moves the draft instead, keeping what
 * the reader typed and taking the revision and the untouched overrides the
 * route says stand, so the next Save is a decision they make once rather than a
 * button that can only refuse.
 */
function selectorSettingsApply(
  answered: SelectorSettingsSaved,
  held: SelectorSettingsHeld,
  wrote: (settings: SelectorProjectSettingsResponse) => void,
): void {
  switch (answered.saved) {
    case "Written":
      wrote(answered.settings);
      return;
    case "Conflict":
      held.setDraft(selectorSettingsRebased(held.draft, answered.settings));
      return;
    case "Idle":
    case "Writing":
    case "Failed":
      return;
  }
}

/** The one door every write on this page goes through, and what it answered. */
interface SelectorSettingsWriting {
  readonly saved: SelectorSettingsSaved;
  readonly writer: SelectorSettingsWriter | undefined;
  readonly write: (
    writer: SelectorSettingsWriter,
    overrides: SelectorProjectOverrides,
    wrote: () => void,
  ) => void;
  readonly reload: () => void;
}

function useSelectorSettingsWriting(
  partition: PartitionIdentity,
  held: SelectorSettingsHeld,
): SelectorSettingsWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [saved, setSaved] = useState<SelectorSettingsSaved>({ saved: "Idle" });
  const [writer, setWriter] = useState<SelectorSettingsWriter | undefined>(
    undefined,
  );
  const key = projectResourceKey(
    partition,
    "Project",
    selectorSettingsResource,
  );
  return {
    saved,
    writer,
    reload: () => {
      void client.invalidateQueries({ queryKey: key });
    },
    write: (asked, overrides, wrote) => {
      setWriter(asked);
      setSaved({ saved: "Writing" });
      void (async () => {
        const answered = selectorSettingsAnswered(
          await apiWriteSelectorSettings(ports, partition, {
            expectedRevision: held.draft.revision,
            overrides,
          }),
        );
        setSaved(answered);
        selectorSettingsApply(answered, held, (settings) => {
          client.setQueryData(key, settings);
          wrote();
        });
      })();
    },
  };
}

/** What one section is handed: its own slice of the draft, whether it is the
 * open one, and the answer to its own last write. */
interface SelectorSettingsSectionChrome {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly editing: SelectorSettingsSectionName | undefined;
  readonly writing: SelectorSettingsWriting;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
  readonly onOpen: (name: SelectorSettingsSectionName | undefined) => void;
  readonly onSave: (name: SelectorSettingsSectionName) => void;
  readonly onCancel: (name: SelectorSettingsSectionName) => void;
}

function selectorSettingsSaved(
  writing: SelectorSettingsWriting,
  writer: SelectorSettingsWriter,
): SelectorSettingsSaved {
  return writing.writer === writer ? writing.saved : { saved: "Idle" };
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
  const writing = useSelectorSettingsWriting(props.partition, held);
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
      <SelectorStrip
        draft={held.draft}
        settings={props.settings}
        editable={editing === undefined}
        busy={writing.saved.saved === "Writing"}
        saved={selectorSettingsSaved(writing, "strip")}
        onPress={(overrides) => {
          writing.write("strip", overrides, () => undefined);
        }}
      />
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

export function SelectorSettingsPage(): ReactNode {
  const params = useParams({ from: "/$tenant/$project/selector" });
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
    <div className="grid min-w-0 max-w-settings gap-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Selector</h1>
        {state.state === "Ready" ? (
          <span className="text-ink-3 text-sm tabular-nums">
            {`Revision ${String(state.value.revision)}`}
          </span>
        ) : null}
      </TopBarSlot>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SelectorSettingsForm partition={partition} settings={state.value} />
      ) : null}
    </div>
  );
}
