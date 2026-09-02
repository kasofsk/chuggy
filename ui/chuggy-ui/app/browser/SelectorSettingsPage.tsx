/**
 * The project's selector settings, written whole under the revision they were
 * read at: the North Star, the base prompt, the two modes and the five limits a
 * project may set for itself.
 *
 * A WRITE THE REVISION MOVED UNDER IS NOT RETRIED. The route answers `409` with
 * the settings that moved, and this draws the revision rather than reapplying a
 * draft over somebody else's write. Every box left empty is an override
 * cleared, which is what the route means by omitting a field, and the effective
 * value stands in the box as what the project runs under instead.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  selectorDispatchModes,
  selectorModes,
} from "../../../../src/contract/rosters.ts";
import type {
  SelectorProjectSettingsResponse,
  SelectorSettingsHistoryResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiSelectorSettings,
  apiSelectorSettingsHistory,
  apiWriteSelectorSettings,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import {
  selectorSettingsAnswered,
  selectorSettingsDraft,
  selectorSettingsLimitLabel,
  selectorSettingsLimitNames,
  selectorSettingsWrite,
} from "../core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsLimitName,
  SelectorSettingsSaved,
} from "../core/selectorSettingsForm.ts";
import { useApiPorts, usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Field, Fields } from "./ui/Fields.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";

import "./selectorSettings.css";

/** No frame names either read, so the partition's own refetch is what reaches
 * them. */
export const selectorSettingsResource = "selector-settings";
export const selectorSettingsHistoryResource = "selector-settings-history";

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
      return (
        <Notice
          tone="parked"
          inline
          detail={`Conflict · ${String(saved.revision)}`}
        />
      );
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Failed · ${saved.reason}`} />
      );
  }
}

interface SelectorFieldChrome {
  readonly draft: SelectorSettingsDraft;
  readonly settings: SelectorProjectSettingsResponse;
  readonly faults: Readonly<Record<string, string>>;
  readonly onChange: (draft: SelectorSettingsDraft) => void;
}

function SelectorLimitField(props: {
  readonly chrome: SelectorFieldChrome;
  readonly name: SelectorSettingsLimitName;
}): ReactNode {
  const { chrome, name } = props;
  const label = selectorSettingsLimitLabel(name);
  const fault = chrome.faults[`limits.${name}`];
  return (
    <Field name={label} absent={chrome.draft.limits[name] === ""}>
      <input
        className="selector-input num"
        aria-label={label}
        aria-invalid={fault !== undefined}
        inputMode="numeric"
        value={chrome.draft.limits[name]}
        placeholder={String(chrome.settings.effective.limits[name])}
        onChange={(event) => {
          chrome.onChange({
            ...chrome.draft,
            limits: { ...chrome.draft.limits, [name]: event.target.value },
          });
        }}
      />
      {fault === undefined ? null : <Pill tone="fail">{fault}</Pill>}
    </Field>
  );
}

function SelectorModeField(props: {
  readonly label: string;
  readonly choices: readonly string[];
  readonly value: string;
  readonly effective: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field name={props.label} absent={props.value === ""}>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      >
        <option value="">{props.effective}</option>
        {props.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SelectorTextFields(props: {
  readonly chrome: SelectorFieldChrome;
}): ReactNode {
  const chrome = props.chrome;
  const draft = chrome.draft;
  return (
    <Fields>
      <Field name="North Star" absent={draft.northStar === ""}>
        <textarea
          className="selector-text"
          aria-label="North Star"
          aria-invalid={chrome.faults["northStar"] !== undefined}
          value={draft.northStar}
          placeholder={chrome.settings.effective.northStar ?? "None"}
          onChange={(event) => {
            chrome.onChange({ ...draft, northStar: event.target.value });
          }}
        />
      </Field>
      <Field name="Base prompt" absent={draft.basePrompt === ""}>
        <textarea
          className="selector-text"
          aria-label="Base prompt"
          aria-invalid={chrome.faults["basePrompt"] !== undefined}
          value={draft.basePrompt}
          placeholder={chrome.settings.effective.basePrompt}
          onChange={(event) => {
            chrome.onChange({ ...draft, basePrompt: event.target.value });
          }}
        />
      </Field>
    </Fields>
  );
}

function SelectorLimitFields(props: {
  readonly chrome: SelectorFieldChrome;
}): ReactNode {
  const chrome = props.chrome;
  return (
    <Fields>
      <SelectorModeField
        label="Mode"
        choices={selectorModes}
        value={chrome.draft.mode}
        effective={chrome.settings.effective.mode}
        onChange={(mode) => {
          chrome.onChange({ ...chrome.draft, mode });
        }}
      />
      <SelectorModeField
        label="Dispatch"
        choices={selectorDispatchModes}
        value={chrome.draft.dispatchMode}
        effective={chrome.settings.effective.dispatchMode}
        onChange={(dispatchMode) => {
          chrome.onChange({ ...chrome.draft, dispatchMode });
        }}
      />
      {selectorSettingsLimitNames.map((name) => (
        <SelectorLimitField key={name} chrome={chrome} name={name} />
      ))}
    </Fields>
  );
}

/**
 * The draft, seeded from the read and reseeded when the revision moves. It is
 * adjusted during the render that sees the new revision, so no edit is made
 * against a revision the form is no longer holding.
 */
function useSelectorSettingsDraft(settings: SelectorProjectSettingsResponse): {
  readonly draft: SelectorSettingsDraft;
  readonly setDraft: (draft: SelectorSettingsDraft) => void;
} {
  const [draft, setDraft] = useState<SelectorSettingsDraft>(() =>
    selectorSettingsDraft(settings),
  );
  if (draft.revision !== settings.revision) {
    const seeded = selectorSettingsDraft(settings);
    setDraft(seeded);
    return { draft: seeded, setDraft };
  }
  return { draft, setDraft };
}

function SelectorSettingsForm(props: {
  readonly partition: PartitionIdentity;
  readonly settings: SelectorProjectSettingsResponse;
}): ReactNode {
  const ports = useApiPorts();
  const held = useSelectorSettingsDraft(props.settings);
  const [saved, setSaved] = useState<SelectorSettingsSaved>({ saved: "Idle" });
  const write = selectorSettingsWrite(held.draft);
  const chrome: SelectorFieldChrome = {
    draft: held.draft,
    settings: props.settings,
    faults: write.faults,
    onChange: held.setDraft,
  };
  const submit = () => {
    const overrides = write.overrides;
    if (overrides === undefined) return;
    setSaved({ saved: "Writing" });
    void (async () => {
      setSaved(
        selectorSettingsAnswered(
          await apiWriteSelectorSettings(ports, props.partition, {
            expectedRevision: held.draft.revision,
            overrides,
          }),
        ),
      );
    })();
  };
  return (
    <div className="selector-form">
      <SelectorSettingsSavedNotice saved={saved} />
      <SelectorTextFields chrome={chrome} />
      <SelectorLimitFields chrome={chrome} />
      <Button
        variant="primary"
        disabled={write.overrides === undefined || saved.saved === "Writing"}
        onClick={submit}
      >
        Save
      </Button>
    </div>
  );
}

function SelectorHistoryRows(props: {
  readonly history: SelectorSettingsHistoryResponse;
  readonly nowMs: number;
}): ReactNode {
  if (props.history.revisions.length === 0)
    return <EmptyState label="No revisions" />;
  return (
    <Table caption="Settings revisions">
      <thead>
        <tr>
          <th scope="col">Revision</th>
          <th scope="col">Administrator</th>
          <th scope="col">Recorded</th>
        </tr>
      </thead>
      <tbody>
        {props.history.revisions.map((revision) => (
          <tr key={revision.revision}>
            <td className="num">{revision.revision}</td>
            <td>{revision.administrator.subject}</td>
            <td>
              <Figure
                figure={instantFigure(revision.recordedAt, props.nowMs)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SelectorSettingsHistory(props: {
  readonly partition: PartitionIdentity;
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
    <DataPanel title="Revisions" state={state}>
      {(history) => <SelectorHistoryRows history={history} nowMs={nowMs} />}
    </DataPanel>
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
    <div className="selector">
      <h1>Selector</h1>
      <DataPanel title="Objectives" state={state}>
        {(settings) => (
          <SelectorSettingsForm partition={partition} settings={settings} />
        )}
      </DataPanel>
      <SelectorSettingsHistory partition={partition} />
    </div>
  );
}
