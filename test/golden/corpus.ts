/**
 * Reads the committed corpus and its manifest, and says which decisions each
 * trace carries.
 *
 * The event roster is the generated `ticketEventTags`, read off
 * `model/api.qnt`, rather than listed here, so an event added to the model
 * turns up as a coverage failure instead of as silence.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { SuccessfulTicketDecision } from "../../src/domain/generated/modelTypes.ts";
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

/** Every decision a trace records, in order; the initial state records none. */
function decisionsIn(row: ManifestRow): readonly SuccessfulTicketDecision[] {
  const trace = decodeTrace(row.trace);
  const lastStepVar = trace.vars.find((v) => v.endsWith("::lastStep"));
  if (lastStepVar === undefined) {
    throw new Error(`corpus: ${row.name} has no lastStep variable`);
  }
  return trace.states.flatMap((state) => {
    const last = decodeLastDecision(stateValue(state, lastStepVar));
    return last === "NoDecision" ? [] : [last.value];
  });
}

export interface Corpus {
  readonly rows: readonly ManifestRow[];
  readonly filesOnDisk: readonly string[];
  decisionsForRow(row: ManifestRow): readonly SuccessfulTicketDecision[];
  decisionsAcross(): readonly SuccessfulTicketDecision[];
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

  const cache = new Map<string, readonly SuccessfulTicketDecision[]>();
  const decisionsForRow = (
    row: ManifestRow,
  ): readonly SuccessfulTicketDecision[] => {
    const hit = cache.get(row.name);
    if (hit) return hit;
    const computed = decisionsIn(row);
    cache.set(row.name, computed);
    return computed;
  };
  const decisionsAcross = (): readonly SuccessfulTicketDecision[] =>
    rows.filter((r) => r.trace).flatMap(decisionsForRow);
  const tags = (
    decisions: readonly SuccessfulTicketDecision[],
  ): ReadonlySet<string> => new Set(decisions.map((d) => d.event.type));

  return {
    rows,
    filesOnDisk,
    decisionsForRow,
    decisionsAcross,
    firedForRow: (row) => tags(decisionsForRow(row)),
    firedAcross: () => tags(decisionsAcross()),
  };
}
