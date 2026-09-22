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
  decodeTicketGraph as decodeTicketGraphValue,
  decodeStepRecord as decodeStepRecordValue,
} from "../../src/generated/model-api.ts";
import type {
  TicketGraph,
  EvaluationInstance,
  EvaluationProgress,
  EvaluationState,
  EvaluatorStatus,
  StageRun,
  StepRecord,
  Task,
  TaskIdentity,
  TaskResultRef,
  TaskTerminalReport,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
import { tasksInEvaluatorKeyOrder } from "../../src/domain/task.ts";
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
export function decodeTicketGraph(value: ItfValue): TicketGraph {
  return decodeTicketGraphValue({ tickets: itfToWire(value) });
}

/** One observed decision, read through the model's own decoder. */
export function decodeStepRecord(value: ItfValue): StepRecord {
  return decodeStepRecordValue(itfToWire(value));
}

/** A drawn ticket id, branded at the boundary it enters through. */
export function decodeTicketId(value: ItfValue): TicketId {
  return asTicketId(Number(itfToWire(value)));
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
      ["key", encodeInt(stage.key)],
      [
        "evaluators",
        stage.evaluators.map((entry) =>
          encodeRecord([["key", encodeInt(entry.key)]]),
        ),
      ],
    ]),
  );
}

function encodeTaskResultRef(result: TaskResultRef): ItfValue {
  return encodeRecord([
    ["manifest", encodeInt(result.manifest)],
    ["digest", encodeInt(result.digest)],
    ["schema", encodeInt(result.schema)],
  ]);
}

/** What a task came back with, whichever arm it is. */
export function encodeTaskTerminalReport(
  report: TaskTerminalReport,
): ItfValue {
  switch (report.type) {
    case "WorkResultReport":
      return encodeVariant(
        "WorkResultReport",
        encodeRecord([["result", encodeTaskResultRef(report.value.result)]]),
      );
    case "EvaluationResultReport":
      return encodeVariant(
        "EvaluationResultReport",
        encodeRecord([
          ["result", encodeTaskResultRef(report.value.result)],
          ["verdict", encodeNullary(report.value.verdict)],
        ]),
      );
    case "TerminalFailureReport":
      return encodeVariant(
        "TerminalFailureReport",
        encodeRecord([
          ["evidence", encodeInt(report.value.evidence)],
          ["kind", encodeNullary(report.value.kind)],
        ]),
      );
  }
}

/** One evaluator's standing in a run, whichever arm it is. */
function encodeEvaluatorStatus(status: EvaluatorStatus): ItfValue {
  if (status === "Awaiting") return encodeNullary("Awaiting");
  if (status.type === "Produced")
    return encodeVariant(
      "Produced",
      encodeVariant(status.value.type, encodeInt(status.value.value)),
    );
  return encodeVariant(status.type, encodeInt(status.value));
}

/** One run of one stage; its evaluator map ascends by key, as ITF writes one. */
function encodeStageRun(run: StageRun): ItfValue {
  return encodeRecord([
    ["stageIndex", encodeInt(run.stageIndex)],
    ["generation", encodeInt(run.generation)],
    [
      "evaluators",
      {
        kind: "map",
        entries: [...run.evaluators.keys()]
          .sort((a, b) => a - b)
          .map((evaluator) => {
            const status = run.evaluators.get(evaluator);
            if (status === undefined)
              throw new Error(
                `vocabulary: no status for evaluator ${String(evaluator)}`,
              );
            return [encodeInt(evaluator), encodeEvaluatorStatus(status)] as const;
          }),
      },
    ],
  ]);
}

function encodeEvaluationProgress(progress: EvaluationProgress): ItfValue {
  return encodeRecord([
    ["completedStages", progress.completedStages.map(encodeStageRun)],
    ["stage", encodeStageRun(progress.stage)],
  ]);
}

function encodeEvaluationState(state: EvaluationState): ItfValue {
  switch (state.type) {
    case "Running":
    case "EvaluationBlocked":
      return encodeVariant(state.type, encodeEvaluationProgress(state.value));
    case "EvaluationPassed":
    case "EvaluationFailed":
      return encodeVariant(state.type, state.value.map(encodeStageRun));
  }
}

/** One judgement of one work cycle, as the ticket keeps it. */
function encodeEvaluationInstance(instance: EvaluationInstance): ItfValue {
  return encodeRecord([
    ["workCycle", encodeInt(instance.workCycle)],
    [
      "input",
      encodeRecord([
        ["ticket", encodeInt(instance.input.ticket)],
        ["workResult", encodeInt(instance.input.workResult)],
      ]),
    ],
    ["plan", encodeRecord([["stages", encodeProgram(instance.plan.stages)]])],
    ["state", encodeEvaluationState(instance.state)],
  ]);
}

/** The contract's identity, whichever arm it is, with its own record inside. */
export function encodeTaskIdentity(identity: TaskIdentity): ItfValue {
  switch (identity.type) {
    case "WorkTask":
      return encodeVariant(
        "WorkTask",
        encodeRecord([
          ["ticket", encodeInt(identity.value.ticket)],
          ["cycle", encodeInt(identity.value.cycle)],
        ]),
      );
    case "EvaluationTask":
      return encodeVariant(
        "EvaluationTask",
        encodeRecord([
          ["ticket", encodeInt(identity.value.ticket)],
          ["workCycle", encodeInt(identity.value.workCycle)],
          ["stage", encodeInt(identity.value.stage)],
          ["generation", encodeInt(identity.value.generation)],
          ["evaluator", encodeInt(identity.value.evaluator)],
        ]),
      );
  }
}

function encodeTask(task: Task): ItfValue {
  return encodeRecord([
    ["identity", encodeTaskIdentity(task.identity)],
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
    ["artifact", encodeSum(ticket.artifact, (mark: number) => encodeInt(mark))],
    ["program", encodeProgram(ticket.program)],
    [
      "tasks",
      {
        kind: "set",
        elements: tasksInEvaluatorKeyOrder(ticket.tasks).map(encodeTask),
      },
    ],
    ["evaluations", ticket.evaluations.map(encodeEvaluationInstance)],
    ["workCyclesStarted", encodeInt(ticket.workCyclesStarted)],
    ["spawned", encodeInt(ticket.spawned)],
    ["escalation", encodeNullary(ticket.escalation)],
    ["completions", encodeInt(ticket.completions)],
  ]);
}

/** The ticket map, written back as ITF holds one. */
export function encodeTicketGraph(graph: TicketGraph): ItfValue {
  return {
    kind: "map",
    entries: [...graph.tickets.keys()]
      .sort((a, b) => a - b)
      .map((id) => {
        const ticket = graph.tickets.get(id);
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
