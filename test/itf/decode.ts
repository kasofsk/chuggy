/**
 * Decodes the Informal Trace Format that `quint run --out-itf` writes into
 * plain JavaScript values, and encodes them back. It knows ITF's wire tagging
 * and nothing about this machine: the vocabulary a `Ticket` decodes into is
 * `src/domain/`'s, one layer up from here, so this module can be read against
 * the ITF specification alone.
 *
 * Round-tripping is the property that matters and the one the suite pins.
 * A golden is the specification's own output, so a decoder that loses a field
 * would make the replayer agree with a trace nobody emitted.
 */

/** A decoded ITF value: ITF's scalars, its containers, and its variants. */
export type ItfValue =
  | bigint
  | string
  | boolean
  | ItfValue[]
  | ItfVariant
  | ItfMap
  | ItfSet
  | ItfTuple
  | ItfRecord;

/** A sum-type constructor: `tag` names the arm, `value` is its payload. */
export interface ItfVariant {
  readonly kind: "variant";
  readonly tag: string;
  readonly value: ItfValue;
}

export interface ItfMap {
  readonly kind: "map";
  readonly entries: readonly (readonly [ItfValue, ItfValue])[];
}

export interface ItfSet {
  readonly kind: "set";
  readonly elements: readonly ItfValue[];
}

export interface ItfTuple {
  readonly kind: "tuple";
  readonly elements: readonly ItfValue[];
}

export interface ItfRecord {
  readonly kind: "record";
  readonly fields: ReadonlyMap<string, ItfValue>;
}

/** One state of a trace: its index, and every variable the run declared. */
export interface ItfState {
  readonly index: number;
  readonly values: ReadonlyMap<string, ItfValue>;
}

/** A whole trace, as emitted for one instance under one seed. */
export interface ItfTrace {
  readonly source: string;
  readonly vars: readonly string[];
  readonly states: readonly ItfState[];
}

const UNTAGGED_KEYS = new Set(["#bigint", "#map", "#set", "#tup", "#meta"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(where: string, value: unknown): never {
  throw new Error(
    `itf: ${where}: unrecognised encoding ${JSON.stringify(value)}`,
  );
}

/** Decodes one ITF-encoded value. Throws on anything the format does not define. */
export function decodeValue(raw: unknown, where = "$"): ItfValue {
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    /** ITF tags every integer, so a bare number is a shape this decoder has not seen and must not guess at. */
    return fail(where, raw);
  }
  if (Array.isArray(raw)) {
    return raw.map((item, i) => decodeValue(item, `${where}[${String(i)}]`));
  }
  if (!isPlainObject(raw)) return fail(where, raw);

  if ("#bigint" in raw) {
    const literal = raw["#bigint"];
    if (typeof literal !== "string") return fail(`${where}.#bigint`, literal);
    return BigInt(literal);
  }
  if ("#set" in raw) {
    const elements = raw["#set"];
    if (!Array.isArray(elements)) return fail(`${where}.#set`, elements);
    return {
      kind: "set",
      elements: elements.map((e, i) =>
        decodeValue(e, `${where}.#set[${String(i)}]`),
      ),
    };
  }
  if ("#tup" in raw) {
    const elements = raw["#tup"];
    if (!Array.isArray(elements)) return fail(`${where}.#tup`, elements);
    return {
      kind: "tuple",
      elements: elements.map((e, i) =>
        decodeValue(e, `${where}.#tup[${String(i)}]`),
      ),
    };
  }
  if ("#map" in raw) {
    const entries = raw["#map"];
    if (!Array.isArray(entries)) return fail(`${where}.#map`, entries);
    return {
      kind: "map",
      entries: entries.map((pair, i) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
          return fail(`${where}.#map[${String(i)}]`, pair);
        }
        return [
          decodeValue(pair[0], `${where}.#map[${String(i)}].key`),
          decodeValue(pair[1], `${where}.#map[${String(i)}].value`),
        ] as const;
      }),
    };
  }
  if ("tag" in raw && "value" in raw) {
    const tag = raw["tag"];
    if (typeof tag !== "string") return fail(`${where}.tag`, tag);
    return {
      kind: "variant",
      tag,
      value: decodeValue(raw["value"], `${where}.${tag}`),
    };
  }

  const fields = new Map<string, ItfValue>();
  for (const [key, value] of Object.entries(raw)) {
    if (UNTAGGED_KEYS.has(key)) return fail(where, raw);
    fields.set(key, decodeValue(value, `${where}.${key}`));
  }
  return { kind: "record", fields };
}

/** Re-encodes a decoded value into the JSON shape ITF writes. */
export function encodeValue(value: ItfValue): unknown {
  if (typeof value === "bigint") return { "#bigint": value.toString() };
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(encodeValue);
  switch (value.kind) {
    case "set":
      return { "#set": value.elements.map(encodeValue) };
    case "tuple":
      return { "#tup": value.elements.map(encodeValue) };
    case "map":
      return {
        "#map": value.entries.map(([k, v]) => [encodeValue(k), encodeValue(v)]),
      };
    case "variant":
      return { tag: value.tag, value: encodeValue(value.value) };
    case "record": {
      const out: Record<string, unknown> = {};
      for (const [key, field] of value.fields) out[key] = encodeValue(field);
      return out;
    }
  }
}

/** Decodes a whole trace document. `#meta` is read for `source` and dropped. */
export function decodeTrace(raw: unknown): ItfTrace {
  if (!isPlainObject(raw)) return fail("$", raw);
  const meta = raw["#meta"];
  const source =
    isPlainObject(meta) && typeof meta["source"] === "string"
      ? meta["source"]
      : "";
  const varsRaw = raw["vars"];
  if (!Array.isArray(varsRaw) || !varsRaw.every((v) => typeof v === "string")) {
    return fail("$.vars", varsRaw);
  }
  const statesRaw = raw["states"];
  if (!Array.isArray(statesRaw)) return fail("$.states", statesRaw);

  const states = statesRaw.map((state, i) => {
    if (!isPlainObject(state)) return fail(`$.states[${String(i)}]`, state);
    const values = new Map<string, ItfValue>();
    for (const [key, value] of Object.entries(state)) {
      if (key === "#meta") continue;
      values.set(key, decodeValue(value, `$.states[${String(i)}].${key}`));
    }
    return { index: i, values };
  });

  /** The mbt metadata declares its variables in a second module, so `vars` repeats a name; collapsing here keeps every lookup downstream unambiguous. */
  return { source, vars: [...new Set(varsRaw)], states };
}

/** Reads one variable out of a state, failing loudly rather than returning undefined. */
export function stateValue(state: ItfState, name: string): ItfValue {
  const found = state.values.get(name);
  if (found === undefined) {
    throw new Error(
      `itf: state ${String(state.index)} has no variable ${name}; it has ${[...state.values.keys()].join(", ")}`,
    );
  }
  return found;
}

/** Reads a field out of a decoded record, failing loudly rather than silently. */
export function field(value: ItfValue, name: string): ItfValue {
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "record"
  ) {
    throw new Error(
      `itf: expected a record to read ${name} from, got ${describe(value)}`,
    );
  }
  const found = value.fields.get(name);
  if (found === undefined) {
    throw new Error(
      `itf: record has no field ${name}; it has ${[...value.fields.keys()].join(", ")}`,
    );
  }
  return found;
}

/** Names a decoded value's shape, for an error a reader can act on. */
export function describe(value: ItfValue): string {
  if (typeof value === "bigint") return `int(${value.toString()})`;
  if (typeof value === "string") return `string(${value})`;
  if (typeof value === "boolean") return `bool(${String(value)})`;
  if (Array.isArray(value)) return `list[${String(value.length)}]`;
  return value.kind === "variant" ? `variant(${value.tag})` : value.kind;
}
