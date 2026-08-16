/**
 * THE JOURNAL ROW, WRITTEN AS A SCHEMA — `model/refinement.qnt`'s `Entry`: a
 * monotone dense sequence number, the decision event that produced the row, and
 * the `StepRecord` that decision performed.
 *
 * WHY THE SCHEMA COMES FIRST AND THE TYPE SECOND. The engineering bar states
 * the reason and it is the only one that matters: the journal is the one
 * artifact that outlives any process. Every other type in this tree is a
 * description of values a running program holds, and can be changed by changing
 * the program. A journal row is a description of bytes some earlier program
 * wrote and some later program must still be able to read, so the row's shape
 * is the durable artifact and the static type is a projection of it. Written
 * the other way round — a TypeScript type, with a validator hand-written beside
 * it — the two are two statements of one fact, and the one that drifts is
 * whichever is not being read at the moment a field changes.
 *
 * SO THERE IS ONE DECLARATION, `entrySchema`, AND THREE THINGS COME OUT OF IT:
 *
 *   - `Entry`, the static type, by a mapped type over the schema's field list.
 *     Adding a field to the schema changes the type with no second edit;
 *     REMOVING one from the type is not expressible at all.
 *   - `entryFieldNames`, the runtime roster, by a map over the same list.
 *   - `hasEntryShape`, the runtime gate, which walks that list and asks each
 *     field's kind for its check.
 *
 * WHAT THE GATE IS FOR, and it is not decoration. `journalLegalOn` is TOTAL —
 * it refuses a tampered journal rather than crashing on one — and that totality
 * is stated over a WELL-TYPED journal. Rows that arrive from a store are not
 * well-typed: a durable store returns what it stored, and TypeScript's
 * knowledge of it ended at the process that wrote it. This gate is the boundary
 * that turns `unknown` into `Entry`, and after it the legality fold's totality
 * is a fact rather than a hope. `actor.ts`'s `recoverFrom` is the consumer.
 *
 * THE CMD IS CHECKED TO ITS VOCABULARY AND THE REC ONLY TO ITS SHAPE, which
 * looks inconsistent and is the point. The cmd is EXECUTED — `cmdEnabled`
 * switches on its tag and the deciders read its payload — so a tag outside the
 * vocabulary reaches `assertNever` and a payload of the wrong kind reaches a
 * decider's own assertion, and both would be the crash the totality rule
 * forbids. The rec is only ever COMPARED: the legality fold re-derives it from
 * the cmd and requires structural equality, so a rec carrying a phase no
 * machine ever emits is REFUSED by that comparison, one layer up, without this
 * file needing a roster of phases that would then have to be kept current.
 * Checking the rec's shape is still necessary, because the comparison walks its
 * fields and a rec whose `transitions` is not an array would crash the walk.
 *
 * NO ROSTER HERE CAN DRIFT FROM `cmd.ts`. The per-constructor field tables are
 * a `Record<CmdTag, ...>`, so a constructor added to or removed from `Cmd` is a
 * compile error in this file rather than a row this file quietly accepts or
 * quietly refuses. That is what makes a second statement of the vocabulary
 * legitimate here: it is not a copy that has to be remembered, it is a copy the
 * compiler maintains.
 *
 * IT IS A SCHEMA OF VALUES, AND THE BYTES ARE SOMEBODY ELSE'S. `Cmd` carries a
 * `Set` of ticket ids, which has no byte form at all, so a row as described here
 * is an in-memory shape and a store that persists to a medium needs a CODEC
 * between the two. That codec belongs ABOVE the port, in the spine, beside this
 * schema — never in the store, which is the component required to interpret
 * nothing. `journal-store.ts` states the same placement from the port's side.
 * It is STILL not shipped, and the reason has moved rather than gone. s6 landed
 * the effect vocabulary this paragraph was waiting on — `src/effects/effect.ts`,
 * whose constructors ARE the strings a `rec` already stores, so that half of a
 * wire format is now fixed and stable. What is not fixed is the need: the only
 * store in this tree keeps values in memory, so nothing here has bytes to
 * write, and a codec with no medium beneath it would be a guess about the
 * medium instead of a guess about the vocabulary. What is fixed is where it
 * goes and that its output is what this gate checks.
 *
 * WHAT THE SCHEMA'S `row` AND `version` ARE, AND ARE NOT. They identify the
 * SCHEMA; no row carries either, because a row is `model/refinement.qnt`'s
 * `Entry` and the model owns its three fields. What they buy is a name a reader
 * can key on and one place a migration begins. What they cost, said plainly
 * rather than discovered later: a row does not carry its version, so a reader
 * cannot tell which schema wrote it — it has to be told, and the natural place
 * to tell it is a header on the LOG rather than a field on every row, which is
 * a thing this port does not have yet and a real store will. And the exact-field
 * gate below makes adding a version field to the row BREAKING: every row written
 * before it would be refused, so that migration must ship a reader that accepts
 * both shapes. That is the bill; it is stated here rather than deferred in
 * silence.
 */

import type { Cmd, CmdTag } from "./cmd.ts";
import type { StepRecord } from "../domain/measure.ts";

// ==========================================================================
// === The schema ===========================================================
// ==========================================================================

/**
 * The kinds a journal row's fields may have, and the type each denotes. This
 * map is the join between the schema and the static type: the mapped type below
 * indexes it, so a kind with no entry here is a compile error rather than a
 * field of type `any`.
 */
type FieldTypes = {
  readonly "sequence-number": number;
  readonly "decision-event": Cmd;
  readonly "step-record": StepRecord;
};

type FieldKind = keyof FieldTypes;

type FieldSpec = { readonly name: string; readonly kind: FieldKind };

type RowSchema = {
  readonly row: string;
  readonly version: number;
  readonly fields: readonly FieldSpec[];
};

/**
 * THE JOURNAL ROW SCHEMA. `model/refinement.qnt`'s `Entry`, field for field and
 * in its order: the seq the legality fold checks is dense and monotone, the
 * decision event replay re-executes, and the record the executor emits.
 *
 * The model's own note on the last two: an implementation may derive `rec` from
 * `cmd` at read time and store only the cmd; both are stored here for the
 * model's reason, that storing both makes their consistency a checked theorem
 * (`journalLegalOn`) rather than a storage convention.
 */
export const entrySchema = {
  row: "chuggy.journal.entry",
  version: 1,
  fields: [
    { name: "seq", kind: "sequence-number" },
    { name: "cmd", kind: "decision-event" },
    { name: "rec", kind: "step-record" },
  ],
} as const satisfies RowSchema;

/** A schema's row type: one property per field, at the type its kind denotes. */
type RowOf<S extends RowSchema> = {
  readonly [F in S["fields"][number] as F["name"]]: FieldTypes[F["kind"]];
};

/**
 * `model/refinement.qnt` Entry — DERIVED from `entrySchema`, never written
 * beside it.
 *
 * `{ seq: number, cmd: Cmd, rec: StepRecord }` is what this evaluates to, and
 * writing that out here instead is precisely the second statement the schema
 * exists to prevent.
 */
export type Entry = RowOf<typeof entrySchema>;

/** The schema's field names, in the schema's order — the runtime projection. */
export const entryFieldNames: readonly string[] = entrySchema.fields.map(
  (field) => field.name,
);

// ==========================================================================
// === The shape gate =======================================================
// ==========================================================================

/** A field of a tagged record: its name, and the check its value must pass. */
type NamedCheck = readonly [name: string, check: (value: unknown) => boolean];

/**
 * Is this an object with exactly these fields, each passing its own check?
 *
 * EXACTLY, in both directions. A missing field is a row an older writer wrote
 * and a reader would have to guess at; an extra one is a field a NEWER writer
 * wrote, which a reader must not silently drop — the row means something this
 * process does not understand, and pretending otherwise is how a journal
 * quietly loses information across a rollback.
 */
function hasFields(value: unknown, fields: readonly NamedCheck[]): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row: Record<string, unknown> = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length) {
    return false;
  }
  for (const [name, check] of fields) {
    if (!Object.hasOwn(row, name) || !check(row[name])) {
      return false;
    }
  }
  return true;
}

/** A tagged union arm: the `tag` field, plus the arm's own fields. */
function tagged(
  value: unknown,
  tag: string,
  fields: readonly NamedCheck[],
): boolean {
  return hasFields(value, [["tag", (v) => v === tag], ...fields]);
}

/** One of several tagged arms. */
function taggedOneOf(
  value: unknown,
  arms: readonly (readonly [string, readonly NamedCheck[]])[],
): boolean {
  return arms.some(([tag, fields]) => tagged(value, tag, fields));
}

/**
 * A ticket, task or project id, and the sequence number too: a safe integer
 * from 1 up. `Number.isSafeInteger` is the whole check — it refuses `NaN`, an
 * infinity, a fraction and anything past 2^53, each of which would otherwise
 * arrive as a number the arithmetic below cannot be trusted with.
 */
function isId(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

function isString(value: unknown): boolean {
  return typeof value === "string";
}

/** One of a closed set of string constants. */
function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

/** `model/measure.qnt` Verdict. */
function isVerdict(value: unknown): boolean {
  return isOneOf(value, ["VPass", "VFail"]);
}

/** `model/measure.qnt` WrapUpOutcome. */
function isWrapUpOutcome(value: unknown): boolean {
  return isOneOf(value, ["WOk", "WFailed"]);
}

/** `model/measure.qnt` WrapUp — the authored wrap-up kind. */
function isWrapUp(value: unknown): boolean {
  return taggedOneOf(value, [
    ["WNone", []],
    ["WExclusive", [["resource", isId]]],
  ]);
}

/** `model/measure.qnt` Stage — one stage of an authored eval program. */
function isStage(value: unknown): boolean {
  return hasFields(value, [
    ["fanout", isId],
    ["combinator", (v) => isOneOf(v, ["CUnanimousPass", "CAnyPass"])],
  ]);
}

/** An authored program: a list of stages. Emptiness is `isValidProgram`'s to refuse. */
function isProgram(value: unknown): boolean {
  return Array.isArray(value) && value.every(isStage);
}

/**
 * An arrival's dep set. It is a `Set` rather than an array because that is what
 * `Cmd` declares and what `cmdEnabled` iterates; a row whose deps arrived as an
 * array would crash that iteration, which is the crash this gate exists to
 * prevent. It is also the field that shows this schema to be one of VALUES:
 * reconstructing a `Set` from whatever a medium stored is the codec's business,
 * above the port and beside this file (see the header), and it must have
 * happened before the row reaches here.
 */
function isTicketIdSet(value: unknown): boolean {
  return value instanceof Set && [...(value as Set<unknown>)].every(isId);
}

/** `model/measure.qnt` Transition — one observed ticket-phase transition. */
function isTransition(value: unknown): boolean {
  return hasFields(value, [
    ["ticket", isId],
    ["from", isString],
    ["to", isString],
  ]);
}

/** `model/measure.qnt` WrapUpObs — the wrap-up attempt observation. */
function isWrapUpObs(value: unknown): boolean {
  return taggedOneOf(value, [
    ["WONone", []],
    [
      "WOAttempt",
      [
        ["project", isId],
        ["invalidated", isBoolean],
      ],
    ],
  ]);
}

/** Every `Cmd` arm whose whole payload is a ticket id. */
const ticketOnly: readonly NamedCheck[] = [["ticket", isId]];

/**
 * THE DECISION EVENT'S FIELDS, per constructor — `cmd.ts`'s `Cmd` as data.
 *
 * A `Record<CmdTag, ...>` on purpose: the compiler requires an arm for every
 * constructor of `Cmd` and refuses an arm for anything else, so this table
 * cannot fall behind the vocabulary it validates. The field NAMES are still
 * this file's to get right, and `entry.test.ts` pins them by building one real
 * `Cmd` per constructor and requiring the gate to accept it — the type of that
 * fixture is `Cmd`, so a renamed field breaks the fixture, not just the check.
 */
const cmdFields: Readonly<Record<CmdTag, readonly NamedCheck[]>> = {
  JArrive: [
    ["deps", isTicketIdSet],
    ["program", isProgram],
    ["project", isId],
    ["wrapUp", isWrapUp],
  ],
  JRelease: ticketOnly,
  JRevoke: ticketOnly,
  JDispatch: ticketOnly,
  JTaskDone: [
    ["ticket", isId],
    ["tid", isId],
    ["verdict", isVerdict],
  ],
  JWorkReduce: ticketOnly,
  JEvalReduce: ticketOnly,
  JDequeue: [
    ["ticket", isId],
    ["moved", isBoolean],
  ],
  JGateResolve: [
    ["ticket", isId],
    ["out", isWrapUpOutcome],
  ],
  JCompleteDuplicate: ticketOnly,
  JRevalFail: ticketOnly,
  JOpRetry: ticketOnly,
};

/**
 * Every `Cmd` constructor's tag, DERIVED from the table above rather than typed
 * out again: the `Record<CmdTag, …>` is exhaustive or this file does not
 * compile, so its keys are the union and cannot fall behind it.
 *
 * IT IS EXPORTED FOR THE CONFORMANCE GATE, which holds it against
 * `model/refinement.qnt`'s own `type Cmd` as an exact set in both directions.
 * The compiler keeps this roster and `cmd.ts`'s union together; nothing in
 * TypeScript can keep either of them level with the model, and a constructor
 * the model gains that brings no decider with it was invisible to every gate
 * until that comparison existed.
 */
export const shippedCmdTags: readonly CmdTag[] = Object.keys(
  cmdFields,
) as readonly CmdTag[];

/** A decision event: a tag in the vocabulary, carrying exactly that arm's payload. */
function isCmd(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tag: unknown = (value as Record<string, unknown>)["tag"];
  if (typeof tag !== "string" || !Object.hasOwn(cmdFields, tag)) {
    return false;
  }
  return tagged(value, tag, cmdFields[tag as CmdTag]);
}

/**
 * A step record's SHAPE — the four fields the comparison walks, at the types it
 * walks them as. The vocabulary inside them is deliberately not checked here;
 * see the header.
 */
const stepRecordShape: readonly NamedCheck[] = [
  ["label", isString],
  ["transitions", (v) => Array.isArray(v) && v.every(isTransition)],
  ["effects", (v) => Array.isArray(v) && v.every(isString)],
  ["attempt", isWrapUpObs],
];

/**
 * The step record's field names, DERIVED from the shape gate above.
 *
 * IT IS EXPORTED FOR THE CONFORMANCE GATE, which holds it against
 * `model/measure.qnt`'s own `type StepRecord` as an exact set in both
 * directions — `shippedCmdTags`' arrangement, on the record vocabulary rather
 * than on the decision one. Nothing in TypeScript can keep this list level with
 * the model: the names are this file's to get right, and a rename upstream
 * left them spelling the old one with every gate green until that comparison
 * existed.
 */
export const stepRecordFieldNames: readonly string[] = stepRecordShape.map(
  ([name]) => name,
);

function isStepRecordShaped(value: unknown): boolean {
  return hasFields(value, stepRecordShape);
}

/** Each field kind's runtime check — the other half of `FieldTypes`. */
const kindChecks: Readonly<Record<FieldKind, (value: unknown) => boolean>> = {
  "sequence-number": isId,
  "decision-event": isCmd,
  "step-record": isStepRecordShaped,
};

/**
 * Is this value a journal row? The gate the schema describes, walked field by
 * field over `entrySchema.fields`.
 *
 * IT ANSWERS, IT NEVER THROWS. Every check below is a total predicate over
 * `unknown`, because the caller is a process recovering from a crash and the
 * value is whatever a store handed back: refusing a row is a recoverable
 * verdict, and an exception raised while deciding whether the log is readable
 * is the same failure as the one being guarded against.
 *
 * WHAT IT DOES NOT CLAIM: that the row is a legal step of the machine. A row
 * can be perfectly shaped and still record a decision the state refused or a
 * record the decider would not have produced. `journalLegalOn` is that claim,
 * and this gate is what lets it be asked at all.
 */
export function hasEntryShape(row: unknown): row is Entry {
  return hasFields(
    row,
    entrySchema.fields.map((field) => [field.name, kindChecks[field.kind]]),
  );
}
