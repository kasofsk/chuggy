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
 * alone cannot say which model type it is, so the direction that needs the
 * type has the type written down.
 */

import {
  decodeTicketGraph as decodeTicketGraphValue,
  decodeLastDecision as decodeLastDecisionValue,
} from "../../src/generated/model-api.ts";
import type {
  TicketGraph,
  EvaluationInstance,
  EvaluationProgress,
  EvaluationReworkFact,
  EvaluationState,
  EvaluatorStatus,
  FinalizationFact,
  FinalizationOperation,
  FinalizationResult,
  LastDecision,
  Obligation,
  StageRun,
  TaskIdentity,
  TaskDefinition,
  TaskObligation,
  TaskTerminalFact,
  ValidatedTaskResult,
  ReleasedTicket,
  EvaluationPlan,
  TaskTerminalReport,
  Ticket,
  TicketCommand,
  TicketEvent,
  TicketRefusal,
  WorkFailureEvent,
} from "../../src/domain/generated/modelTypes.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
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

/** The last decision a state records, read through the model's own decoder. */
export function decodeLastDecision(value: ItfValue): LastDecision {
  return decodeLastDecisionValue(itfToWire(value));
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

/** A dependency set, ascending, which is the order a set has no opinion about. */
export function encodeDependencies(
  dependencies: ReadonlySet<number>,
): ItfValue {
  return {
    kind: "set",
    elements: [...dependencies].sort((a, b) => a - b).map((d) => encodeInt(d)),
  };
}

function encodeTaskDefinition(definition: TaskDefinition): ItfValue {
  return encodeRecord([
    ["workload", encodeInt(definition.workload)],
    ["inputs", encodeInt(definition.inputs)],
    ["executionRequirements", encodeInt(definition.executionRequirements)],
    ["resultContract", encodeInt(definition.resultContract)],
  ]);
}

export function encodePlanStages(stages: EvaluationPlan["stages"]): ItfValue {
  return stages.map((stage) =>
    encodeRecord([
      ["key", encodeInt(stage.key)],
      [
        "evaluators",
        stage.evaluators.map((entry) =>
          encodeRecord([
            ["key", encodeInt(entry.key)],
            ["task", encodeTaskDefinition(entry.task)],
          ]),
        ),
      ],
    ]),
  );
}

function encodeTaskObligation(obligation: TaskObligation): ItfValue {
  return encodeRecord([
    ["task", encodeTaskIdentity(obligation.task)],
    ["definition", encodeTaskDefinition(obligation.definition)],
    ["contextRef", encodeInt(obligation.contextRef)],
  ]);
}

function encodeValidatedTaskResult(result: ValidatedTaskResult): ItfValue {
  return encodeRecord([
    ["obligation", encodeTaskObligation(result.obligation)],
    ["resultRef", encodeInt(result.resultRef)],
  ]);
}

/** The whole released record, in the order the model declares its fields. */
export function encodeReleasedTicket(definition: ReleasedTicket): ItfValue {
  return encodeRecord([
    ["id", encodeInt(definition.id)],
    ["content", encodeInt(definition.content)],
    ["dependencies", encodeDependencies(definition.dependencies)],
    ["workConfiguration", encodeTaskDefinition(definition.workConfiguration)],
    [
      "evaluationPlan",
      encodeRecord([
        ["stages", encodePlanStages(definition.evaluationPlan.stages)],
      ]),
    ],
    [
      "finalizationConfiguration",
      encodeInt(definition.finalizationConfiguration),
    ],
  ]);
}

/** What a task came back with, whichever arm it is. */
export function encodeTaskTerminalReport(report: TaskTerminalReport): ItfValue {
  switch (report.type) {
    case "WorkResultReport":
      return encodeVariant(
        "WorkResultReport",
        encodeRecord([
          ["ticket", encodeInt(report.value.ticket)],
          ["result", encodeValidatedTaskResult(report.value.result)],
          ["acceptedSourceRef", encodeInt(report.value.acceptedSourceRef)],
        ]),
      );
    case "EvaluationResultReport":
      return encodeVariant(
        "EvaluationResultReport",
        encodeRecord([
          ["ticket", encodeInt(report.value.ticket)],
          ["result", encodeValidatedTaskResult(report.value.result)],
          ["verdict", encodeNullary(report.value.verdict)],
        ]),
      );
    case "TerminalFailureReport":
      return encodeVariant(
        "TerminalFailureReport",
        encodeRecord([
          ["ticket", encodeInt(report.value.ticket)],
          [
            "failure",
            encodeRecord([
              ["task", encodeTaskIdentity(report.value.failure.task)],
              ["evidence", encodeInt(report.value.failure.evidence)],
            ]),
          ],
          ["kind", encodeNullary(report.value.kind)],
        ]),
      );
  }
}

/** A finalizer's result: its arm, and the evidence it carries. */
export function encodeFinalizationResult(result: FinalizationResult): ItfValue {
  return encodeVariant(result.type, encodeInt(result.value));
}

/** A command, whichever arm it is. */
export function encodeTicketCommand(command: TicketCommand): ItfValue {
  switch (command.type) {
    case "CreateTicket":
      return encodeVariant(command.type, encodeReleasedTicket(command.value));
    case "UpdateTicket":
      return encodeVariant(
        command.type,
        encodeRecord([
          ["ticket", encodeInt(command.value.ticket)],
          ["expectedRevision", encodeInt(command.value.expectedRevision)],
          ["definition", encodeReleasedTicket(command.value.definition)],
        ]),
      );
    case "DispatchTicket":
      return encodeVariant(
        command.type,
        encodeRecord([
          ["ticket", encodeInt(command.value.ticket)],
          ["source", encodeInt(command.value.source)],
        ]),
      );
    case "RevokeTicket":
    case "ResumeTicket":
      return encodeVariant(command.type, encodeInt(command.value));
    case "ReportTaskTerminal":
      return encodeVariant(
        command.type,
        encodeTaskTerminalReport(command.value),
      );
    case "ReportFinalizationResult":
      return encodeVariant(
        command.type,
        encodeRecord([
          ["ticket", encodeInt(command.value.ticket)],
          ["workCycle", encodeInt(command.value.workCycle)],
          ["generation", encodeInt(command.value.generation)],
          ["result", encodeFinalizationResult(command.value.result)],
        ]),
      );
  }
}

/** A refusal, whichever of the thirteen arms it is, with its payload. */
export function encodeTicketRefusal(refusal: TicketRefusal): ItfValue {
  switch (refusal.type) {
    case "TicketAlreadyExists":
    case "SelfDependency":
    case "TicketNotFound":
    case "TicketNotPending":
    case "TicketIdentityMismatch":
    case "TicketDependenciesChanged":
    case "TicketNotRevocable":
    case "TicketNotResumable":
      return encodeVariant(refusal.type, encodeInt(refusal.value));
    case "DependenciesNotFound":
    case "DependenciesIncomplete":
      return encodeVariant(
        refusal.type,
        encodeRecord([
          ["ticket", encodeInt(refusal.value.ticket)],
          ["dependencies", encodeDependencies(refusal.value.dependencies)],
        ]),
      );
    case "TicketRevisionStale":
      return encodeVariant(
        refusal.type,
        encodeRecord([
          ["ticket", encodeInt(refusal.value.ticket)],
          ["expected", encodeInt(refusal.value.expected)],
          ["current", encodeInt(refusal.value.current)],
        ]),
      );
    case "TaskNotCurrent":
      return encodeVariant(
        refusal.type,
        encodeRecord([
          ["ticket", encodeInt(refusal.value.ticket)],
          ["task", encodeTaskIdentity(refusal.value.task)],
        ]),
      );
    case "FinalizationNotCurrent":
      return encodeVariant(
        refusal.type,
        encodeRecord([
          ["ticket", encodeInt(refusal.value.ticket)],
          ["workCycle", encodeInt(refusal.value.workCycle)],
          ["generation", encodeInt(refusal.value.generation)],
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
            return [
              encodeInt(evaluator),
              encodeEvaluatorStatus(status),
            ] as const;
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
        ["acceptedSourceRef", encodeInt(instance.input.acceptedSourceRef)],
      ]),
    ],
    [
      "plan",
      encodeRecord([["stages", encodePlanStages(instance.plan.stages)]]),
    ],
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

function encodeTicket(ticket: Ticket): ItfValue {
  return encodeRecord([
    ["phase", encodeNullary(ticket.phase)],
    ["definition", encodeReleasedTicket(ticket.definition)],
    ["revision", encodeInt(ticket.revision)],
    ["source", encodeInt(ticket.source)],
    ["evaluations", ticket.evaluations.map(encodeEvaluationInstance)],
    ["workCyclesStarted", encodeInt(ticket.workCyclesStarted)],
    ["spawned", encodeInt(ticket.spawned)],
    ["finalizationGeneration", encodeInt(ticket.finalizationGeneration)],
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

function encodeTaskTerminalFact(fact: TaskTerminalFact): ItfValue {
  return encodeRecord([
    ["ticket", encodeInt(fact.ticket)],
    ["report", encodeTaskTerminalReport(fact.report)],
  ]);
}

function encodeEvaluationReworkFact(fact: EvaluationReworkFact): ItfValue {
  return encodeRecord([
    ["ticket", encodeInt(fact.ticket)],
    ["report", encodeTaskTerminalReport(fact.report)],
    [
      "evidence",
      fact.evidence.map((entry) =>
        encodeRecord([
          ["evaluator", encodeInt(entry.evaluator)],
          ["resultRef", encodeInt(entry.resultRef)],
        ]),
      ),
    ],
  ]);
}

function encodeWorkFailureEvent(fact: WorkFailureEvent): ItfValue {
  return encodeRecord([
    ["ticket", encodeInt(fact.ticket)],
    ["task", encodeTaskIdentity(fact.task)],
    ["evidence", encodeInt(fact.evidence)],
  ]);
}

function encodeFinalizationFact(fact: FinalizationFact): ItfValue {
  return encodeRecord([
    ["ticket", encodeInt(fact.ticket)],
    ["workCycle", encodeInt(fact.workCycle)],
    ["generation", encodeInt(fact.generation)],
    ["evidence", encodeInt(fact.evidence)],
  ]);
}

/** What happened, whichever arm it is. */
export function encodeTicketEvent(event: TicketEvent): ItfValue {
  switch (event.type) {
    case "TicketCreated":
      return encodeVariant(event.type, encodeReleasedTicket(event.value));
    case "TicketUpdated":
      return encodeVariant(
        event.type,
        encodeRecord([
          ["ticket", encodeInt(event.value.ticket)],
          ["revision", encodeInt(event.value.revision)],
          ["definition", encodeReleasedTicket(event.value.definition)],
        ]),
      );
    case "TicketDispatched":
      return encodeVariant(
        event.type,
        encodeRecord([
          ["ticket", encodeInt(event.value.ticket)],
          ["source", encodeInt(event.value.source)],
        ]),
      );
    case "TicketRevoked":
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      return encodeVariant(event.type, encodeInt(event.value));
    case "TicketWorkResultAccepted":
      return encodeVariant(
        event.type,
        encodeRecord([
          ["ticket", encodeInt(event.value.ticket)],
          ["result", encodeValidatedTaskResult(event.value.result)],
          ["acceptedSourceRef", encodeInt(event.value.acceptedSourceRef)],
        ]),
      );
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable":
      return encodeVariant(event.type, encodeWorkFailureEvent(event.value));
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationBlocked":
      return encodeVariant(event.type, encodeTaskTerminalFact(event.value));
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
      return encodeVariant(event.type, encodeEvaluationReworkFact(event.value));
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return encodeVariant(event.type, encodeFinalizationFact(event.value));
  }
}

function encodeFinalizationOperation(
  operation: FinalizationOperation,
): ItfValue {
  return encodeRecord([
    ["workCycle", encodeInt(operation.workCycle)],
    ["generation", encodeInt(operation.generation)],
    ["input", encodeInt(operation.input)],
    ["source", encodeInt(operation.source)],
  ]);
}

/** What a decision owes the world, whichever of the three arms it is. */
export function encodeObligation(obligation: Obligation): ItfValue {
  switch (obligation.type) {
    case "ExecuteTask":
      return encodeVariant(
        obligation.type,
        encodeRecord([
          ["ticket", encodeInt(obligation.value.ticket)],
          ["task", encodeTaskObligation(obligation.value.task)],
        ]),
      );
    case "FinalizeTicket":
      return encodeVariant(
        obligation.type,
        encodeRecord([
          ["ticket", encodeInt(obligation.value.ticket)],
          [
            "finalization",
            encodeFinalizationOperation(obligation.value.finalization),
          ],
          ["configuration", encodeInt(obligation.value.configuration)],
        ]),
      );
    case "CancelTask":
      return encodeVariant(
        obligation.type,
        encodeRecord([
          ["ticket", encodeInt(obligation.value.ticket)],
          ["task", encodeTaskIdentity(obligation.value.task)],
        ]),
      );
  }
}

/** The last decision, written back as ITF holds one. */
export function encodeLastDecision(last: LastDecision): ItfValue {
  if (last === "NoDecision") return encodeNullary("NoDecision");
  if (last.type === "Refused")
    return encodeVariant("Refused", encodeTicketRefusal(last.value));
  return encodeVariant(
    "Decided",
    encodeRecord([
      ["event", encodeTicketEvent(last.value.event)],
      ["obligations", last.value.obligations.map(encodeObligation)],
    ]),
  );
}
