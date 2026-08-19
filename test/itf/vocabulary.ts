/**
 * The seam between a Quint trace and this machine's values.
 *
 * ITF and the model's own wire format say the same things differently: ITF
 * wraps integers, marks sets and maps by kind, and writes every sum as a
 * tagged variant, while the generated codec takes arrays and a `type` field.
 * So decoding is a SHAPE CONVERSION followed by the generated decoder — which
 * means no vocabulary is restated here. A constructor added to the model
 * reaches this file without an edit, and cannot reach it in a shape the model
 * does not have.
 *
 * Encoding back to ITF stays explicit, and that is not an oversight: a value
 * alone cannot say whether a string is a step label or a nullary variant, so
 * the direction that needs the type has the type written down.
 */

import {
  decodeCore as decodeCoreValue,
  decodeStepRecord as decodeStepRecordValue,
} from "../../src/generated/model-api.ts";
import type {
  Core,
  StepRecord,
  Task,
  Ticket,
  Verdict,
} from "../../src/domain/generated/modelTypes.ts";
import {
  asTaskId,
  asTicketId,
  type TaskId,
  type TicketId,
} from "../../src/domain/ids.ts";
import { tasksInIdOrder } from "../../src/domain/task.ts";
import { describe, encodeValue, type ItfValue } from "./decode.ts";

/**
 * ITF as the generated codec wants it. A nullary variant becomes its bare tag,
 * because that is how the generator emits one; anything else keeps its payload
 * under `type` and `value`.
 */
export function itfToWire(value: ItfValue): unknown {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(itfToWire);
  switch (value.kind) {
    case "variant": {
      const payload = value.value;
      const nullary =
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        payload.kind === "tuple" &&
        payload.elements.length === 0;
      return nullary
        ? value.tag
        : { type: value.tag, value: itfToWire(payload) };
    }
    case "set":
      return value.elements.map(itfToWire);
    case "map":
      return value.entries.map(([key, item]) => [
        itfToWire(key),
        itfToWire(item),
      ]);
    case "tuple":
      return value.elements.map(itfToWire);
    case "record":
      return Object.fromEntries(
        [...value.fields].map(([name, item]) => [name, itfToWire(item)]),
      );
    default:
      throw new Error(`vocabulary: cannot read ${describe(value)}`);
  }
}

/** One state's ticket map, read through the model's own decoder. */
export function decodeCore(value: ItfValue): Core {
  return decodeCoreValue({ tickets: itfToWire(value) });
}

/** One observed decision, read through the model's own decoder. */
export function decodeStepRecord(value: ItfValue): StepRecord {
  return decodeStepRecordValue(itfToWire(value));
}

/** A drawn ticket id, branded at the boundary it enters through. */
export function decodeTicketId(value: ItfValue): TicketId {
  return asTicketId(Number(itfToWire(value)));
}

/** A drawn task id, branded at the boundary it enters through. */
export function decodeTaskId(value: ItfValue): TaskId {
  return asTaskId(Number(itfToWire(value)));
}

/** A drawn value of any model sum or record, read through its own decoder. */
export function decodeWith<Value>(
  decoder: (raw: unknown) => Value,
  value: ItfValue,
): Value {
  return decoder(itfToWire(value));
}

/** A plain integer, as ITF writes one. */
export function encodeInt(value: number): ItfValue {
  return BigInt(value);
}

/** A nullary variant, which is how ITF writes a sum arm carrying nothing. */
export function encodeNullaryTag(tag: string): ItfValue {
  return encodeNullary(tag);
}

/**
 * A draw as ITF records one: present under Some, absent under None. It answers
 * the serialized shape rather than the decoded one, because an option only
 * exists in a document being written.
 */
export function encodeOption(drawn: ItfValue | undefined): unknown {
  return drawn === undefined
    ? { tag: "None", value: { "#tup": [] } }
    : { tag: "Some", value: encodeValue(drawn) };
}

/** A model sum with its payload written by the caller, for a draw ITF carries alone. */
export function encodeSumValue<Payload>(
  value: string | { readonly type: string; readonly value: Payload },
  payload: (inner: Payload) => ItfValue,
): ItfValue {
  if (typeof value === "string") return encodeNullary(value);
  return encodeVariant(value.type, payload(value.value));
}

/** A nullary variant, which is how ITF writes a sum arm carrying nothing. */
function encodeNullary(tag: string): ItfValue {
  return { kind: "variant", tag, value: { kind: "tuple", elements: [] } };
}

/** A variant carrying a payload. */
function encodeVariant(tag: string, value: ItfValue): ItfValue {
  return { kind: "variant", tag, value };
}

/** A record, in the field order ITF wrote it. */
function encodeRecord(
  fields: readonly (readonly [string, ItfValue])[],
): ItfValue {
  return { kind: "record", fields: new Map(fields) };
}

/** A model sum, whichever shape the generated type gave it. */
function encodeSum(
  value: string | { readonly type: string; readonly value: unknown },
  payload: (inner: never) => ItfValue,
): ItfValue {
  if (typeof value === "string") return encodeNullary(value);
  return encodeVariant(value.type, payload(value.value as never));
}

export function encodeVerdict(value: Verdict): ItfValue {
  return encodeNullary(value);
}

/** A dependency set, ascending, which is the order a set has no opinion about. */
export function encodeDeps(deps: ReadonlySet<number>): ItfValue {
  return {
    kind: "set",
    elements: [...deps].sort((a, b) => a - b).map((d) => encodeInt(d)),
  };
}

export function encodeProgram(program: Ticket["program"]): ItfValue {
  return program.map((stage) =>
    encodeRecord([
      ["fanout", encodeInt(stage.fanout)],
      ["combinator", encodeNullary(stage.combinator)],
    ]),
  );
}

function encodeTask(task: Task): ItfValue {
  return encodeRecord([
    ["id", encodeInt(task.id)],
    ["kind", encodeSum(task.kind, (stage: number) => encodeInt(stage))],
    [
      "state",
      encodeSum(task.state, (outcome: string) => encodeNullary(outcome)),
    ],
  ]);
}

function encodeTicket(ticket: Ticket): ItfValue {
  return encodeRecord([
    ["phase", encodeNullary(ticket.phase)],
    ["deps", encodeDeps(ticket.deps)],
    ["finalizer", encodeNullary(ticket.finalizer)],
    ["artifact", encodeSum(ticket.artifact, (mark: number) => encodeInt(mark))],
    ["workFanout", encodeInt(ticket.workFanout)],
    [
      "reworkPolicy",
      encodeVariant("BudgetedRework", encodeInt(ticket.reworkPolicy.value)),
    ],
    [
      "finalizationPricing",
      encodeSum(ticket.finalizationPricing, (budget: number) =>
        encodeInt(budget),
      ),
    ],
    ["resumePricing", encodeNullary(ticket.resumePricing)],
    ["program", encodeProgram(ticket.program)],
    [
      "tasks",
      {
        kind: "set",
        elements: tasksInIdOrder(ticket.tasks).map(encodeTask),
      },
    ],
    ["record", ticket.record.map(encodeTask)],
    ["spawned", encodeInt(ticket.spawned)],
    ["reworkLeft", encodeInt(ticket.reworkLeft)],
    ["finalizationLeft", encodeInt(ticket.finalizationLeft)],
    ["gasLeft", encodeInt(ticket.gasLeft)],
    ["resumeAt", encodeNullary(ticket.resumeAt)],
    ["reason", encodeNullary(ticket.reason)],
    ["completions", encodeInt(ticket.completions)],
  ]);
}

/** The ticket map, written back as ITF holds one. */
export function encodeCore(core: Core): ItfValue {
  return {
    kind: "map",
    entries: [...core.tickets.keys()]
      .sort((a, b) => a - b)
      .map((id) => {
        const ticket = core.tickets.get(id);
        if (ticket === undefined)
          throw new Error(`vocabulary: no ticket ${String(id)} to encode`);
        return [encodeInt(id), encodeTicket(ticket)] as const;
      }),
  };
}

/** One observed decision, written back as ITF holds one. */
export function encodeStepRecord(rec: StepRecord): ItfValue {
  return encodeRecord([
    ["label", rec.label],
    [
      "transitions",
      rec.transitions.map((t) =>
        encodeRecord([
          ["ticket", encodeInt(t.ticket)],
          ["from", encodeNullary(t.from)],
          ["to", encodeNullary(t.to)],
        ]),
      ),
    ],
    ["effects", rec.effects.map((effect) => effect)],
  ]);
}
