export declare class ItfError extends Error {}
export declare class Variant {
  readonly tag: string;
  readonly value: Value;
  constructor(tag: string, value: Value);
}
export type Value =
  | boolean
  | number
  | string
  | Variant
  | readonly Value[]
  | ReadonlySet<Value>
  | ReadonlyMap<Value, Value>
  | {
      readonly [key: string]: Value;
    };
export declare const GRAPH_VAR = "graph",
  DECISION_VAR = "lastDecision",
  PRIOR_GRAPH_VAR = "priorGraph",
  ACTION_VAR = "mbt::actionTaken",
  NONDET_PICKS_VAR = "mbt::nondetPicks";
export declare const NO_DECISION: Variant;
export declare const TRACES_DIR: string;
export declare function as_record(v: Value): Record<string, Value>;
export declare function decode(raw: unknown): Value;
export interface Trace {
  readonly name: string;
  readonly kind: "scenario" | "simulation";
  readonly vars: readonly string[];
  readonly states: readonly Record<string, Value>[];
  readonly meta: Record<string, unknown>;
  readonly path: string;
}
export declare function load_trace(path: string): Trace;
export declare function load_traces(dir?: string): readonly Trace[];
export interface DecisionStep {
  readonly index: number;
  readonly decision: Variant;
  readonly action: string | null;
  readonly nondet_picks: Record<string, Value> | null;
}
export declare function steps(t: Trace): Generator<DecisionStep>;
export declare function decisions(t: Trace): Generator<DecisionStep>;
