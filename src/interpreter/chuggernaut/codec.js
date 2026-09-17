import { canonical_json } from "./json.js";
import * as task from "../../domain/chuggernaut/task.js";
import * as evaluation from "../../domain/chuggernaut/evaluation.js";
import * as ticket from "../../domain/chuggernaut/ticket.js";
import { codec_schema } from "./codec_schema.js";
export class CodecError extends Error {}
export class Variants {
  union;
  constructor(union) {
    this.union = union;
  }
}
export const TICKET_COMMAND = new Variants("TicketCommand");
export const TICKET_DECISION = new Variants("TicketDecision");
export const TICKET_EVENT = new Variants("TicketEvent");
export const TICKET_REFUSAL = new Variants("TicketRefusal");
export const TICKET_STATE = new Variants("TicketState");
export const OBLIGATION = new Variants("Obligation");
const registry = { ...task, ...evaluation, ...ticket };
export function register_records(records) {
  Object.assign(registry, records);
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unicode_order(left, right) {
  const a = Array.from(left, (c) => c.codePointAt(0));
  const b = Array.from(right, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
export { canonical_json } from "./json.js";
function order(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  const x = canonical_json(a),
    y = canonical_json(b);
  return unicode_order(x, y);
}
function encode_value(value, path) {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isInteger(value))
  )
    return value;
  if (Array.isArray(value))
    return value.map((v, i) => encode_value(v, `${path}[${i}]`));
  if (value instanceof Set)
    return [...value].map((v) => encode_value(v, `${path}{}`)).sort(order);
  if (value instanceof Map) {
    const entries = [...value.entries()];
    if (entries.every(([k]) => typeof k === "string"))
      return Object.fromEntries(
        entries.map(([k, v]) => [
          String(k),
          encode_value(v, `${path}.${String(k)}`),
        ]),
      );
    return entries
      .map(([k, v]) => [
        encode_value(k, `${path}{}.key`),
        encode_value(v, `${path}{}.value`),
      ])
      .sort((a, b) => order(a[0], b[0]));
  }
  if (record(value)) {
    const name = value.constructor.name;
    const schema = codec_schema[name];
    if (schema?.fields) {
      return {
        type: name,
        ...Object.fromEntries(
          schema.fields
            .filter(([field, , optional]) =>
              optional === "default-empty"
                ? !Array.isArray(value[field]) || value[field].length !== 0
                : optional !== "optional" || value[field] !== null,
            )
            .map(([field]) => [
              field,
              encode_value(value[field], `${path}.${field}`),
            ]),
        ),
      };
    }
    if (name === "Object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          encode_value(v, `${path}.${k}`),
        ]),
      );
  }
  throw new CodecError(`${path}: a ${typeof value} has no canonical JSON`);
}
export function encode(value) {
  return canonical_json(encode_value(value, "value"));
}
function split(annotation, separator) {
  const out = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < annotation.length; i++) {
    const c = annotation[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === separator && depth === 0) {
      out.push(annotation.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(annotation.slice(start).trim());
  return out;
}
function decode_value(raw, annotation, path) {
  const schema = codec_schema[annotation];
  if (schema?.alias) return decode_value(raw, schema.alias, path);
  const union = split(annotation, "|");
  if (union.length > 1) {
    if (!record(raw) || typeof raw.type !== "string")
      throw new CodecError(
        `${path}: no 'type' naming one of ${union.join(", ")}`,
      );
    for (const member of union) {
      try {
        return decode_value(raw, member, path);
      } catch (error) {
        if (!(error instanceof CodecError)) throw error;
      }
    }
    throw new CodecError(
      `${path}: unknown type '${raw.type}', expected one of ${union.join(", ")}`,
    );
  }
  if (annotation === "str" || annotation === "int" || annotation === "bool") {
    if (
      (annotation === "str" && typeof raw === "string") ||
      (annotation === "bool" && typeof raw === "boolean") ||
      (annotation === "int" && typeof raw === "number" && Number.isInteger(raw))
    )
      return raw;
    throw new CodecError(`${path}: expected ${annotation}, got ${typeof raw}`);
  }
  const generic = /^(\w+)\[(.*)\]$/.exec(annotation);
  if (generic) {
    const kind = generic[1],
      args = split(generic[2], ",");
    if (kind === "tuple" || kind === "frozenset") {
      if (!Array.isArray(raw))
        throw new CodecError(`${path}: expected an array`);
      const values = raw.map((v, i) =>
        decode_value(v, args[0], `${path}[${i}]`),
      );
      return kind === "frozenset" ? new Set(values) : values;
    }
    if (kind === "Mapping" || kind === "dict") {
      const map = new Map();
      if (args[0] === "str" || (record(raw) && Object.keys(raw).length === 0)) {
        if (!record(raw)) throw new CodecError(`${path}: expected an object`);
        for (const [k, v] of Object.entries(raw))
          map.set(k, decode_value(v, args[1], `${path}.${k}`));
      } else {
        if (!Array.isArray(raw))
          throw new CodecError(`${path}: expected an array`);
        for (const [i, pair] of raw.entries()) {
          if (!Array.isArray(pair) || pair.length !== 2)
            throw new CodecError(
              `${path}[${i}]: expected a [key, value] pair of 2`,
            );
          const key = decode_value(pair[0], args[0], `${path}[${i}].key`);
          if (map.has(key))
            throw new CodecError(
              `${path}[${i}].key: ${String(key)} appears twice`,
            );
          map.set(key, decode_value(pair[1], args[1], `${path}[${i}].value`));
        }
      }
      return map;
    }
  }
  if (!schema?.fields)
    throw new CodecError(`${path}: no codec for the annotation ${annotation}`);
  if (!record(raw) || raw.type !== annotation)
    throw new CodecError(
      `${path}: expected type '${annotation}', got ${record(raw) ? String(raw.type) : typeof raw}`,
    );
  const fields = schema.fields;
  const missing = fields
    .filter(([f, , optional]) => optional === undefined && !(f in raw))
    .map(([f]) => f)
    .sort();
  if (missing.length)
    throw new CodecError(
      `${path}: ${annotation} is missing ${JSON.stringify(missing)}`,
    );
  const stray = Object.keys(raw)
    .filter((k) => k !== "type" && !fields.some(([f]) => f === k))
    .sort();
  if (stray.length)
    throw new CodecError(
      `${path}: ${annotation} has no field ${JSON.stringify(stray)}`,
    );
  const constructor = registry[annotation];
  if (typeof constructor !== "function")
    throw new CodecError(`${path}: unregistered class ${annotation}`);
  try {
    return Reflect.construct(
      constructor,
      fields.map(([f, t, optional]) =>
        !(f in raw) && optional !== undefined
          ? optional === "default-empty"
            ? []
            : null
          : decode_value(raw[f], t, `${path}.${f}`),
      ),
    );
  } catch (error) {
    throw new CodecError(
      `${path}: ${annotation} rejects the decoded value: ${String(error)}`,
    );
  }
}
export function decode(text, expected) {
  let raw;
  try {
    raw = JSON.parse(text, (_key, value, context) => {
      if (
        typeof value === "number" &&
        context?.source &&
        /[.eE]/.test(context.source)
      ) {
        return { float_literal: value };
      }
      return value;
    });
  } catch (error) {
    throw new CodecError(`value: not JSON: ${String(error)}`);
  }
  return decode_value(
    raw,
    expected instanceof Variants ? expected.union : expected.name,
    "value",
  );
}
