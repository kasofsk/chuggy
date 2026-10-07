/**
 * The fields a ticket may override of a configuration, each drawn as the
 * configuration says it until it is overridden and editable from then on.
 *
 * It holds nothing and knows no form: given a configuration document, the
 * overrides held and the fields it may draw, it says what changed. An
 * override replaces the configuration's field whole, so an editor starts from
 * the whole of it, and giving one back removes it.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import {
  overrideFieldKind,
  overrideFieldLabel,
  overrideFieldOf,
  overrideFilesOf,
  overrideHeld,
  overrideLinesOf,
  overrideModelChosen,
  overrideModelConfigured,
  overrideModelDrawn,
  overrideModelSays,
  overrideModelTyped,
} from "../core/ticketOverrides.ts";
import type {
  CreationOverrides,
  OverrideField,
  OverrideFile,
} from "../core/ticketOverrides.ts";
import { Button } from "./ui/Button.tsx";

interface OverridesEdit {
  readonly document: unknown;
  readonly overrides: CreationOverrides;
  readonly onChange: (overrides: CreationOverrides) => void;
  /** What the contract refuses of a field, stated beside it. */
  readonly faults?: ReadonlyMap<OverrideField, string>;
}

function OverrideFault(props: {
  readonly reason: string | undefined;
}): ReactNode {
  return props.reason === undefined ? null : (
    <p className="text-tone-fail">{props.reason}</p>
  );
}

/** Lines edited one per line, the box holding the whole list. */
function LinesEditor(props: {
  readonly label: string;
  readonly lines: readonly string[];
  readonly onChange: (lines: readonly string[]) => void;
}): ReactNode {
  return (
    <textarea
      aria-label={props.label}
      rows={Math.min(Math.max(props.lines.length, 2), 12)}
      value={props.lines.join("\n")}
      onChange={(event) => {
        const text = event.target.value;
        props.onChange(text === "" ? [] : text.split("\n"));
      }}
    />
  );
}

function FilesEditor(props: {
  readonly label: string;
  readonly files: readonly OverrideFile[];
  readonly onChange: (files: readonly OverrideFile[]) => void;
}): ReactNode {
  const { files, onChange } = props;
  const changed = (index: number, file: OverrideFile): void => {
    onChange(files.map((held, at) => (at === index ? file : held)));
  };
  return (
    <div className="grid gap-1">
      {files.map((file, index) => (
        <div key={index} className="grid gap-1">
          <input
            type="text"
            aria-label={`${props.label} ${String(index + 1)} path`}
            value={file.path}
            placeholder="a path in the workspace"
            onChange={(event) => {
              changed(index, { ...file, path: event.target.value });
            }}
          />
          <textarea
            aria-label={`${props.label} ${String(index + 1)} content`}
            rows={4}
            value={file.content}
            onChange={(event) => {
              changed(index, { ...file, content: event.target.value });
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              onChange(files.filter((_, at) => at !== index));
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        onClick={() => {
          onChange([...files, { path: "", content: "" }]);
        }}
      >
        Add file
      </Button>
    </div>
  );
}

/** A value as the configuration says it, read-only. */
function ConfiguredValue(props: {
  readonly field: OverrideField;
  readonly value: unknown;
}): ReactNode {
  if (props.value === undefined) return <p className="text-ink-3">None</p>;
  switch (overrideFieldKind(props.field)) {
    case "Lines": {
      const lines = overrideLinesOf(props.value);
      return lines.length === 0 ? (
        <p className="text-ink-3">None</p>
      ) : (
        <pre className="whitespace-pre-wrap">{lines.join("\n")}</pre>
      );
    }
    case "Files":
    case "Mode":
      return (
        <pre className="whitespace-pre-wrap">
          {JSON.stringify(props.value, null, 2)}
        </pre>
      );
  }
}

function OverriddenEditor(props: {
  readonly field: OverrideField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}): ReactNode {
  const label = overrideFieldLabel(props.field);
  switch (overrideFieldKind(props.field)) {
    case "Lines":
      return (
        <LinesEditor
          label={label}
          lines={overrideLinesOf(props.value)}
          onChange={props.onChange}
        />
      );
    case "Files":
      return (
        <FilesEditor
          label={label}
          files={overrideFilesOf(props.value)}
          onChange={props.onChange}
        />
      );
    case "Mode":
      return <ConfiguredValue field={props.field} value={props.value} />;
  }
}

/** One field: the configuration's, with the way to override it, or
 * overridden, with the way to give it back. */
function OverrideRow(
  props: OverridesEdit & { readonly field: OverrideField },
): ReactNode {
  const { document, field, overrides, onChange } = props;
  const label = overrideFieldLabel(field);
  const configured = overrideFieldOf(document, field);
  const held = overrides[field];
  return (
    <div className="creation-row">
      <span>
        {label}
        {held === undefined ? null : (
          <span className="text-ink-3 text-xs"> · Overridden</span>
        )}
      </span>
      {held === undefined ? (
        <ConfiguredValue field={field} value={configured} />
      ) : (
        <OverriddenEditor
          field={field}
          value={held}
          onChange={(value) => {
            onChange(overrideHeld(overrides, field, value));
          }}
        />
      )}
      <Button
        size="sm"
        onClick={() => {
          onChange(
            overrideHeld(
              overrides,
              field,
              held === undefined ? (configured ?? []) : undefined,
            ),
          );
        }}
      >
        {held === undefined
          ? `Override ${label.toLowerCase()}`
          : "Use the configuration's"}
      </Button>
      <OverrideFault reason={props.faults?.get(field)} />
    </div>
  );
}

/**
 * The model, which is written into the mode: free text, the configuration's
 * own model shown where nothing is typed. The box keeps what was typed while
 * it says what the overrides hold, so typing the configuration's own model
 * does not empty it.
 */
function ModelRow(props: OverridesEdit): ReactNode {
  const { document, overrides, onChange } = props;
  const box = useId();
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const shown =
    typed !== undefined && overrideModelSays(overrides, document, typed)
      ? typed
      : overrideModelTyped(overrides);
  const mode = overrides["worker.mode"];
  return (
    <div className="creation-row">
      <label htmlFor={box}>
        Model
        {mode === undefined ? null : (
          <span className="text-ink-3 text-xs"> · Overridden</span>
        )}
      </label>
      <input
        id={box}
        type="text"
        value={shown}
        placeholder={overrideModelConfigured(document) ?? ""}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(
            overrideModelChosen(overrides, document, event.target.value),
          );
        }}
      />
      {mode === undefined ? null : (
        <>
          <ConfiguredValue field="worker.mode" value={mode} />
          <Button
            size="sm"
            onClick={() => {
              setTyped(undefined);
              onChange(overrideHeld(overrides, "worker.mode", undefined));
            }}
          >
            Use the configuration's
          </Button>
        </>
      )}
      <OverrideFault reason={props.faults?.get("worker.mode")} />
    </div>
  );
}

export function ConfigurationOverrides(
  props: OverridesEdit & { readonly fields: readonly OverrideField[] },
): ReactNode {
  return (
    <div className="grid gap-2">
      {props.fields.map((field) => {
        if (overrideFieldKind(field) !== "Mode")
          return <OverrideRow key={field} {...props} field={field} />;
        return overrideModelDrawn(props.document) ? (
          <ModelRow key={field} {...props} />
        ) : null;
      })}
    </div>
  );
}
