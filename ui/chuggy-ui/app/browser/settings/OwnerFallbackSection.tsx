/**
 * Whether a member's own runners take the work they start in this project,
 * beside its placement: read by anyone who reads the project, and edited by
 * one the read says administers it.
 *
 * A run keeps the fallback it was registered under, so a change reaches only
 * runs registered after it; the line under each value says what it does to
 * those.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ProjectOwnerFallbackResponse } from "../../../../../src/contract/responses.ts";
import type { OwnerFallback } from "../../../../../src/contract/rosters.ts";
import {
  apiOwnerFallback,
  apiWriteOwnerFallback,
} from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  ownerFallbackAbout,
  ownerFallbackChoices,
  ownerFallbackChosen,
  ownerFallbackLabel,
  ownerFallbackPinned,
  ownerFallbackValue,
} from "../../core/myRunner.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { SettingsSection } from "../ui/SettingsSection.tsx";
import { ownerFallbackResource } from "../workRunner.tsx";

const ownerFallbackTitle = "Personal runners";

type OwnerFallbackSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | { readonly saved: "Written" }
  | { readonly saved: "Failed"; readonly reason: string };

function OwnerFallbackNotice(props: {
  readonly saved: OwnerFallbackSaved;
}): ReactNode {
  const saved = props.saved;
  switch (saved.saved) {
    case "Idle":
      return null;
    case "Writing":
      return <Notice tone="info" inline detail="Writing" />;
    case "Written":
      return <Notice tone="live" inline detail="Written" />;
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
      );
  }
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
  const ports = useApiPorts();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OwnerFallback | undefined>(
    props.read.fallback,
  );
  const [saved, setSaved] = useState<OwnerFallbackSaved>({ saved: "Idle" });
  const write = async (): Promise<void> => {
    setSaved({ saved: "Writing" });
    const answered = await apiWriteOwnerFallback(
      ports,
      props.partition,
      draft === undefined ? {} : { fallback: draft },
    );
    if (answered.outcome !== "Ok") {
      setSaved({ saved: "Failed", reason: panelReason(answered) });
      return;
    }
    const key = projectResourceKey(
      props.partition,
      "Project",
      ownerFallbackResource,
    );
    await client.cancelQueries({ queryKey: key });
    client.setQueryData(key, answered.value);
    setSaved({ saved: "Written" });
    setEditing(false);
  };
  return (
    <SettingsSection
      title={ownerFallbackTitle}
      about={`Whether a member's own runners take the work they start here. ${ownerFallbackPinned}`}
      editing={editing}
      editable={props.read.administers}
      savable={saved.saved !== "Writing"}
      footLead={null}
      {...(saved.saved === "Idle"
        ? {}
        : { notice: <OwnerFallbackNotice saved={saved} /> })}
      onEdit={() => {
        setDraft(props.read.fallback);
        setSaved({ saved: "Idle" });
        setEditing(true);
      }}
      onCancel={() => {
        setEditing(false);
      }}
      onSave={() => {
        if (draft === props.read.fallback) setEditing(false);
        else void write();
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
  const read = usePanelResource(
    partition,
    "Project",
    ownerFallbackResource,
    (ports) => apiOwnerFallback(ports, partition),
  );
  return read.state === "Ready" ? (
    <OwnerFallbackEditing partition={partition} read={read.value} />
  ) : (
    <Panel variant="section" title={ownerFallbackTitle}>
      <PanelUnready state={read} />
    </Panel>
  );
}
