/**
 * Reads the committed corpus and its manifest, and says which step labels each
 * trace fires.
 *
 * The label roster is derived from `model/domain.qnt` at run time rather than
 * listed here, so a label added to the model turns up as a coverage failure
 * instead of as silence.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { decodeTrace, field, stateValue } from "../itf/decode.ts";

const GOLDEN_DIR = join(import.meta.dirname);
const MANIFEST = join(GOLDEN_DIR, "manifest.json");

/** The one label the model asserts unreachable: a guarded arm `retryableIn` refuses. */
export const UNREACHABLE_LABEL = "ticket-resume-refused";

export interface ManifestRow {
  readonly name: string;
  readonly instance: string;
  readonly seed: string;
  readonly maxSamples: number;
  readonly maxSteps: number;
  readonly invariant: string;
  readonly steps: number;
  readonly quintVersion: string;
  readonly purpose: string;
  readonly trace: unknown;
}

/**
 * Every step label the model declares, read out of `model/domain.qnt`.
 * Comment lines are excluded because the model argues in prose about the same
 * strings it emits, and a roster that included the prose would be unfalsifiable.
 */
export function declaredLabels(root: string): ReadonlySet<string> {
  const source = readFileSync(join(root, "model", "domain.qnt"), "utf8");
  const labels = new Set<string>();
  for (const line of source.split("\n")) {
    if (/^\s*\/\/\//.test(line)) continue;
    for (const match of line.matchAll(/"([a-z][a-z0-9_ -]*)"/g)) {
      if (match[1] !== undefined) labels.add(match[1]);
    }
  }
  return labels;
}

function firedIn(row: ManifestRow): ReadonlySet<string> {
  const trace = decodeTrace(row.trace);
  const lastStepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  if (lastStepVar === undefined) {
    throw new Error(`corpus: ${row.name} has no lastStep variable`);
  }
  const labels = new Set<string>();
  for (const state of trace.states) {
    const label = field(stateValue(state, lastStepVar), "label");
    if (typeof label !== "string")
      throw new Error(`corpus: ${row.name}: label is not a string`);
    labels.add(label);
  }
  return labels;
}

export interface Corpus {
  readonly rows: readonly ManifestRow[];
  readonly filesOnDisk: readonly string[];
  firedForRow(row: ManifestRow): ReadonlySet<string>;
  firedAcross(): ReadonlySet<string>;
}

function union(parts: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const labels = new Set<string>();
  for (const part of parts) for (const l of part) labels.add(l);
  return labels;
}

/** Loads every manifest row with the trace it names, and the files beside it. */
export function loadCorpus(): Corpus {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const raw = (manifest as { goldens?: unknown }).goldens;
  if (!Array.isArray(raw))
    throw new Error("corpus: the manifest has no goldens array");

  const rows: ManifestRow[] = raw.map((entry) => {
    const r = entry as Record<string, unknown>;
    const name = String(r["name"]);
    let trace: unknown;
    try {
      trace = JSON.parse(
        readFileSync(join(GOLDEN_DIR, `${name}.itf.json`), "utf8"),
      );
    } catch {
      trace = undefined;
    }
    return {
      name,
      instance: String(r["instance"]),
      seed: String(r["seed"]),
      maxSamples: Number(r["maxSamples"]),
      maxSteps: Number(r["maxSteps"]),
      invariant: typeof r["invariant"] === "string" ? r["invariant"] : "",
      steps: Number(r["steps"]),
      quintVersion: String(r["quintVersion"]),
      purpose: String(r["purpose"]),
      trace,
    };
  });

  const filesOnDisk = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".itf.json"))
    .map((f) => f.slice(0, -".itf.json".length));

  const cache = new Map<string, ReadonlySet<string>>();
  const firedForRow = (row: ManifestRow): ReadonlySet<string> => {
    const hit = cache.get(row.name);
    if (hit) return hit;
    const computed = firedIn(row);
    cache.set(row.name, computed);
    return computed;
  };

  return {
    rows,
    filesOnDisk,
    firedForRow,
    firedAcross: () => union(rows.filter((r) => r.trace).map(firedForRow)),
  };
}
