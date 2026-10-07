/**
 * What one ticket overrides of its configuration, as a form holds it: each
 * field the contract lets a ticket override, under its path, holding the value
 * that replaces the configuration's whole.
 *
 * THE FIELDS ARE THE CONTRACT'S. They are read off
 * `configurationOverridesSchema` itself, and what each is called and edited
 * with is a record over them that does not compile without a new one.
 *
 * A HELD VALUE IS UNJUDGED. A form holds what was typed or read, the mode as
 * its document writes it among them, and the body the form becomes is what
 * the contract's schema judges.
 *
 * THE MODEL IS WRITTEN THROUGH THE MODE. It is the override a reader reaches
 * for, so it is offered alone, and writing it overrides `worker.mode` with
 * that one thing changed; a model that leaves the mode as the configuration
 * wrote it is no override.
 */

import {
  configurationOverridesSchema,
  configurationWithOverrides,
} from "../../../../src/contract/configurationOverrides.ts";
import type { ConfigurationOverrides } from "../../../../src/contract/configurationOverrides.ts";

import {
  configurationModeModel,
  configurationModeOf,
  configurationModeWithModel,
  configurationViewOf,
} from "./configurationView.ts";
import type {
  ConfigurationMode,
  ConfigurationView,
} from "./configurationView.ts";

type Overrides = ConfigurationOverrides;

/** One overridable field by its path in a configuration: a top-level list by
 * its name, and a field of a block beside the block's. */
export type OverrideField = {
  [Key in Extract<keyof Overrides, string>]-?: NonNullable<
    Overrides[Key]
  > extends readonly unknown[]
    ? Key
    : `${Key}.${Extract<keyof NonNullable<Overrides[Key]>, string>}`;
}[Extract<keyof Overrides, string>];

/** How a field is edited: lines one per line, files each a path and its
 * content, and the mode through its model. */
export type OverrideKind = "Lines" | "Files" | "Mode";

const overrideFieldDrawn = {
  "worker.mode": { label: "Model", kind: "Mode" },
  "worker.setup": { label: "Setup", kind: "Lines" },
  "worker.files": { label: "Files", kind: "Files" },
  practices: { label: "Practices", kind: "Lines" },
  "brief.motivation": { label: "Motivation", kind: "Lines" },
  "brief.acceptanceCriteria": { label: "Acceptance criteria", kind: "Lines" },
  "brief.constraints": { label: "Constraints", kind: "Lines" },
  "work.instructions": { label: "Work instructions", kind: "Lines" },
} as const satisfies Record<
  OverrideField,
  { readonly label: string; readonly kind: OverrideKind }
>;

/** Every overridable field, in the order the contract's schema declares them. */
export const overrideFields: readonly OverrideField[] = Object.entries(
  configurationOverridesSchema.shape,
).flatMap(([key, optional]) => {
  const inner = optional.unwrap();
  const paths =
    "shape" in inner
      ? Object.keys(inner.shape).map((field) => `${key}.${field}`)
      : [key];
  return paths.filter(
    (path): path is OverrideField => path in overrideFieldDrawn,
  );
});

export function overrideFieldLabel(field: OverrideField): string {
  return overrideFieldDrawn[field].label;
}

export function overrideFieldKind(field: OverrideField): OverrideKind {
  return overrideFieldDrawn[field].kind;
}

/** The overrides one form holds, by field; a field absent is the
 * configuration's. */
export type CreationOverrides = Readonly<
  Partial<Record<OverrideField, unknown>>
>;

/** A field's path as the block it sits in and its name there, a top-level
 * list sitting in none. */
function overridePathOf(field: OverrideField): {
  readonly block: string | undefined;
  readonly name: string;
} {
  const [block, name] = field.split(".");
  return name === undefined
    ? { block: undefined, name: field }
    : { block, name };
}

function overrideIsRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One field of a document or an override, by path, absent where nothing
 * stands there. */
export function overrideFieldOf(
  document: unknown,
  field: OverrideField,
): unknown {
  const { block, name } = overridePathOf(field);
  const holder =
    block === undefined
      ? document
      : overrideIsRecord(document)
        ? document[block]
        : undefined;
  return overrideIsRecord(holder) ? holder[name] : undefined;
}

/** A ticket's overrides as a form holds them. */
export function overridesHeldOf(
  overrides: Overrides | undefined,
): CreationOverrides {
  return Object.fromEntries(
    overrideFields.flatMap((field) => {
      const value = overrideFieldOf(overrides, field);
      return value === undefined ? [] : [[field, value]];
    }),
  );
}

/** The form's overrides with one field overridden, or given back to the
 * configuration where the value is absent. */
export function overrideHeld(
  held: CreationOverrides,
  field: OverrideField,
  value: unknown,
): CreationOverrides {
  const rest = Object.fromEntries(
    Object.entries(held).filter(([key]) => key !== field),
  );
  return value === undefined ? rest : { ...rest, [field]: value };
}

/** A value as the lines it holds, anything else holding none. */
export function overrideLinesOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === "string")
    : [];
}

export interface OverrideFile {
  readonly path: string;
  readonly content: string;
}

/** A value as the files it names, anything else naming none. */
export function overrideFilesOf(value: unknown): readonly OverrideFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(overrideIsRecord).map((file) => ({
    path: typeof file["path"] === "string" ? file["path"] : "",
    content: typeof file["content"] === "string" ? file["content"] : "",
  }));
}

/**
 * The overrides a form sends, under the configuration's own field names, or
 * none where it holds none. Each value is sent as held, so the body and the
 * YAML write the same form alike.
 */
export function overridesNestedOf(
  held: CreationOverrides,
): Record<string, unknown> | undefined {
  const nested: Record<string, unknown> = {};
  for (const field of overrideFields) {
    const value = held[field];
    if (value === undefined) continue;
    const { block, name } = overridePathOf(field);
    if (block === undefined) {
      nested[name] = value;
      continue;
    }
    const holder = nested[block];
    nested[block] = {
      ...(overrideIsRecord(holder) ? holder : {}),
      [name]: value,
    };
  }
  return Object.keys(nested).length === 0 ? undefined : nested;
}

/** A canonical document as the value it holds, or none where it is not JSON. */
export function overrideDocumentOf(canonical: string): unknown {
  try {
    return JSON.parse(canonical) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether a document carries a mode, which is where its model is written:
 * a worker that predates modes has no mode for a model to override. */
export function overrideModelDrawn(document: unknown): boolean {
  return configurationModeOf(document) !== undefined;
}

function overrideModeSame(
  left: ConfigurationMode | undefined,
  right: ConfigurationMode | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The mode a form holds overridden, where it holds one that is a mode. */
function overrideModeHeld(
  held: CreationOverrides,
): ConfigurationMode | undefined {
  const mode = held["worker.mode"];
  return overrideIsRecord(mode) ? mode : undefined;
}

/**
 * The form's overrides with the model typed: the mode it already overrides,
 * or else the configuration's, with that model in it. Nothing typed is the
 * configuration's own model, and a mode that comes out as the configuration
 * wrote it is no override.
 */
export function overrideModelChosen(
  held: CreationOverrides,
  document: unknown,
  typed: string,
): CreationOverrides {
  const configured = configurationModeOf(document);
  if (configured === undefined) return held;
  const base = overrideModeHeld(held) ?? configured;
  const model = typed.trim();
  const chosen = configurationModeWithModel(
    base,
    model === "" ? configurationModeModel(configured) : model,
  );
  return overrideHeld(
    held,
    "worker.mode",
    overrideModeSame(chosen, configured) ? undefined : chosen,
  );
}

/** The model the configuration names, which an empty model box shows. */
export function overrideModelConfigured(document: unknown): string | undefined {
  const configured = configurationModeOf(document);
  return configured === undefined
    ? undefined
    : configurationModeModel(configured);
}

/** The model a form's overridden mode names, which its box holds. */
export function overrideModelTyped(held: CreationOverrides): string {
  const mode = overrideModeHeld(held);
  return mode === undefined ? "" : (configurationModeModel(mode) ?? "");
}

/** Whether a box's text says what the form holds, so it is kept as typed
 * rather than redrawn from the overrides. */
export function overrideModelSays(
  held: CreationOverrides,
  document: unknown,
  typed: string,
): boolean {
  return (
    JSON.stringify(overrideModelChosen(held, document, typed)) ===
    JSON.stringify(held)
  );
}

/** What a ticket's page draws: the configuration it runs, which is the
 * pinned document with its overrides applied by the contract's own function,
 * and which fields of it are the ticket's rather than the configuration's. */
export interface OverriddenView {
  readonly view: ConfigurationView;
  readonly overridden: readonly OverrideField[];
}

export function overriddenViewOf(
  canonical: string,
  overrides: Overrides | undefined,
): OverriddenView {
  const document = overrideDocumentOf(canonical);
  if (overrides === undefined || document === undefined)
    return { view: configurationViewOf(canonical), overridden: [] };
  const effective = configurationWithOverrides(document, overrides);
  return {
    view: configurationViewOf(JSON.stringify(effective)),
    overridden: overrideFields.filter(
      (field) => overrideFieldOf(overrides, field) !== undefined,
    ),
  };
}
