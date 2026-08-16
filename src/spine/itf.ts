/**
 * THE ITF DECODER: an Informal Trace Format document, as `quint run --out-itf`
 * and `quint test --out-itf` write it, into this tree's domain values.
 *
 * WHAT ARRIVES, in the shapes quint 0.32.0 emits: a document of `#meta`, `vars`
 * and `states`; an int as `{"#bigint": "…"}`; a set as `{"#set": […]}`; a map as
 * `{"#map": [[k, v], …]}`; a sum-type value as `{tag, value}`, a nullary
 * constructor's payload being the empty tuple `{"#tup": []}`; a record as a
 * plain object; a list as a JSON array. Under `--mbt` every state gains
 * `mbt::actionTaken` and `mbt::nondetPicks`, the decision event itself.
 *
 * EVERY RECORD IS DECODED AGAINST ITS EXACT FIELD SET, BOTH ENDS. A missing
 * field is an obvious defect; an EXTRA field is the one that matters, and it is
 * why the check is an equality rather than a series of reads. The corpus is
 * regenerated from a model that may gain a `Ticket` field, and a decoder that
 * read the fields it knew would drop the new one silently — the replay would
 * then compare a state it had already thrown half of away, and the spine would
 * report green on a machine it no longer models. The same equality is taken
 * over the trace's own variable roster and over the nondet binders.
 *
 * IT IS TOTAL AND IT NEVER GUESSES. Every failure raises `DecodeError` with the
 * path to the value that failed, because a decode failure is not a replay
 * finding: it means the corpus and this decoder disagree about what a trace IS,
 * which the emitter must resolve and a gate must report as could-not-run.
 *
 * IT READS `#meta` FOR NOTHING. Both `timestamp` and `description` embed the
 * generation time, so a comparison that looked at them would fail on
 * regeneration alone; the block is skipped wholesale rather than partially,
 * which is also why the emitter is free to drop its volatile half from a
 * committed fixture. The `vars` array lists the two `mbt::` entries twice — a
 * 0.32.0 quirk — so the roster is compared as a set.
 */

import type {
  ArtifactMark,
  Core,
  Phase,
  Reason,
  Resume,
  Stage,
  StepRecord,
  Task,
  TaskKind,
  TaskState,
  Ticket,
  Transition,
  Verdict,
  WrapUp,
  WrapUpObs,
  WrapUpOutcome,
} from "../domain/measure.ts";

/** Raised by every decode failure, and by nothing else. */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

function fail(where: string, what: string): never {
  throw new DecodeError(`${where}: ${what}`);
}

// === The ITF value grammar =================================================

function asObject(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(where, `expected an object, got ${describe(v)}`);
  }
  return v as Record<string, unknown>;
}

function describe(v: unknown): string {
  if (v === null) {
    return "null";
  }
  if (Array.isArray(v)) {
    return "an array";
  }
  return typeof v;
}

/**
 * The exact-field-set check every record decode opens with. It reports both
 * halves of the disagreement, because "the model gained a field" and "this
 * decoder is reading a stale name" are different defects and the message is
 * where they are told apart.
 */
function fieldsExactly(
  raw: Record<string, unknown>,
  expected: readonly string[],
  where: string,
): void {
  const got = Object.keys(raw).sort();
  const want = [...expected].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    fail(where, `fields are [${want.join(", ")}], got [${got.join(", ")}]`);
  }
}

function field(
  raw: Record<string, unknown>,
  name: string,
  where: string,
): unknown {
  if (!Object.hasOwn(raw, name)) {
    fail(where, `no field ${name}`);
  }
  return raw[name];
}

/**
 * An ITF integer. Quint writes every int as `{"#bigint": "…"}`; a plain JSON
 * number is accepted too, because the format permits small ints unwrapped and a
 * decoder that refused one would fail on a document that is still an ITF
 * document. Both paths land on the same safe-integer check, which is the one
 * this tree needs: `measure.ts` counts in `number`, and a value outside the
 * safe range would arrive as a different integer than the model wrote.
 */
export function itfInt(v: unknown, where: string): number {
  if (typeof v === "number") {
    return safeInt(v, where);
  }
  const raw = asObject(v, where);
  fieldsExactly(raw, ["#bigint"], where);
  const digits = field(raw, "#bigint", where);
  if (typeof digits !== "string") {
    fail(
      where,
      `#bigint holds its digits as a string, got ${describe(digits)}`,
    );
  }
  if (!/^-?[0-9]+$/.test(digits)) {
    fail(where, `#bigint holds digits, got ${JSON.stringify(digits)}`);
  }
  return safeInt(Number(digits), where);
}

function safeInt(n: number, where: string): number {
  if (!Number.isSafeInteger(n)) {
    fail(where, `${String(n)} is not a safe integer`);
  }
  return n;
}

function itfBool(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") {
    fail(where, `expected a boolean, got ${describe(v)}`);
  }
  return v;
}

function itfString(v: unknown, where: string): string {
  if (typeof v !== "string") {
    fail(where, `expected a string, got ${describe(v)}`);
  }
  return v;
}

function itfList(v: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(v)) {
    fail(where, `expected a list, got ${describe(v)}`);
  }
  return v;
}

/** `{"#set": […]}` — the elements in whatever order the writer had. */
function itfSet(v: unknown, where: string): readonly unknown[] {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["#set"], where);
  return itfList(field(raw, "#set", where), where);
}

/** `{"#map": [[k, v], …]}` — likewise unordered. */
function itfMap(
  v: unknown,
  where: string,
): readonly (readonly [unknown, unknown])[] {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["#map"], where);
  return itfList(field(raw, "#map", where), where).map((entry, i) => {
    const pair = itfList(entry, `${where}[${String(i)}]`);
    if (pair.length !== 2) {
      fail(`${where}[${String(i)}]`, "a map entry is a key and a value");
    }
    return [pair[0], pair[1]] as const;
  });
}

/**
 * A sum-type value. The payload of a nullary constructor is the empty tuple,
 * which is checked rather than ignored: `{tag: "PDraft", value: 7}` is a
 * document this decoder should refuse rather than read past.
 */
function itfTagged(v: unknown, where: string): [string, unknown] {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["tag", "value"], where);
  return [
    itfString(field(raw, "tag", where), where),
    field(raw, "value", where),
  ];
}

function nullary(value: unknown, tag: string, where: string): void {
  const raw = asObject(value, `${where}.${tag}`);
  fieldsExactly(raw, ["#tup"], `${where}.${tag}`);
  if (itfList(field(raw, "#tup", where), where).length !== 0) {
    fail(`${where}.${tag}`, "a nullary constructor carries the empty tuple");
  }
}

/** A sum-type value whose constructors are all nullary — encoding decision 1. */
function itfEnum<T extends string>(
  v: unknown,
  members: readonly T[],
  where: string,
): T {
  const [tag, value] = itfTagged(v, where);
  const member = members.find((m) => m === tag);
  if (member === undefined) {
    fail(where, `${tag} is outside [${members.join(", ")}]`);
  }
  nullary(value, tag, where);
  return member;
}

// === The domain vocabulary =================================================
// One decoder per `model/measure.qnt` type, in that file's declaration order.
// Each roster is the model's own constructor list, so a constructor added
// upstream arrives here as a decode failure naming it.

const phases: readonly Phase[] = [
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

function decodePhase(v: unknown, where: string): Phase {
  return itfEnum(v, phases, where);
}

function decodeTaskKind(v: unknown, where: string): TaskKind {
  const [tag, value] = itfTagged(v, where);
  switch (tag) {
    case "TKWork":
      nullary(value, tag, where);
      return { tag: "TKWork" };
    case "TKEval":
      return { tag: "TKEval", stage: itfInt(value, `${where}.stage`) };
    default:
      return fail(where, `${tag} is not a TaskKind`);
  }
}

function decodeTaskState(v: unknown, where: string): TaskState {
  const [tag, value] = itfTagged(v, where);
  switch (tag) {
    case "TSRunning":
      nullary(value, tag, where);
      return { tag: "TSRunning" };
    case "TSResolved":
      return {
        tag: "TSResolved",
        outcome: itfEnum(
          value,
          ["TPassed", "TFailed", "TCancelled"],
          `${where}.outcome`,
        ),
      };
    default:
      return fail(where, `${tag} is not a TaskState`);
  }
}

function decodeTask(v: unknown, where: string): Task {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["id", "kind", "state"], where);
  return {
    id: itfInt(field(raw, "id", where), `${where}.id`),
    kind: decodeTaskKind(field(raw, "kind", where), `${where}.kind`),
    state: decodeTaskState(field(raw, "state", where), `${where}.state`),
  };
}

/**
 * The model's `Set[Task]` into `measure.ts`'s canonical ascending-id array.
 *
 * THE SORT IS THE ENCODING, AND THE STRICTNESS AFTER IT IS THE CHECK. An ITF
 * set carries no order, so a decoder must impose one to produce the
 * representation this tree compares structurally; ascending id is the order
 * `measure.ts` argues for. Two ids the same would make the sort ambiguous and
 * the length a lie, and it is precisely what `nextTaskId` would then mis-mint,
 * so it is refused here rather than absorbed.
 */
function decodeTaskSet(v: unknown, where: string): readonly Task[] {
  const tasks = itfSet(v, where)
    .map((t, i) => decodeTask(t, `${where}[${String(i)}]`))
    .sort((a, b) => a.id - b.id);
  tasks.forEach((t, i) => {
    const previous = tasks[i - 1];
    if (previous !== undefined && previous.id === t.id) {
      fail(where, `two tasks share id ${String(t.id)}`);
    }
  });
  return tasks;
}

function decodeTaskList(v: unknown, where: string): readonly Task[] {
  return itfList(v, where).map((t, i) =>
    decodeTask(t, `${where}[${String(i)}]`),
  );
}

export function decodeVerdict(v: unknown, where: string): Verdict {
  return itfEnum(v, ["VPass", "VFail"], where);
}

export function decodeStage(v: unknown, where: string): Stage {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["fanout", "combinator"], where);
  return {
    fanout: itfInt(field(raw, "fanout", where), `${where}.fanout`),
    combinator: itfEnum(
      field(raw, "combinator", where),
      ["CUnanimousPass", "CAnyPass"],
      `${where}.combinator`,
    ),
  };
}

export function decodeProgram(v: unknown, where: string): readonly Stage[] {
  return itfList(v, where).map((s, i) =>
    decodeStage(s, `${where}[${String(i)}]`),
  );
}

function decodeResume(v: unknown, where: string): Resume {
  return itfEnum(
    v,
    ["RNone", "RPending", "RWorking", "REvaluating", "RWrapUp"],
    where,
  );
}

function decodeReason(v: unknown, where: string): Reason {
  return itfEnum(
    v,
    [
      "RsNone",
      "RsWorkFailed",
      "RsReworkBudgetExhausted",
      "RsWrapUpBudgetExhausted",
      "RsGasExhausted",
      "RsRevalidationFailed",
      "RsDependencyRevoked",
    ],
    where,
  );
}

export function decodeWrapUpOutcome(v: unknown, where: string): WrapUpOutcome {
  return itfEnum(v, ["WOk", "WFailed"], where);
}

function decodeWrapUpObs(v: unknown, where: string): WrapUpObs {
  const [tag, value] = itfTagged(v, where);
  switch (tag) {
    case "WONone":
      nullary(value, tag, where);
      return { tag: "WONone" };
    case "WOAttempt": {
      const raw = asObject(value, where);
      fieldsExactly(raw, ["project", "invalidated"], where);
      return {
        tag: "WOAttempt",
        project: itfInt(field(raw, "project", where), `${where}.project`),
        invalidated: itfBool(
          field(raw, "invalidated", where),
          `${where}.invalidated`,
        ),
      };
    }
    default:
      return fail(where, `${tag} is not a WrapUpObs`);
  }
}

export function decodeWrapUp(v: unknown, where: string): WrapUp {
  const [tag, value] = itfTagged(v, where);
  switch (tag) {
    case "WNone":
      nullary(value, tag, where);
      return { tag: "WNone" };
    case "WExclusive":
      return {
        tag: "WExclusive",
        resource: itfInt(value, `${where}.resource`),
      };
    default:
      return fail(where, `${tag} is not a WrapUp`);
  }
}

function decodeArtifactMark(v: unknown, where: string): ArtifactMark {
  const [tag, value] = itfTagged(v, where);
  switch (tag) {
    case "ANone":
      nullary(value, tag, where);
      return { tag: "ANone" };
    case "ASome":
      return { tag: "ASome", id: itfInt(value, `${where}.id`) };
    default:
      return fail(where, `${tag} is not an ArtifactMark`);
  }
}

export function decodeIntSet(v: unknown, where: string): ReadonlySet<number> {
  const out = new Set<number>();
  itfSet(v, where).forEach((x, i) => {
    out.add(itfInt(x, `${where}[${String(i)}]`));
  });
  return out;
}

function decodeTicket(v: unknown, where: string): Ticket {
  const raw = asObject(v, where);
  fieldsExactly(
    raw,
    [
      "phase",
      "deps",
      "wrapUp",
      "artifact",
      "project",
      "program",
      "tasks",
      "record",
      "spawned",
      "reworkLeft",
      "wrapUpLeft",
      "gasLeft",
      "resumeAt",
      "reason",
      "completions",
    ],
    where,
  );
  return {
    phase: decodePhase(field(raw, "phase", where), `${where}.phase`),
    deps: decodeIntSet(field(raw, "deps", where), `${where}.deps`),
    wrapUp: decodeWrapUp(field(raw, "wrapUp", where), `${where}.wrapUp`),
    artifact: decodeArtifactMark(
      field(raw, "artifact", where),
      `${where}.artifact`,
    ),
    project: itfInt(field(raw, "project", where), `${where}.project`),
    program: decodeProgram(field(raw, "program", where), `${where}.program`),
    tasks: decodeTaskSet(field(raw, "tasks", where), `${where}.tasks`),
    record: decodeTaskList(field(raw, "record", where), `${where}.record`),
    spawned: itfInt(field(raw, "spawned", where), `${where}.spawned`),
    reworkLeft: itfInt(field(raw, "reworkLeft", where), `${where}.reworkLeft`),
    wrapUpLeft: itfInt(field(raw, "wrapUpLeft", where), `${where}.wrapUpLeft`),
    gasLeft: itfInt(field(raw, "gasLeft", where), `${where}.gasLeft`),
    resumeAt: decodeResume(field(raw, "resumeAt", where), `${where}.resumeAt`),
    reason: decodeReason(field(raw, "reason", where), `${where}.reason`),
    completions: itfInt(
      field(raw, "completions", where),
      `${where}.completions`,
    ),
  };
}

function decodeCore(v: unknown, where: string): Core {
  const tickets = new Map<number, Ticket>();
  itfMap(v, where).forEach(([key, value], i) => {
    const at = `${where}[${String(i)}]`;
    const id = itfInt(key, `${at}.key`);
    if (tickets.has(id)) {
      fail(where, `two entries for ticket ${String(id)}`);
    }
    tickets.set(id, decodeTicket(value, `${at}.value`));
  });
  return { tickets };
}

function decodeTransition(v: unknown, where: string): Transition {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["ticket", "from", "to"], where);
  return {
    ticket: itfInt(field(raw, "ticket", where), `${where}.ticket`),
    from: decodePhase(field(raw, "from", where), `${where}.from`),
    to: decodePhase(field(raw, "to", where), `${where}.to`),
  };
}

function decodeStepRecord(v: unknown, where: string): StepRecord {
  const raw = asObject(v, where);
  fieldsExactly(raw, ["label", "transitions", "effects", "landing"], where);
  return {
    label: itfString(field(raw, "label", where), `${where}.label`),
    transitions: itfList(
      field(raw, "transitions", where),
      `${where}.transitions`,
    ).map((t, i) => decodeTransition(t, `${where}.transitions[${String(i)}]`)),
    effects: itfList(field(raw, "effects", where), `${where}.effects`).map(
      (e, i) => itfString(e, `${where}.effects[${String(i)}]`),
    ),
    landing: decodeWrapUpObs(field(raw, "landing", where), `${where}.landing`),
  };
}

function decodeRecordsGhost(
  v: unknown,
  where: string,
): ReadonlyMap<number, readonly Task[]> {
  const snapshot = new Map<number, readonly Task[]>();
  itfMap(v, where).forEach(([key, value], i) => {
    const at = `${where}[${String(i)}]`;
    const id = itfInt(key, `${at}.key`);
    if (snapshot.has(id)) {
      fail(where, `two entries for ticket ${String(id)}`);
    }
    snapshot.set(id, decodeTaskList(value, `${at}.value`));
  });
  return snapshot;
}

// === The trace =============================================================

/**
 * The model's nondet binders, by the name the action binds and the field it
 * becomes here. The roster is `model/domain.qnt`'s thirteen actions' draws,
 * and it is asked as an equality: a binder this tree does not know is a draw
 * the machine gained, which is a decision event this vocabulary cannot carry.
 */
const binders = [
  ["deps_", "deps"],
  ["prog", "program"],
  ["project_", "project"],
  ["wrapUp_", "wrapUp"],
  ["j", "ticket"],
  ["tid", "tid"],
  ["v", "verdict"],
  ["moved", "moved"],
  ["out", "out"],
] as const;

/** One action's drawn picks, each present exactly when the trace bound it. */
export type Picks = {
  readonly deps?: ReadonlySet<number>;
  readonly program?: readonly Stage[];
  readonly project?: number;
  readonly wrapUp?: WrapUp;
  readonly ticket?: number;
  readonly tid?: number;
  readonly verdict?: Verdict;
  readonly moved?: boolean;
  readonly out?: WrapUpOutcome;
};

/** One trace state: the machine's four vars, plus the decision event if any. */
export type DecodedState = {
  readonly core: Core;
  readonly lastStep: StepRecord;
  readonly prevMeasure: number;
  readonly prevRecords: ReadonlyMap<number, readonly Task[]>;
  readonly action?: string;
  readonly picks?: Picks;
};

/**
 * A decoded trace. `hasDecisionEvents` is the TIER: `--mbt` supplies the action
 * and its picks natively, and a trace without them is reconstructed instead.
 */
export type DecodedTrace = {
  readonly hasDecisionEvents: boolean;
  readonly states: readonly DecodedState[];
};

const ACTION_TAKEN = "mbt::actionTaken";
const NONDET_PICKS = "mbt::nondetPicks";

/**
 * Resolve one of the machine's vars in a state whose keys are namespaced by the
 * main module and the domain instance (`mc_chuggy_budgeted::chuggy_domain::…`).
 * Exactly one key may end in the var's name — a second would mean two domain
 * instances in one trace, which nothing downstream could attribute.
 */
function varKey(keys: readonly string[], name: string, where: string): string {
  const matches = keys.filter((k) => k === name || k.endsWith(`::${name}`));
  const only = matches[0];
  if (only === undefined || matches.length !== 1) {
    fail(
      where,
      `expected exactly one var named ${name}, got ${String(matches.length)}`,
    );
  }
  return only;
}

function decodePicks(v: unknown, where: string): Picks {
  const raw = asObject(v, where);
  fieldsExactly(
    raw,
    binders.map(([bound]) => bound),
    where,
  );
  const picks: {
    deps?: ReadonlySet<number>;
    program?: readonly Stage[];
    project?: number;
    wrapUp?: WrapUp;
    ticket?: number;
    tid?: number;
    verdict?: Verdict;
    moved?: boolean;
    out?: WrapUpOutcome;
  } = {};
  for (const [bound, as] of binders) {
    const at = `${where}.${bound}`;
    const [tag, value] = itfTagged(field(raw, bound, where), at);
    if (tag === "None") {
      nullary(value, tag, at);
      continue;
    }
    if (tag !== "Some") {
      fail(at, `a pick is Some or None, got ${tag}`);
    }
    switch (as) {
      case "deps":
        picks.deps = decodeIntSet(value, at);
        break;
      case "program":
        picks.program = decodeProgram(value, at);
        break;
      case "project":
        picks.project = itfInt(value, at);
        break;
      case "wrapUp":
        picks.wrapUp = decodeWrapUp(value, at);
        break;
      case "ticket":
        picks.ticket = itfInt(value, at);
        break;
      case "tid":
        picks.tid = itfInt(value, at);
        break;
      case "verdict":
        picks.verdict = decodeVerdict(value, at);
        break;
      case "moved":
        picks.moved = itfBool(value, at);
        break;
      case "out":
        picks.out = decodeWrapUpOutcome(value, at);
        break;
      default:
        fail(at, "unhandled binder");
    }
  }
  return picks;
}

/**
 * Decode a parsed ITF document. The `vars` roster is checked as a SET against
 * what the states carry, which is what tolerates 0.32.0 listing the two `mbt::`
 * entries twice, and the state index is checked to be dense and ascending so a
 * fixture cannot silently lose a step.
 */
export function decodeTrace(raw: unknown, where = "trace"): DecodedTrace {
  const doc = asObject(raw, where);
  const declared = new Set(
    itfList(field(doc, "vars", where), `${where}.vars`).map((v, i) =>
      itfString(v, `${where}.vars[${String(i)}]`),
    ),
  );
  const hasDecisionEvents =
    declared.has(ACTION_TAKEN) && declared.has(NONDET_PICKS);
  const states = itfList(field(doc, "states", where), `${where}.states`);
  if (states.length === 0) {
    fail(where, "a trace holds at least the initial state");
  }
  return {
    hasDecisionEvents,
    states: states.map((s, i) =>
      decodeState(
        s,
        declared,
        hasDecisionEvents,
        i,
        `${where}.states[${String(i)}]`,
      ),
    ),
  };
}

function decodeState(
  v: unknown,
  declared: ReadonlySet<string>,
  hasDecisionEvents: boolean,
  index: number,
  where: string,
): DecodedState {
  const raw = asObject(v, where);
  const keys = Object.keys(raw).filter((k) => k !== "#meta");
  const expected = new Set(declared);
  if (
    keys.length !== expected.size ||
    keys.some((k) => !expected.has(k)) ||
    [...expected].some((k) => !keys.includes(k))
  ) {
    fail(
      where,
      `the state's vars are [${[...expected].sort().join(", ")}], got [${keys.sort().join(", ")}]`,
    );
  }
  checkIndex(raw, index, where);

  const core = decodeCore(
    field(raw, varKey(keys, "tickets", where), where),
    `${where}.tickets`,
  );
  const state: DecodedState = {
    core,
    lastStep: decodeStepRecord(
      field(raw, varKey(keys, "lastStep", where), where),
      `${where}.lastStep`,
    ),
    prevMeasure: itfInt(
      field(raw, varKey(keys, "prevMeasure", where), where),
      `${where}.prevMeasure`,
    ),
    prevRecords: decodeRecordsGhost(
      field(raw, varKey(keys, "prevRecords", where), where),
      `${where}.prevRecords`,
    ),
  };
  if (!hasDecisionEvents) {
    return state;
  }
  return {
    ...state,
    action: itfString(field(raw, ACTION_TAKEN, where), `${where}.actionTaken`),
    picks: decodePicks(field(raw, NONDET_PICKS, where), `${where}.nondetPicks`),
  };
}

/**
 * The per-state `#meta.index`, when the writer supplied one: it must be this
 * state's position. Quint writes it on every state; checking it is what makes a
 * trace with a state removed a decode failure rather than a shorter run.
 */
function checkIndex(
  raw: Record<string, unknown>,
  index: number,
  where: string,
): void {
  if (!Object.hasOwn(raw, "#meta")) {
    return;
  }
  const meta = asObject(raw["#meta"], `${where}.#meta`);
  if (!Object.hasOwn(meta, "index")) {
    return;
  }
  const written = itfInt(meta["index"], `${where}.#meta.index`);
  if (written !== index) {
    fail(
      `${where}.#meta.index`,
      `state ${String(index)} is indexed ${String(written)}`,
    );
  }
}
