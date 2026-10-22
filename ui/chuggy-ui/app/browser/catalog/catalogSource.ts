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

type SourceRecord = Readonly<Record<string, unknown>>;

function sourceRecordOf(value: unknown): SourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as SourceRecord)
    : {};
}

function sourceHeld(document: SourceRecord, field: string, name: string) {
  const entries = sourceRecordOf(document[field]);
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/** A workload as written beside the prompt file it names, the file's text left to the prompt's entry. */
function sourceWorkload(value: unknown): unknown {
  const workload = sourceRecordOf(value);
  const prompt = sourceRecordOf(workload["prompt"]);
  if (typeof prompt["path"] !== "string") return value;
  return { ...workload, prompt: { path: prompt["path"] } };
}

/** The value with every empty list and map left out, at any depth. */
function sourcePruned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sourcePruned);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, held]) => {
      const pruned = sourcePruned(held);
      const empty =
        typeof pruned === "object" &&
        pruned !== null &&
        Object.keys(pruned).length === 0;
      return empty ? [] : [[key, pruned]];
    }),
  );
}

function sourceYaml(value: unknown): string {
  return new Document(sourcePruned(value)).toString({
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
  const document = sourceRecordOf(JSON.parse(canonical));
  switch (detail.kind) {
    case "Workload": {
      const held = sourceHeld(document, "workloads", entry.name);
      return held === undefined ? undefined : sourceYaml(sourceWorkload(held));
    }
    case "Plan": {
      const held = sourceHeld(document, "plans", entry.name);
      return held === undefined ? undefined : sourceYaml(held);
    }
    case "Finalizer": {
      const held = sourceHeld(document, "finalizers", entry.name);
      return held === undefined ? undefined : sourceYaml(held);
    }
  }
}
