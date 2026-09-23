/**
 * Reads the committed corpus and its manifest, and says which decisions each
 * trace carries: the events it accepted and the refusals it answered.
 *
 * The rosters are the generated `ticketEventTags` and `ticketRefusalTags`,
 * read off `model/api.qnt`, rather than listed here, so an event or a refusal
 * added to the model turns up as a coverage failure instead of as silence.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { LastDecision } from "../../src/domain/generated/modelTypes.ts";
import { decodeTrace, stateValue } from "../itf/decode.ts";
import { decodeLastDecision } from "../itf/vocabulary.ts";

const GOLDEN_DIR = join(import.meta.dirname);
const MANIFEST = join(GOLDEN_DIR, "manifest.json");

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

/** A decision a state records: an accepted command's or a refusal. */
export type Decision = Exclude<LastDecision, "NoDecision">;

/** The event an accepted decision took, or the refusal's own name. */
export function decisionTag(decision: Decision): string {
  return decision.type === "Decided"
    ? decision.value.event.type
    : decision.value.type;
}

/** Every decision a trace records, in order; the initial state records none. */
function decisionsIn(row: ManifestRow): readonly Decision[] {
  const trace = decodeTrace(row.trace);
  const lastStepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  if (lastStepVar === undefined) {
    throw new Error(`corpus: ${row.name} has no lastStep variable`);
  }
  return trace.states.flatMap((state) => {
    const last = decodeLastDecision(stateValue(state, lastStepVar));
    return last === "NoDecision" ? [] : [last];
  });
}

export interface Corpus {
  readonly rows: readonly ManifestRow[];
  readonly filesOnDisk: readonly string[];
  decisionsForRow(row: ManifestRow): readonly Decision[];
  decisionsAcross(): readonly Decision[];
  firedForRow(row: ManifestRow): ReadonlySet<string>;
  firedAcross(): ReadonlySet<string>;
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

  const cache = new Map<string, readonly Decision[]>();
  const decisionsForRow = (row: ManifestRow): readonly Decision[] => {
    const hit = cache.get(row.name);
    if (hit) return hit;
    const computed = decisionsIn(row);
    cache.set(row.name, computed);
    return computed;
  };
  const decisionsAcross = (): readonly Decision[] =>
    rows.filter((r) => r.trace).flatMap(decisionsForRow);
  const tags = (decisions: readonly Decision[]): ReadonlySet<string> =>
    new Set(decisions.map(decisionTag));

  return {
    rows,
    filesOnDisk,
    decisionsForRow,
    decisionsAcross,
    firedForRow: (row) => tags(decisionsForRow(row)),
    firedAcross: () => tags(decisionsAcross()),
  };
}
