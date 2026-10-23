/**
 * What one ticket replaces of the catalog workloads it runs, read off the
 * workloads as an author writes them out whole.
 *
 * A WORKLOAD IS SHOWN WHOLE AND HELD AS WHAT DIFFERS. The author edits each
 * selected workload as the catalog holds it with the ticket's overrides
 * applied, and the override held is every field whose value differs from the
 * catalog's, so a workload written back unchanged overrides nothing.
 *
 * AN EMPTY LIST OR MAP IS NOT WRITTEN. Block YAML has no spelling for one, so
 * it is left out where it is shown and a field left out is read as the empty
 * value the catalog held there.
 *
 * A FIELD IS REPLACED, NEVER REMOVED, since an override names what replaces a
 * field. The one exception is where the workload runs: an image and an
 * execution requirement are one placement, and leaving both out runs it in
 * the catalog's own image.
 */

import {
  configurationWithOverrides,
  type WorkloadOverride,
} from "../../../../src/contract/configurationOverrides.ts";
import { workloadOverrideSchema } from "../../../../src/contract/configurationDocument.ts";

import { overridesSame } from "./ticketOverrides.ts";
import { configurationCatalogOf } from "./configurationCatalog.ts";

type WorkloadRecord = Readonly<Record<string, unknown>>;

function workloadIsRecord(value: unknown): value is WorkloadRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a list or map with nothing in it. */
function workloadEmpty(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length === 0
    : workloadIsRecord(value) && Object.keys(value).length === 0;
}

/** One value with every empty list and map below it left out. */
export function workloadShownOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(workloadShownOf);
  if (!workloadIsRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => !workloadEmpty(field))
      .map(([key, field]) => [key, workloadShownOf(field)]),
  );
}

/** A written value with each empty list or map the catalog held, and the author was not shown, put back. */
function workloadRestored(written: unknown, held: unknown): unknown {
  if (!workloadIsRecord(written) || !workloadIsRecord(held)) return written;
  return {
    ...Object.fromEntries(
      Object.entries(held).filter(
        ([key, value]) => workloadEmpty(value) && !Object.hasOwn(written, key),
      ),
    ),
    ...Object.fromEntries(
      Object.entries(written).map(([key, value]) => [
        key,
        workloadRestored(value, held[key]),
      ]),
    ),
  };
}

/** The catalog a configuration's bytes are, as the raw document its workloads are read from. */
interface WorkloadCatalogDocument {
  readonly image: unknown;
  readonly workloads: WorkloadRecord;
}

function workloadCatalogDocumentOf(
  canonical: string,
): WorkloadCatalogDocument | undefined {
  if (configurationCatalogOf(canonical) === undefined) return undefined;
  const parsed = JSON.parse(canonical) as WorkloadRecord;
  const workloads = parsed["workloads"];
  return workloadIsRecord(workloads)
    ? { image: parsed["image"], workloads }
    : undefined;
}

/** One workload as an author is shown it: a prompt read from a file shown by its path, which names the text. */
export function workloadWrittenOf(workload: unknown): unknown {
  const shown = workloadShownOf(workload);
  if (!workloadIsRecord(shown)) return shown;
  const prompt = shown["prompt"];
  return workloadIsRecord(prompt) && typeof prompt["path"] === "string"
    ? { ...shown, prompt: { path: prompt["path"] } }
    : shown;
}

/** Each workload a ticket overrides, written as the ticket runs it: the catalog's with the overrides applied. */
export function workloadsOverriddenOf(
  canonical: string,
  overrides: Readonly<Record<string, WorkloadOverride>>,
): Readonly<Record<string, unknown>> {
  const document = workloadCatalogDocumentOf(canonical);
  if (document === undefined) return {};
  const effective = configurationWithOverrides(
    { workloads: document.workloads },
    { workloads: overrides },
  ) as { readonly workloads: WorkloadRecord };
  return Object.fromEntries(
    Object.keys(overrides).flatMap((name) =>
      Object.hasOwn(effective.workloads, name)
        ? [[name, workloadWrittenOf(effective.workloads[name])]]
        : [],
    ),
  );
}

/** A catalog's canonical JSON with a ticket's workload overrides applied: the catalog as that ticket runs it. */
export function workloadsEffectiveCanonicalOf(
  canonical: string,
  overrides: Readonly<Record<string, WorkloadOverride>> | undefined,
): string {
  const document = workloadCatalogDocumentOf(canonical);
  if (document === undefined || overrides === undefined) return canonical;
  return JSON.stringify(
    configurationWithOverrides(JSON.parse(canonical), {
      workloads: overrides,
    }),
  );
}

/** What one written workload overrides, or why it cannot be read as an override, with the path the fault is at. */
export type WorkloadOverrideRead =
  | { readonly read: "Override"; readonly override: WorkloadOverride }
  | {
      readonly read: "Refused";
      readonly message: string;
      readonly path: readonly PropertyKey[];
    };

const workloadPlacementFields: readonly string[] = [
  "image",
  "executionRequirement",
];

/** The prompt a written one overrides with, none where it names what the catalog holds: new text, or another stored file's path. */
function workloadPromptOverride(written: unknown, held: unknown): unknown {
  if (!workloadIsRecord(written)) return written;
  const before = workloadIsRecord(held) ? held : {};
  if (written["text"] !== undefined)
    return written["text"] === before["text"]
      ? undefined
      : { text: written["text"] };
  if (written["path"] === before["path"]) return undefined;
  return written["path"] === undefined ? written : { path: written["path"] };
}

/** The placement fields a written workload overrides, the catalog's image where it leaves both out. */
function workloadPlacementOverride(
  written: WorkloadRecord,
  held: WorkloadRecord,
  catalogImage: unknown,
): WorkloadRecord {
  const changed = workloadPlacementFields.some(
    (field) => !overridesSame(written[field], held[field]),
  );
  if (!changed) return {};
  const named = Object.fromEntries(
    workloadPlacementFields.flatMap((field) =>
      written[field] === undefined ? [] : [[field, written[field]]],
    ),
  );
  return Object.keys(named).length === 0 ? { image: catalogImage } : named;
}

/** Whether a written workload names another runner than the catalog's, which keeps none of the catalog's fields. */
function workloadSwitchesRunner(written: unknown, held: WorkloadRecord) {
  return (
    workloadIsRecord(written) &&
    written["runner"] !== undefined &&
    written["runner"] !== held["runner"]
  );
}

/**
 * One workload as written, read against the catalog's: every field that
 * differs, a field the catalog held and the text left out refused, and the
 * override held to the contract's schema.
 */
export function workloadOverrideRead(
  canonical: string,
  name: string,
  written: unknown,
): WorkloadOverrideRead {
  const document = workloadCatalogDocumentOf(canonical);
  const catalogHeld = document?.workloads[name];
  if (document === undefined || !workloadIsRecord(catalogHeld))
    return {
      read: "Refused",
      message: `the catalog holds no workload \`${name}\``,
      path: [],
    };
  if (!workloadIsRecord(written))
    return {
      read: "Refused",
      message: "write the workload as a map of its fields",
      path: [],
    };
  const held = workloadSwitchesRunner(written, catalogHeld) ? {} : catalogHeld;
  const restored = workloadRestored(written, held) as WorkloadRecord;
  if (workloadPlacementFields.every((field) => restored[field] !== undefined))
    return {
      read: "Refused",
      message:
        "a workload runs in an image or under an execution requirement; name one",
      path: ["executionRequirement"],
    };
  const removed = Object.keys(held).find(
    (field) =>
      !Object.hasOwn(restored, field) &&
      !workloadPlacementFields.includes(field),
  );
  if (removed !== undefined)
    return {
      read: "Refused",
      message: `a ticket replaces \`${removed}\` and cannot remove it; write it back`,
      path: [],
    };
  const changed = Object.fromEntries(
    Object.entries(restored).flatMap(([field, value]) => {
      if (workloadPlacementFields.includes(field)) return [];
      const replaced =
        field === "prompt" ? workloadPromptOverride(value, held[field]) : value;
      return replaced === undefined || overridesSame(replaced, held[field])
        ? []
        : [[field, replaced]];
    }),
  );
  const parsed = workloadOverrideSchema.safeParse({
    ...changed,
    ...workloadPlacementOverride(restored, held, document.image),
  });
  if (parsed.success) return { read: "Override", override: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    read: "Refused",
    message: issue?.message ?? "this workload is not one a ticket may run",
    path: issue?.path ?? [],
  };
}
