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
 * VERSIONING IS DECLARED, NOT IMPLEMENTED. `entrySchema.version` is 1 and there
 * is no migration machinery, because there is exactly one version and a
 * migration path for a version that does not exist is speculation. What the
 * field buys today is that the first row ever written carries the number a
 * later reader will ask for.
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
 * prevent. Reconstructing a `Set` from a serialized list is the store adapter's
 * business, and it must happen before the row reaches here.
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

/** `model/measure.qnt` WrapUpObs — the landing-boundary observation. */
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
function isStepRecordShaped(value: unknown): boolean {
  return hasFields(value, [
    ["label", isString],
    ["transitions", (v) => Array.isArray(v) && v.every(isTransition)],
    ["effects", (v) => Array.isArray(v) && v.every(isString)],
    ["landing", isWrapUpObs],
  ]);
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
