/**
 * STRUCTURAL COMPARISON of the two values a replayed step must reproduce: the
 * `StepRecord` the decider returned and the `Core` it left behind.
 *
 * WHY NOT A DEEP-EQUALITY HELPER. Two reasons, and the second is the one that
 * decided it. A deep equality over a `Map` or a `Set` is a promise about the
 * comparer's treatment of insertion order, and the ITF documents these values
 * are compared against carry no order at all — sets and maps are compared as
 * sets and maps here, elementwise only where the model's own type is a `List`.
 * And a boolean answer is not a gate's output: when a replay disagrees with the
 * model, the useful sentence names the field, so every function below returns
 * the FIRST difference as a path and the two values at it, or nothing.
 *
 * THE PATHS ARE THE MODEL'S FIELD NAMES, so a finding can be read straight
 * against `model/measure.qnt`'s records.
 */

import { assertNever } from "../domain/assert.ts";
import type {
  ArtifactMark,
  Core,
  StepRecord,
  Task,
  TaskKind,
  TaskState,
  Ticket,
  Transition,
  WrapUp,
  WrapUpObs,
} from "../domain/measure.ts";

/** The first difference between two step records, or nothing when they agree. */
export function diffStepRecord(
  expected: StepRecord,
  actual: StepRecord,
  at: string,
): string | undefined {
  return (
    scalar(expected.label, actual.label, `${at}.label`) ??
    list(
      expected.transitions,
      actual.transitions,
      `${at}.transitions`,
      diffTransition,
    ) ??
    list(expected.effects, actual.effects, `${at}.effects`, scalar) ??
    diffLanding(expected.landing, actual.landing, `${at}.landing`)
  );
}

/** The first difference between two fleets, or nothing when they agree. */
export function diffCore(
  expected: Core,
  actual: Core,
  at: string,
): string | undefined {
  const missing = [...expected.tickets.keys()].filter(
    (j) => !actual.tickets.has(j),
  );
  const extra = [...actual.tickets.keys()].filter(
    (j) => !expected.tickets.has(j),
  );
  if (missing.length > 0 || extra.length > 0) {
    return `${at}.tickets: expected ids [${missing.join(", ")}] are absent, unexpected ids [${extra.join(", ")}] are present`;
  }
  for (const [j, want] of expected.tickets) {
    const got = actual.tickets.get(j);
    if (got === undefined) {
      return `${at}.tickets[${String(j)}]: absent`;
    }
    const difference = diffTicket(want, got, `${at}.tickets[${String(j)}]`);
    if (difference !== undefined) {
      return difference;
    }
  }
  return undefined;
}

/** The first difference between two per-ticket record snapshots — the ghost. */
export function diffRecords(
  expected: ReadonlyMap<number, readonly Task[]>,
  actual: ReadonlyMap<number, readonly Task[]>,
  at: string,
): string | undefined {
  const missing = [...expected.keys()].filter((j) => !actual.has(j));
  const extra = [...actual.keys()].filter((j) => !expected.has(j));
  if (missing.length > 0 || extra.length > 0) {
    return `${at}: expected ids [${missing.join(", ")}] are absent, unexpected ids [${extra.join(", ")}] are present`;
  }
  for (const [j, want] of expected) {
    const got = actual.get(j) ?? [];
    const difference = list(want, got, `${at}[${String(j)}]`, diffTask);
    if (difference !== undefined) {
      return difference;
    }
  }
  return undefined;
}

function diffTicket(
  expected: Ticket,
  actual: Ticket,
  at: string,
): string | undefined {
  return (
    scalar(expected.phase, actual.phase, `${at}.phase`) ??
    intSet(expected.deps, actual.deps, `${at}.deps`) ??
    diffWrapUp(expected.wrapUp, actual.wrapUp, `${at}.wrapUp`) ??
    diffArtifact(expected.artifact, actual.artifact, `${at}.artifact`) ??
    scalar(expected.project, actual.project, `${at}.project`) ??
    list(expected.program, actual.program, `${at}.program`, diffStage) ??
    list(expected.tasks, actual.tasks, `${at}.tasks`, diffTask) ??
    list(expected.record, actual.record, `${at}.record`, diffTask) ??
    scalar(expected.spawned, actual.spawned, `${at}.spawned`) ??
    scalar(expected.reworkLeft, actual.reworkLeft, `${at}.reworkLeft`) ??
    scalar(expected.wrapUpLeft, actual.wrapUpLeft, `${at}.wrapUpLeft`) ??
    scalar(expected.gasLeft, actual.gasLeft, `${at}.gasLeft`) ??
    scalar(expected.resumeAt, actual.resumeAt, `${at}.resumeAt`) ??
    scalar(expected.reason, actual.reason, `${at}.reason`) ??
    scalar(expected.completions, actual.completions, `${at}.completions`)
  );
}

function diffTransition(
  expected: Transition,
  actual: Transition,
  at: string,
): string | undefined {
  return (
    scalar(expected.ticket, actual.ticket, `${at}.ticket`) ??
    scalar(expected.from, actual.from, `${at}.from`) ??
    scalar(expected.to, actual.to, `${at}.to`)
  );
}

function diffTask(
  expected: Task,
  actual: Task,
  at: string,
): string | undefined {
  return (
    scalar(expected.id, actual.id, `${at}.id`) ??
    diffTaskKind(expected.kind, actual.kind, `${at}.kind`) ??
    diffTaskState(expected.state, actual.state, `${at}.state`)
  );
}

function diffTaskKind(
  expected: TaskKind,
  actual: TaskKind,
  at: string,
): string | undefined {
  if (expected.tag !== actual.tag) {
    return difference(at, expected.tag, actual.tag);
  }
  switch (expected.tag) {
    case "TKWork":
      return undefined;
    case "TKEval":
      return actual.tag === "TKEval"
        ? scalar(expected.stage, actual.stage, `${at}.stage`)
        : difference(at, expected.tag, actual.tag);
    default:
      return assertNever(expected, "unhandled TaskKind");
  }
}

function diffTaskState(
  expected: TaskState,
  actual: TaskState,
  at: string,
): string | undefined {
  if (expected.tag !== actual.tag) {
    return difference(at, expected.tag, actual.tag);
  }
  switch (expected.tag) {
    case "TSRunning":
      return undefined;
    case "TSResolved":
      return actual.tag === "TSResolved"
        ? scalar(expected.outcome, actual.outcome, `${at}.outcome`)
        : difference(at, expected.tag, actual.tag);
    default:
      return assertNever(expected, "unhandled TaskState");
  }
}

function diffStage(
  expected: { readonly fanout: number; readonly combinator: string },
  actual: { readonly fanout: number; readonly combinator: string },
  at: string,
): string | undefined {
  return (
    scalar(expected.fanout, actual.fanout, `${at}.fanout`) ??
    scalar(expected.combinator, actual.combinator, `${at}.combinator`)
  );
}

function diffWrapUp(
  expected: WrapUp,
  actual: WrapUp,
  at: string,
): string | undefined {
  if (expected.tag !== actual.tag) {
    return difference(at, expected.tag, actual.tag);
  }
  switch (expected.tag) {
    case "WNone":
      return undefined;
    case "WExclusive":
      return actual.tag === "WExclusive"
        ? scalar(expected.resource, actual.resource, `${at}.resource`)
        : difference(at, expected.tag, actual.tag);
    default:
      return assertNever(expected, "unhandled WrapUp");
  }
}

function diffArtifact(
  expected: ArtifactMark,
  actual: ArtifactMark,
  at: string,
): string | undefined {
  if (expected.tag !== actual.tag) {
    return difference(at, expected.tag, actual.tag);
  }
  switch (expected.tag) {
    case "ANone":
      return undefined;
    case "ASome":
      return actual.tag === "ASome"
        ? scalar(expected.id, actual.id, `${at}.id`)
        : difference(at, expected.tag, actual.tag);
    default:
      return assertNever(expected, "unhandled ArtifactMark");
  }
}

function diffLanding(
  expected: WrapUpObs,
  actual: WrapUpObs,
  at: string,
): string | undefined {
  if (expected.tag !== actual.tag) {
    return difference(at, expected.tag, actual.tag);
  }
  switch (expected.tag) {
    case "WONone":
      return undefined;
    case "WOAttempt":
      return actual.tag === "WOAttempt"
        ? (scalar(expected.project, actual.project, `${at}.project`) ??
            scalar(
              expected.invalidated,
              actual.invalidated,
              `${at}.invalidated`,
            ))
        : difference(at, expected.tag, actual.tag);
    default:
      return assertNever(expected, "unhandled WrapUpObs");
  }
}

/** A `List[T]`: length first, then elementwise — the model's own order. */
function list<T>(
  expected: readonly T[],
  actual: readonly T[],
  at: string,
  each: (a: T, b: T, at: string) => string | undefined,
): string | undefined {
  if (expected.length !== actual.length) {
    return `${at}: expected ${String(expected.length)} entries, got ${String(actual.length)}`;
  }
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i];
    const got = actual[i];
    if (want === undefined || got === undefined) {
      return `${at}[${String(i)}]: absent`;
    }
    const difference = each(want, got, `${at}[${String(i)}]`);
    if (difference !== undefined) {
      return difference;
    }
  }
  return undefined;
}

/** A `Set[int]`, compared as a set: membership both ways, never order. */
function intSet(
  expected: ReadonlySet<number>,
  actual: ReadonlySet<number>,
  at: string,
): string | undefined {
  const missing = [...expected].filter((x) => !actual.has(x));
  const extra = [...actual].filter((x) => !expected.has(x));
  if (missing.length > 0 || extra.length > 0) {
    return `${at}: expected members [${missing.join(", ")}] are absent, unexpected members [${extra.join(", ")}] are present`;
  }
  return undefined;
}

function scalar<T extends string | number | boolean>(
  expected: T,
  actual: T,
  at: string,
): string | undefined {
  return expected === actual ? undefined : difference(at, expected, actual);
}

function difference(
  at: string,
  expected: string | number | boolean,
  actual: string | number | boolean,
): string {
  return `${at}: expected ${String(expected)}, got ${String(actual)}`;
}
