/**
 * What a catalog entry is written as: its value in the configuration's
 * canonical JSON, as block YAML, or the text a prompt file was read as.
 *
 * A workload naming a prompt file is written with the path alone, since the
 * text is the prompt's own entry, and an empty list or map is left out, as
 * block YAML has no way to write one but inline. This lives under `browser/`
 * because the writer is a package the decision layer may not reach;
 * everything here is still pure.
 */

import { Document } from "yaml";

import type { CatalogEntry } from "../../core/catalogEntries.ts";

type CatalogEntrySourceRecord = Readonly<Record<string, unknown>>;

function catalogEntrySourceRecordOf(value: unknown): CatalogEntrySourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as CatalogEntrySourceRecord)
    : {};
}

function catalogEntrySourceHeld(
  document: CatalogEntrySourceRecord,
  field: string,
  name: string,
) {
  const entries = catalogEntrySourceRecordOf(document[field]);
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/** A workload as written beside the prompt file it names, the file's text left to the prompt's entry. */
function catalogEntrySourceWorkload(value: unknown): unknown {
  const workload = catalogEntrySourceRecordOf(value);
  const prompt = catalogEntrySourceRecordOf(workload["prompt"]);
  if (typeof prompt["path"] !== "string") return value;
  return { ...workload, prompt: { path: prompt["path"] } };
}

/** The value with every empty list and map left out, at any depth. */
function catalogEntrySourcePruned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(catalogEntrySourcePruned);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, held]) => {
      const pruned = catalogEntrySourcePruned(held);
      const empty =
        typeof pruned === "object" &&
        pruned !== null &&
        Object.keys(pruned).length === 0;
      return empty ? [] : [[key, pruned]];
    }),
  );
}

function catalogEntrySourceYaml(value: unknown): string {
  return new Document(catalogEntrySourcePruned(value)).toString({
    lineWidth: 0,
    nullStr: "",
  });
}

/** The entry as written, none where these bytes do not hold it. */
export function catalogEntrySource(
  canonical: string,
  entry: CatalogEntry,
): string | undefined {
  const { detail } = entry;
  if (detail.kind === "Prompt") return detail.text;
  const document = catalogEntrySourceRecordOf(JSON.parse(canonical));
  switch (detail.kind) {
    case "Workload": {
      const held = catalogEntrySourceHeld(document, "workloads", entry.name);
      return held === undefined
        ? undefined
        : catalogEntrySourceYaml(catalogEntrySourceWorkload(held));
    }
    case "Plan": {
      const held = catalogEntrySourceHeld(document, "plans", entry.name);
      return held === undefined ? undefined : catalogEntrySourceYaml(held);
    }
    case "Finalizer": {
      const held = catalogEntrySourceHeld(document, "finalizers", entry.name);
      return held === undefined ? undefined : catalogEntrySourceYaml(held);
    }
  }
}
