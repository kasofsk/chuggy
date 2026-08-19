/**
 * Reads the committed corpus and its manifest, and says which step labels and
 * which `stepDescends` exemption arms each trace fires.
 *
 * Both rosters are derived from `model/domain.qnt` at run time rather than
 * listed here, so a label or an arm added to the model turns up as a coverage
 * failure instead of as silence. What is not derivable that way — which
 * instance can reach which label — is the caller's, and is stated there.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  decodeTrace,
  field,
  stateValue,
  type ItfValue,
} from "../itf/decode.ts";

const GOLDEN_DIR = join(import.meta.dirname);
const MANIFEST = join(GOLDEN_DIR, "manifest.json");

/** The one label the model asserts unreachable: a guarded arm `retryableIn` refuses. */
export const UNREACHABLE_LABEL = "ticket-resume-refused";

/** The phases `phaseRank` names; everything else ranks as settled. */
const LIVE_PHASES = new Set(["Pending", "Working", "Evaluating", "Finalizing"]);

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

export interface Fired {
  readonly labels: ReadonlySet<string>;
  readonly arms: ReadonlySet<string>;
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

/**
 * The exemption arms `stepDescends` names in its own header roster, in order.
 * The model requires a run per arm and keeps the list beside the rule, so this
 * reads that list rather than restating it.
 */
export function declaredArms(root: string): readonly string[] {
  const source = readFileSync(join(root, "model", "domain.qnt"), "utf8");
  const start = source.indexOf("Current roster:");
  const end = source.indexOf("val stepDescends", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "corpus: stepDescends' arm roster is not where this reader expects it",
    );
  }
  const arms: string[] = [];
  for (const line of source.slice(start, end).split("\n")) {
    const match = /^ {2}\/\/\/ {3}([a-z].*)$/.exec(line);
    if (!match?.[1]) continue;
    arms.push(match[1].replace(/\s*—.*$/, "").trim());
  }
  return arms;
}

/** A resume into the pipeline, which is the flavor the model's roster names. */
function isPipelineResume(tos: readonly string[]): boolean {
  return tos.some((t) => t === "Evaluating" || t === "Finalizing");
}

function tagOf(value: ItfValue): string {
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "variant"
  ) {
    return value.tag;
  }
  throw new Error("corpus: expected a variant where a phase belongs");
}

/**
 * Which arms this one step matches, named as the model's roster names them.
 * It mirrors `stepDescends`' exemption disjunction for classification only —
 * the invariant itself is `src/domain/`'s and is not duplicated here.
 */
function armsFor(
  label: string,
  transitions: ItfValue,
  retryFree: boolean,
): string[] {
  const hit: string[] = [];
  if (label === "init") hit.push("init");
  if (label === "settled") hit.push("settled");
  if (label === "ticket-released") hit.push("ticket-released");

  if (!Array.isArray(transitions)) return hit;

  if (label === "ticket-resumed") {
    const tos = transitions.map((t) => tagOf(field(t, "to")));
    if (retryFree && isPipelineResume(tos)) {
      hit.push("ticket-resumed, RetryFree pipeline flavor");
    }
  }
  if (label === "ticket-revoked" && transitions.length > 0) {
    const allSettled = transitions.every(
      (t) => !LIVE_PHASES.has(tagOf(field(t, "from"))),
    );
    if (allSettled) hit.push("ticket-revoked, desk-only flat");
  }
  return hit;
}

function firedIn(row: ManifestRow): Fired {
  const trace = decodeTrace(row.trace);
  const lastStepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  if (lastStepVar === undefined) {
    throw new Error(`corpus: ${row.name} has no lastStep variable`);
  }
  const retryFree = row.instance.endsWith("retryfree");
  const labels = new Set<string>();
  const arms = new Set<string>();
  for (const state of trace.states) {
    const record = stateValue(state, lastStepVar);
    const label = field(record, "label");
    if (typeof label !== "string")
      throw new Error(`corpus: ${row.name}: label is not a string`);
    labels.add(label);
    for (const arm of armsFor(label, field(record, "transitions"), retryFree))
      arms.add(arm);
  }
  return { labels, arms };
}

export interface Corpus {
  readonly rows: readonly ManifestRow[];
  readonly filesOnDisk: readonly string[];
  firedForRow(row: ManifestRow): Fired;
  firedFor(instance: string): Fired;
  firedAcross(): Fired;
}

function union(parts: readonly Fired[]): Fired {
  const labels = new Set<string>();
  const arms = new Set<string>();
  for (const part of parts) {
    for (const l of part.labels) labels.add(l);
    for (const a of part.arms) arms.add(a);
  }
  return { labels, arms };
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

  const cache = new Map<string, Fired>();
  const firedForRow = (row: ManifestRow): Fired => {
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
    firedFor: (instance) =>
      union(
        rows.filter((r) => r.instance === instance && r.trace).map(firedForRow),
      ),
    firedAcross: () => union(rows.filter((r) => r.trace).map(firedForRow)),
  };
}
