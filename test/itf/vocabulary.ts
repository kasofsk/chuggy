/**
 * The one mapping site between a golden's ITF encoding and the domain
 * vocabulary. Decoding and encoding live together here because a boundary with
 * its two halves in different files drifts one call site at a time, and the
 * bug then appears in the direction nobody changed.
 *
 * It is in `test/` rather than in `src/` because nothing the implementation
 * ships reads a trace: the corpus is a check on the core, not an input to it.
 * The direction that matters is that a decoded `Ticket` is the domain's type
 * and not a shape of this file's invention, which is what makes the round-trip
 * a statement about the vocabulary rather than about the decoder.
 */

import {
  asProjectId,
  asTaskId,
  asTicketId,
  type ProjectId,
  type TaskId,
  type TicketId,
} from "../../src/domain/ids.ts";
import type { Phase } from "../../src/domain/phase.ts";
import type { Combinator, Stage } from "../../src/domain/program.ts";
import {
  tkEval,
  tkWork,
  tsResolved,
  tsRunning,
  type Task,
  type TaskKind,
  type TaskOutcome,
  type TaskState,
  type Verdict,
} from "../../src/domain/task.ts";
import type { Reason, Resume } from "../../src/domain/desk.ts";
import {
  aNone,
  aSome,
  wExclusive,
  wNone,
  woAttempt,
  woNone,
  type ArtifactMark,
  type WrapUp,
  type WrapUpObs,
  type WrapUpOutcome,
} from "../../src/domain/wrapUp.ts";
import { completionsOf, type Ticket } from "../../src/domain/ticket.ts";
import type { Core, StepRecord, Transition } from "../../src/domain/core.ts";
import { effectFromLabel, effectLabel } from "../../src/domain/effect.ts";
import { describe, field, type ItfValue } from "./decode.ts";

const PHASES: readonly Phase[] = [
  "PDraft",
  "PPending",
  "PWorking",
  "PEvaluating",
  "PWrapUp",
  "PWrapUpHolding",
  "PDone",
  "PEscalated",
  "PRevoked",
];

const OUTCOMES: readonly TaskOutcome[] = ["TPassed", "TFailed", "TCancelled"];
const COMBINATORS: readonly Combinator[] = ["CUnanimousPass", "CAnyPass"];
const RESUMES: readonly Resume[] = [
  "RNone",
  "RPending",
  "RWorking",
  "REvaluating",
  "RWrapUp",
];
const REASONS: readonly Reason[] = [
  "RsNone",
  "RsWorkFailed",
  "RsReworkBudgetExhausted",
  "RsWrapUpBudgetExhausted",
  "RsGasExhausted",
  "RsRevalidationFailed",
  "RsDependencyRevoked",
];
const VERDICTS: readonly Verdict[] = ["VPass", "VFail"];
const OUTCOMES_WRAPUP: readonly WrapUpOutcome[] = ["WOk", "WFailed"];

const nullary = { "#tup": [] };

function variantTag(value: ItfValue): string {
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "variant"
  ) {
    return value.tag;
  }
  throw new Error(`vocabulary: expected a variant, got ${describe(value)}`);
}

function variantPayload(value: ItfValue): ItfValue {
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.kind === "variant"
  ) {
    return value.value;
  }
  throw new Error(`vocabulary: expected a variant, got ${describe(value)}`);
}

function int(value: ItfValue): number {
  if (typeof value !== "bigint") {
    throw new Error(`vocabulary: expected an integer, got ${describe(value)}`);
  }
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      `vocabulary: ${value.toString()} is outside the exactly representable range`,
    );
  }
  return Number(value);
}

function bool(value: ItfValue): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`vocabulary: expected a boolean, got ${describe(value)}`);
  }
  return value;
}

function list(value: ItfValue): readonly ItfValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`vocabulary: expected a list, got ${describe(value)}`);
  }
  return value;
}

function setElements(value: ItfValue): readonly ItfValue[] {
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "set"
  ) {
    throw new Error(`vocabulary: expected a set, got ${describe(value)}`);
  }
  return value.elements;
}

function mapEntries(
  value: ItfValue,
): readonly (readonly [ItfValue, ItfValue])[] {
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "map"
  ) {
    throw new Error(`vocabulary: expected a map, got ${describe(value)}`);
  }
  return value.entries;
}

function oneOf<T extends string>(
  known: readonly T[],
  tag: string,
  what: string,
): T {
  const found = known.find((k) => k === tag);
  if (found === undefined) {
    throw new Error(`vocabulary: ${tag} is not a ${what}`);
  }
  return found;
}

/** A ticket id, wherever one is written: a map key, a transition, a dependency, a draw. */
export const decodeTicketId = (v: ItfValue): TicketId => asTicketId(int(v));
/** A task id, as a completion event names one. */
export const decodeTaskId = (v: ItfValue): TaskId => asTaskId(int(v));
/** A target project, as an arrival draws one. */
export const decodeProjectId = (v: ItfValue): ProjectId => asProjectId(int(v));
/** The environment's per-attempt choice: the draw at the dequeue and the field it is stamped into. */
export const decodeInvalidated = (v: ItfValue): boolean => bool(v);

export const decodePhase = (v: ItfValue): Phase =>
  oneOf(PHASES, variantTag(v), "phase");
export const decodeResume = (v: ItfValue): Resume =>
  oneOf(RESUMES, variantTag(v), "resume");
export const decodeReason = (v: ItfValue): Reason =>
  oneOf(REASONS, variantTag(v), "reason");
export const decodeVerdict = (v: ItfValue): Verdict =>
  oneOf(VERDICTS, variantTag(v), "verdict");
export const decodeWrapUpOutcome = (v: ItfValue): WrapUpOutcome =>
  oneOf(OUTCOMES_WRAPUP, variantTag(v), "wrap-up outcome");

export function decodeTaskKind(value: ItfValue): TaskKind {
  const tag = variantTag(value);
  if (tag === "TKWork") return tkWork;
  if (tag === "TKEval") return tkEval(int(variantPayload(value)));
  throw new Error(`vocabulary: ${tag} is not a task kind`);
}

export function decodeTaskState(value: ItfValue): TaskState {
  const tag = variantTag(value);
  if (tag === "TSRunning") return tsRunning;
  if (tag === "TSResolved") {
    return tsResolved(
      oneOf(OUTCOMES, variantTag(variantPayload(value)), "task outcome"),
    );
  }
  throw new Error(`vocabulary: ${tag} is not a task state`);
}

export function decodeTask(value: ItfValue): Task {
  return {
    id: decodeTaskId(field(value, "id")),
    kind: decodeTaskKind(field(value, "kind")),
    state: decodeTaskState(field(value, "state")),
  };
}

export function decodeStage(value: ItfValue): Stage {
  return {
    fanout: int(field(value, "fanout")),
    combinator: oneOf(
      COMBINATORS,
      variantTag(field(value, "combinator")),
      "combinator",
    ),
  };
}

/** A dependency set, ascending: the model's set carries no order and every fold here does. */
export function decodeDeps(value: ItfValue): readonly TicketId[] {
  return setElements(value)
    .map(decodeTicketId)
    .sort((a, b) => a - b);
}

/** An authored eval program: stages in the order the interpreter walks them. */
export function decodeProgram(value: ItfValue): readonly Stage[] {
  return list(value).map(decodeStage);
}

export function decodeWrapUp(value: ItfValue): WrapUp {
  const tag = variantTag(value);
  if (tag === "WNone") return wNone;
  if (tag === "WExclusive") return wExclusive(int(variantPayload(value)));
  throw new Error(`vocabulary: ${tag} is not a wrap-up`);
}

export function decodeArtifact(value: ItfValue): ArtifactMark {
  const tag = variantTag(value);
  if (tag === "ANone") return aNone;
  if (tag === "ASome") return aSome(int(variantPayload(value)));
  throw new Error(`vocabulary: ${tag} is not an artifact mark`);
}

export function decodeWrapUpObs(value: ItfValue): WrapUpObs {
  const tag = variantTag(value);
  if (tag === "WONone") return woNone;
  if (tag === "WOAttempt") {
    const payload = variantPayload(value);
    return woAttempt(
      decodeProjectId(field(payload, "project")),
      decodeInvalidated(field(payload, "invalidated")),
    );
  }
  throw new Error(`vocabulary: ${tag} is not a wrap-up attempt observation`);
}

/**
 * A ticket, with the model's `completions` ghost read and discarded. It is
 * checked against the reconstruction rather than dropped silently, so the
 * decision not to store it stays a claim this boundary tests.
 */
export function decodeTicket(value: ItfValue): Ticket {
  const ticket: Ticket = {
    phase: decodePhase(field(value, "phase")),
    deps: decodeDeps(field(value, "deps")),
    wrapUp: decodeWrapUp(field(value, "wrapUp")),
    artifact: decodeArtifact(field(value, "artifact")),
    project: decodeProjectId(field(value, "project")),
    program: decodeProgram(field(value, "program")),
    tasks: setElements(field(value, "tasks"))
      .map(decodeTask)
      .sort((a, b) => a.id - b.id),
    record: list(field(value, "record")).map(decodeTask),
    spawned: int(field(value, "spawned")),
    reworkLeft: int(field(value, "reworkLeft")),
    wrapUpLeft: int(field(value, "wrapUpLeft")),
    gasLeft: int(field(value, "gasLeft")),
    resumeAt: decodeResume(field(value, "resumeAt")),
    reason: decodeReason(field(value, "reason")),
  };
  const stored = int(field(value, "completions"));
  const derived = completionsOf(ticket);
  if (stored !== derived) {
    throw new Error(
      `vocabulary: the trace stores completions ${String(stored)} where the phase derives ${String(derived)}; the ghost is not derivable after all`,
    );
  }
  return ticket;
}

export function decodeCore(value: ItfValue): Core {
  const tickets = new Map<TicketId, Ticket>();
  for (const [key, ticket] of mapEntries(value)) {
    tickets.set(decodeTicketId(key), decodeTicket(ticket));
  }
  return { tickets };
}

export function decodeTransition(value: ItfValue): Transition {
  return {
    ticket: decodeTicketId(field(value, "ticket")),
    from: decodePhase(field(value, "from")),
    to: decodePhase(field(value, "to")),
  };
}

export function decodeStepRecord(value: ItfValue): StepRecord {
  const label = field(value, "label");
  if (typeof label !== "string") {
    throw new Error(
      `vocabulary: a step label must be a string, got ${describe(label)}`,
    );
  }
  return {
    label,
    transitions: list(field(value, "transitions")).map(decodeTransition),
    effects: list(field(value, "effects")).map((e) => {
      if (typeof e !== "string") {
        throw new Error(
          `vocabulary: an effect must be a string, got ${describe(e)}`,
        );
      }
      return effectFromLabel(e);
    }),
    attempt: decodeWrapUpObs(field(value, "attempt")),
  };
}

function tagged(tag: string, value: unknown = nullary): unknown {
  return { tag, value };
}

/** Re-encodes an integer as ITF writes one. Ids, accounts and draws all pass through here. */
export function encodeInt(value: number): unknown {
  return { "#bigint": String(value) };
}

/**
 * Wraps an already-encoded value in the option tagging `--mbt` writes around a
 * nondet pick. `undefined` is the draw the action does not make, and is `None`.
 */
export function encodeOption(encoded: unknown): unknown {
  return encoded === undefined ? tagged("None") : tagged("Some", encoded);
}

function encodeTaskKind(kind: TaskKind): unknown {
  return kind.kind === "TKWork"
    ? tagged("TKWork")
    : tagged("TKEval", encodeInt(kind.stage));
}

function encodeTaskState(state: TaskState): unknown {
  return state.state === "TSRunning"
    ? tagged("TSRunning")
    : tagged("TSResolved", tagged(state.outcome));
}

function encodeTask(task: Task): unknown {
  return {
    id: encodeInt(task.id),
    kind: encodeTaskKind(task.kind),
    state: encodeTaskState(task.state),
  };
}

/** Re-encodes a wrap-up kind, as a ticket field and as an arrival's fourth draw. */
export function encodeWrapUp(wrapUp: WrapUp): unknown {
  return wrapUp.wrapUp === "WNone"
    ? tagged("WNone")
    : tagged("WExclusive", encodeInt(wrapUp.resource));
}

function encodeArtifact(artifact: ArtifactMark): unknown {
  return artifact.artifact === "ANone"
    ? tagged("ANone")
    : tagged("ASome", encodeInt(artifact.mark));
}

/** Re-encodes a dependency set, in the ascending order the decoded form keeps. */
export function encodeDeps(deps: readonly TicketId[]): unknown {
  return { "#set": deps.map((d) => encodeInt(d)) };
}

/** Re-encodes an authored program, stages in the order the interpreter walks them. */
export function encodeProgram(program: readonly Stage[]): unknown {
  return program.map((s) => ({
    combinator: tagged(s.combinator),
    fanout: encodeInt(s.fanout),
  }));
}

/** Re-encodes a task-completion verdict, which only a draw ever carries. */
export function encodeVerdict(verdict: Verdict): unknown {
  return tagged(verdict);
}

/** Re-encodes a wrap-up outcome, which only a draw ever carries. */
export function encodeWrapUpOutcome(outcome: WrapUpOutcome): unknown {
  return tagged(outcome);
}

/** Re-encodes a ticket, reconstructing the `completions` ghost the record does not store. */
export function encodeTicket(ticket: Ticket): unknown {
  return {
    artifact: encodeArtifact(ticket.artifact),
    completions: encodeInt(completionsOf(ticket)),
    deps: encodeDeps(ticket.deps),
    gasLeft: encodeInt(ticket.gasLeft),
    phase: tagged(ticket.phase),
    program: encodeProgram(ticket.program),
    project: encodeInt(ticket.project),
    reason: tagged(ticket.reason),
    record: ticket.record.map(encodeTask),
    resumeAt: tagged(ticket.resumeAt),
    reworkLeft: encodeInt(ticket.reworkLeft),
    spawned: encodeInt(ticket.spawned),
    tasks: { "#set": ticket.tasks.map(encodeTask) },
    wrapUp: encodeWrapUp(ticket.wrapUp),
    wrapUpLeft: encodeInt(ticket.wrapUpLeft),
  };
}

/** Re-encodes a core's ticket map, in ascending id order. */
export function encodeCore(core: Core): unknown {
  const ids = [...core.tickets.keys()].sort((a, b) => a - b);
  return {
    "#map": ids.map((id) => {
      const ticket = core.tickets.get(id);
      if (ticket === undefined) {
        throw new Error(
          `vocabulary: ticket ${String(id)} vanished between keys and lookup`,
        );
      }
      return [encodeInt(id), encodeTicket(ticket)];
    }),
  };
}

/** Re-encodes a step record, rendering each effect back to the string the model emits. */
export function encodeStepRecord(record: StepRecord): unknown {
  return {
    attempt:
      record.attempt.attempt === "WONone"
        ? tagged("WONone")
        : tagged("WOAttempt", {
            invalidated: record.attempt.invalidated,
            project: encodeInt(record.attempt.project),
          }),
    effects: record.effects.map(effectLabel),
    label: record.label,
    transitions: record.transitions.map((t) => ({
      from: tagged(t.from),
      ticket: encodeInt(t.ticket),
      to: tagged(t.to),
    })),
  };
}
