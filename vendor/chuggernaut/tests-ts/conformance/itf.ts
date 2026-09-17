import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { equal } from "../../chug/domain/task.js";
export class ItfError extends Error {}
export class Variant {
  constructor(
    readonly tag: string,
    readonly value: Value,
  ) {}
}
export type Value =
  | boolean
  | number
  | string
  | Variant
  | readonly Value[]
  | ReadonlySet<Value>
  | ReadonlyMap<Value, Value>
  | { readonly [key: string]: Value };
export const GRAPH_VAR = "graph",
  DECISION_VAR = "lastDecision",
  PRIOR_GRAPH_VAR = "priorGraph",
  ACTION_VAR = "mbt::actionTaken",
  NONDET_PICKS_VAR = "mbt::nondetPicks";
export const NO_DECISION = new Variant(
  "TicketRefused",
  new Variant("TicketNotFound", 0),
);
export const TRACES_DIR = resolve(
  import.meta.dirname,
  "../../ticket-domain/traces",
);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ItfError("expected a JSON object");
  return v as Record<string, unknown>;
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new ItfError("expected a JSON array");
  return v;
}
export function as_record(v: Value): Record<string, Value> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    v instanceof Set ||
    v instanceof Map ||
    v instanceof Variant
  )
    throw new ItfError("expected a record");
  return v as Record<string, Value>;
}
export function decode(raw: unknown): Value {
  if (
    typeof raw === "boolean" ||
    typeof raw === "string" ||
    (typeof raw === "number" && Number.isSafeInteger(raw))
  )
    return raw;
  if (Array.isArray(raw)) return raw.map(decode);
  const r = object(raw),
    keys = Object.keys(r),
    sole = (k: string) => {
      if (keys.length !== 1)
        throw new ItfError(`${k} object also carries ${keys}`);
      return r[k];
    };
  if ("#bigint" in r) {
    const n = sole("#bigint");
    if (typeof n !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(n))
      throw new ItfError("#bigint payload is not a decimal string");
    const value = Number(n);
    if (!Number.isSafeInteger(value))
      throw new ItfError("integer exceeds exact JavaScript numeric range");
    return value;
  }
  if ("#map" in r) {
    const entries: [Value, Value][] = [];
    for (const p of array(sole("#map"))) {
      const pair = array(p);
      if (pair.length !== 2)
        throw new ItfError("#map entry is not a [key, value] pair");
      const key = decode(pair[0]);
      if (entries.some(([k]) => equal(k, key)))
        throw new ItfError("#map has the duplicate key");
      entries.push([key, decode(pair[1])]);
    }
    return new Map(entries);
  }
  if ("#set" in r) return new Set(array(sole("#set")).map(decode));
  if ("#tup" in r) return array(sole("#tup")).map(decode);
  if ("tag" in r) {
    if (keys.length !== 2 || !("value" in r) || typeof r.tag !== "string")
      throw new ItfError("variant must carry a string tag and value");
    return new Variant(r.tag, decode(r.value));
  }
  if (keys.some((k) => k.startsWith("#")))
    throw new ItfError("unknown ITF marker");
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, decode(v)]));
}
export interface Trace {
  readonly name: string;
  readonly kind: "scenario" | "simulation";
  readonly vars: readonly string[];
  readonly states: readonly Record<string, Value>[];
  readonly meta: Record<string, unknown>;
  readonly path: string;
}
export function load_trace(path: string): Trace {
  const doc = object(JSON.parse(readFileSync(path, "utf8"))),
    meta = object(doc["#meta"]),
    kind = meta.kind;
  if (kind !== "scenario" && kind !== "simulation")
    throw new ItfError("invalid #meta.kind");
  const name = meta[kind === "scenario" ? "scenario" : "seed"];
  if (typeof name !== "string") throw new ItfError("missing trace name");
  const vars = [
    ...new Set(
      array(doc.vars).map((v) => {
        if (typeof v !== "string") throw new ItfError("vars holds non-string");
        return v;
      }),
    ),
  ];
  if (vars.includes(ACTION_VAR) !== (kind === "simulation"))
    throw new ItfError("#meta.kind disagrees with vars");
  const states = array(doc.states).map((raw, i) => {
    const r = object(raw),
      m = object(r["#meta"]);
    if (m.index !== i) throw new ItfError("#meta.index mismatch");
    const entries = Object.entries(r).filter(([k]) => k !== "#meta");
    if (
      entries
        .map(([k]) => k)
        .sort()
        .join(",") !== [...vars].sort().join(",")
    )
      throw new ItfError("state variables mismatch");
    return Object.fromEntries(entries.map(([k, v]) => [k, decode(v)]));
  });
  return { name, kind, vars, states, meta, path };
}
export function load_traces(dir = TRACES_DIR): readonly Trace[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".itf.json"))
    .sort()
    .map((f) => load_trace(resolve(dir, f)));
}
export interface DecisionStep {
  readonly index: number;
  readonly decision: Variant;
  readonly action: string | null;
  readonly nondet_picks: Record<string, Value> | null;
}
export function* steps(t: Trace): Generator<DecisionStep> {
  if (!t.vars.includes(DECISION_VAR)) return;
  for (let index = 1; index < t.states.length; index++) {
    const s = t.states[index]!,
      decision = s[DECISION_VAR];
    if (!(decision instanceof Variant))
      throw new ItfError(`${basename(t.path)}: lastDecision is not a variant`);
    const action = t.kind === "simulation" ? s[ACTION_VAR] : null;
    if (action !== null && typeof action !== "string")
      throw new ItfError("action is not a string");
    yield {
      index,
      decision,
      action,
      nondet_picks:
        t.kind === "simulation" ? as_record(s[NONDET_PICKS_VAR]!) : null,
    };
  }
}
export function* decisions(t: Trace): Generator<DecisionStep> {
  let previous: Variant | undefined;
  for (const step of steps(t)) {
    if (!equal(previous, step.decision)) yield step;
    previous = step.decision;
  }
}
