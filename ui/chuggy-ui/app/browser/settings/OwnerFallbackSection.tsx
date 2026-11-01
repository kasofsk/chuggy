/**
 * Whether a member's own runners take the work they start in this project,
 * beside its placement: read by anyone who reads the project, and edited by
 * one the read says administers it.
 *
 * A run keeps the fallback it was registered under, so a change reaches only
 * runs registered after it; the line under each value says what it does to
 * those.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectOwnerFallbackResponse } from "../../../../../src/contract/responses.ts";
import type { OwnerFallback } from "../../../../../src/contract/rosters.ts";
import { apiWriteOwnerFallback } from "../../core/apiRoutes.ts";
import { failureWords } from "../../core/failureWords.ts";
import {
  ownerFallbackAbout,
  ownerFallbackChoices,
  ownerFallbackChosen,
  ownerFallbackLabel,
  ownerFallbackPinned,
  ownerFallbackValue,
} from "../../core/myRunner.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { ownerFallbackQuery } from "../../core/projectQueries.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";

const ownerFallbackTitle = "Personal runners";

/** The write's line: under way, landed, or refused in the write's own words. */
function OwnerFallbackNotice(props: {
  readonly saving: ConsoleWriting<OwnerFallback | undefined, unknown>;
}): ReactNode {
  const saving = props.saving;
  if (saving.isPending) return <Notice tone="info" inline detail="Writing" />;
  if (saving.error !== null)
    return <Notice tone="danger" inline detail={saving.error.message} />;
  if (saving.isSuccess) return <Notice tone="live" inline detail="Written" />;
  return null;
}

/** The project's fallback written, and the read under it answered before the
 * write is over. */
function ownerFallbackWrite(
  partition: PartitionIdentity,
): ConsoleWrite<OwnerFallback | undefined, ProjectOwnerFallbackResponse> {
  return {
    mutationKey: consoleWriteKey(
      "owner-fallback",
      partition.tenant,
      partition.project,
    ),
    write: (ports, fallback) =>
      apiWriteOwnerFallback(
        ports,
        partition,
        fallback === undefined ? {} : { fallback },
      ),
    refusal: (failure) => failureWords(failure).word,
    landed: async (client, written) => {
      const key = ownerFallbackQuery(partition).queryKey;
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, written);
    },
  };
}

function OwnerFallbackRead(props: {
  readonly fallback: OwnerFallback | undefined;
}): ReactNode {
  return (
    <div className="grid gap-1">
      <span className="text-ink-1">{ownerFallbackLabel(props.fallback)}</span>
      <span className="text-sm text-ink-3">
        {ownerFallbackAbout(props.fallback)}
      </span>
    </div>
  );
}

function OwnerFallbackChoice(props: {
  readonly draft: OwnerFallback | undefined;
  readonly onChoose: (fallback: OwnerFallback | undefined) => void;
}): ReactNode {
  return (
    <RadioGroup
      label={ownerFallbackTitle}
      value={ownerFallbackValue(props.draft)}
      options={ownerFallbackChoices.map((fallback) => ({
        value: ownerFallbackValue(fallback),
        text: ownerFallbackLabel(fallback),
        description: ownerFallbackAbout(fallback),
      }))}
      onChoose={(value) => {
        const chosen = ownerFallbackChosen(value);
        if (chosen !== undefined) props.onChoose(chosen.fallback);
      }}
    />
  );
}

function OwnerFallbackEditing(props: {
  readonly partition: PartitionIdentity;
  readonly read: ProjectOwnerFallbackResponse;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OwnerFallback | undefined>(
    props.read.fallback,
  );
  const saving = useConsoleWrite(ownerFallbackWrite(props.partition), {
    drawn: true,
  });
  const shown = saving.isPending || saving.error !== null || saving.isSuccess;
  return (
    <SettingsSection
      title={ownerFallbackTitle}
      about={`Whether a member's own runners take the work they start here. ${ownerFallbackPinned}`}
      editing={editing}
      editable={props.read.administers}
      savable={!saving.isPending}
      footLead={null}
      {...(shown ? { notice: <OwnerFallbackNotice saving={saving} /> } : {})}
      onEdit={() => {
        setDraft(props.read.fallback);
        saving.reset();
        setEditing(true);
      }}
      onCancel={() => {
        setEditing(false);
      }}
      onSave={() => {
        if (draft === props.read.fallback) setEditing(false);
        else
          saving.mutate(draft, {
            onSuccess: () => {
              setEditing(false);
            },
          });
      }}
    >
      {editing ? (
        <OwnerFallbackChoice draft={draft} onChoose={setDraft} />
      ) : (
        <OwnerFallbackRead fallback={props.read.fallback} />
      )}
    </SettingsSection>
  );
}

export function OwnerFallbackSection(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const partition = props.partition;
  const read = usePanelState(ownerFallbackQuery(partition));
  return read.state === "Ready" ? (
    <OwnerFallbackEditing partition={partition} read={read.value} />
  ) : (
    <Panel variant="section" title={ownerFallbackTitle}>
      <PanelUnready state={read} />
    </Panel>
  );
}
