#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
export const HERE = dirname(fileURLToPath(import.meta.url)),
  MODEL = join(HERE, "ticket_tests.qnt"),
  TRACES = join(HERE, "traces"),
  INDEX = join(TRACES, "index.json");
export const INVARIANT = "modelInvariant",
  SCENARIO_SEED = "0x5ce9a10",
  SIMULATION_SEEDS = ["0x01", "0x02", "0x07", "0x28"] as const,
  SIMULATION_STEPS = 25,
  COVERAGE_TYPES = ["TicketEvent", "TicketRefusal", "TicketState"] as const;
export const GENERATOR = "ticket-domain/export_traces.ts";
export class ExportError extends Error {}
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Document = { [key: string]: Json };
export interface Trace {
  "#meta": Document;
  vars: string[];
  states: Document[];
}
export interface Step {
  index: number;
  action: Json;
  decision: { outcome: "refused" | "decided"; tag: string | null } | null;
  tickets: Record<string, string | null>;
}
export interface Summary {
  states: number;
  steps: Step[];
}
export interface Entry extends Summary {
  file: string;
  kind: "scenario" | "simulation";
  scenario?: string;
  seed?: string;
  maxSteps?: number;
  invariant?: string;
}
export interface Coverage {
  exercised: string[];
  unexercised: string[];
}
export interface TraceIndex {
  generator: string;
  model: string;
  scenarioSeed: string;
  simulationSeeds: readonly string[];
  simulationSteps: number;
  invariant: string;
  coverage: Record<string, Coverage>;
  traces: Entry[];
}
export interface Exported extends TraceIndex {
  removed: string[];
}
function record(value: unknown, where = "value"): Document {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ExportError(`${where} is not a record`);
  return value as Document;
}
function array(value: unknown, where = "value"): Json[] {
  if (!Array.isArray(value)) throw new ExportError(`${where} is not a list`);
  return value as Json[];
}
function string(value: unknown, where = "value"): string {
  if (typeof value !== "string")
    throw new ExportError(`${where} is not a string`);
  return value;
}
export function find_quint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    const file = join(directory || ".", "quint");
    try {
      if (statSync(file).isFile()) {
        accessSync(file, constants.X_OK);
        return file;
      }
    } catch {}
  }
  throw new ExportError("quint not found on PATH");
}
export function run_quint(quint: string, args: readonly string[]): void {
  const result = spawnSync(quint, args, {
    cwd: HERE,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error)
    throw new ExportError(`quint ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0)
    throw new ExportError(
      `quint ${args[0]} failed with exit ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
}
export function scenario_names(model = MODEL): string[] {
  const names = [
    ...readFileSync(model, "utf8").matchAll(
      /^\s*run\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
    ),
  ].map((m) => m[1]!);
  if (!names.length)
    throw new ExportError(`no \`run\` definitions found in ${model}`);
  return names;
}
export function variant_names(source: string, type_name: string): string[] {
  const match = new RegExp(
    `^\\s*type\\s+${type_name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\n)`,
    "m",
  ).exec(readFileSync(source, "utf8"));
  if (!match) throw new ExportError(`type ${type_name} not found in ${source}`);
  return [...match[1]!.matchAll(/([A-Z][A-Za-z0-9_]*)\s*(?:\(|\||$)/g)].map(
    (m) => m[1]!,
  );
}
export function normalize(raw: unknown, meta: Document): Trace {
  const doc = record(raw),
    prior = record(doc["#meta"], "#meta"),
    status = prior.status;
  if (status !== "ok")
    throw new ExportError(
      `trace status is ${JSON.stringify(status)}, expected 'ok'`,
    );
  return {
    "#meta": {
      format: prior.format!,
      "format-description": prior["format-description"]!,
      source: prior.source!,
      status,
      generator: GENERATOR,
      ...meta,
    },
    vars: [
      ...new Set(array(doc.vars ?? []).map((v) => string(v, "vars entry"))),
    ],
    states: array(doc.states, "states").map((s, i) =>
      record(s, `states[${i}]`),
    ),
  };
}
export function write_trace(path: string, trace: Trace): void {
  writeFileSync(path, JSON.stringify(trace) + "\n");
}
export function tag_of(value: unknown): string | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).tag === "string"
    ? (value as { tag: string }).tag
    : null;
}
export function summarize(trace: Trace): Summary {
  const steps: Step[] = trace.states.map((state) => {
    const tickets: Record<string, string | null> = {};
    if (
      state.graph !== null &&
      typeof state.graph === "object" &&
      !Array.isArray(state.graph)
    ) {
      const graph = record(state.graph);
      for (const raw of array(record(graph.tickets)["#map"])) {
        const [key, ticket] = array(raw);
        tickets[string(record(key)["#bigint"])] = tag_of(record(ticket).state);
      }
    }
    let decision: Step["decision"] = null;
    const last = state.lastDecision;
    if (last !== null && typeof last === "object" && !Array.isArray(last)) {
      const held = record(last),
        outcome = held.tag === "TicketRefused" ? "refused" : "decided",
        inner = record(held.value);
      decision = {
        outcome,
        tag: tag_of(outcome === "decided" ? inner.event : inner),
      };
    }
    const index = record(state["#meta"]).index;
    if (typeof index !== "number")
      throw new ExportError("state index is not a number");
    return {
      index,
      action: state["mbt::actionTaken"] ?? null,
      decision,
      tickets,
    };
  });
  return { states: steps.length, steps };
}
export function covered(summaries: readonly Summary[]): ReadonlySet<string> {
  const seen = new Set<string>();
  for (const summary of summaries)
    for (const step of summary.steps) {
      for (const tag of Object.values(step.tickets)) if (tag) seen.add(tag);
      if (step.index > 0 && step.decision?.tag) seen.add(step.decision.tag);
    }
  return seen;
}
export function export_traces(
  quint: string,
  options: {
    traces?: string;
    run?: (quint: string, args: readonly string[]) => void;
  } = {},
): Exported {
  const traces = options.traces ?? TRACES,
    run = options.run ?? run_quint,
    index_path = join(traces, "index.json");
  mkdirSync(traces, { recursive: true });
  const names = scenario_names(),
    entries: Entry[] = [],
    out = mkdtempSync(join(tmpdir(), "chug-traces-"));
  try {
    run(quint, [
      "test",
      "--seed",
      SCENARIO_SEED,
      "--out-itf",
      join(out, "test_{test}_{seq}.itf.json"),
      basename(MODEL),
    ]);
    for (const name of names) {
      const pattern = new RegExp(`^test_${name}_\\d+\\.itf\\.json$`),
        produced = readdirSync(out)
          .filter((p) => pattern.test(p))
          .sort();
      if (!produced.length)
        throw new ExportError(`scenario ${name} produced no trace`);
      const trace = normalize(
          JSON.parse(readFileSync(join(out, produced[0]!), "utf8")),
          { kind: "scenario", scenario: name },
        ),
        file = `scenario-${name}.itf.json`;
      write_trace(join(traces, file), trace);
      entries.push({
        file,
        kind: "scenario",
        scenario: name,
        ...summarize(trace),
      });
    }
    for (const seed of SIMULATION_SEEDS) {
      for (const stale of readdirSync(out).filter((f) =>
        /^sim_.*\.itf\.json$/.test(f),
      ))
        unlinkSync(join(out, stale));
      run(quint, [
        "run",
        "--seed",
        seed,
        "--max-steps",
        String(SIMULATION_STEPS),
        "--max-samples",
        "1",
        "--n-threads",
        "1",
        "--mbt",
        `--invariant=${INVARIANT}`,
        "--out-itf",
        join(out, "sim_{seq}.itf.json"),
        basename(MODEL),
      ]);
      const produced = readdirSync(out)
        .filter((f) => /^sim_.*\.itf\.json$/.test(f))
        .sort();
      if (!produced.length)
        throw new ExportError(`simulation seed ${seed} produced no trace`);
      const trace = normalize(
          JSON.parse(readFileSync(join(out, produced[0]!), "utf8")),
          {
            kind: "simulation",
            seed,
            maxSteps: SIMULATION_STEPS,
            invariant: INVARIANT,
          },
        ),
        file = `simulation-seed-${seed}.itf.json`;
      write_trace(join(traces, file), trace);
      entries.push({
        file,
        kind: "simulation",
        seed,
        maxSteps: SIMULATION_STEPS,
        invariant: INVARIANT,
        ...summarize(trace),
      });
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  const seen = covered(entries),
    coverage: Record<string, Coverage> = {};
  for (const type_name of COVERAGE_TYPES) {
    const declared = variant_names(join(HERE, "ticket.qnt"), type_name);
    coverage[type_name] = {
      exercised: declared.filter((v) => seen.has(v)),
      unexercised: declared.filter((v) => !seen.has(v)),
    };
  }
  const index: TraceIndex = {
    generator: GENERATOR,
    model: basename(MODEL),
    scenarioSeed: SCENARIO_SEED,
    simulationSeeds: SIMULATION_SEEDS,
    simulationSteps: SIMULATION_STEPS,
    invariant: INVARIANT,
    coverage,
    traces: entries,
  };
  writeFileSync(index_path, JSON.stringify(index, null, 2) + "\n");
  const keep = new Set([
      ...entries.map((e) => e.file),
      "index.json",
      "README.md",
    ]),
    removed: string[] = [];
  for (const name of readdirSync(traces).sort()) {
    const path = join(traces, name);
    if (!keep.has(name) && statSync(path).isFile()) {
      unlinkSync(path);
      removed.push(name);
    }
  }
  return { ...index, removed };
}
export { export_traces as export };
export function main(): number {
  let index: Exported;
  try {
    index = export_traces(find_quint());
  } catch (error) {
    if (!(error instanceof ExportError)) throw error;
    console.error(`export-traces: ${error.message}`);
    return 1;
  }
  for (const name of index.removed) console.log(`removed stale ${name}`);
  console.log(
    `wrote ${index.traces.filter((e) => e.kind === "scenario").length} scenario and ${index.traces.filter((e) => e.kind === "simulation").length} simulation traces to ${TRACES}`,
  );
  for (const e of index.traces) console.log(`  ${e.file}  ${e.states} states`);
  console.log("\ncoverage");
  let incomplete = false;
  for (const [name, result] of Object.entries(index.coverage)) {
    console.log(
      `  ${name}: ${result.exercised.length}/${result.exercised.length + result.unexercised.length}`,
    );
    if (result.unexercised.length) {
      incomplete = true;
      console.log(`    never exercised: ${result.unexercised.join(", ")}`);
    }
  }
  if (!incomplete) console.log("  every declared variant is exercised");
  return 0;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
