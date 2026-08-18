/**
 * The journal entry's wire schema, and the parse a stored journal passes
 * through on its way back in.
 *
 * PARSE, DON'T VALIDATE, AND THE REFUSAL IS RETURNED. A journal on disk is
 * outside this process's control, which is the model's own reason for putting
 * the check at the store boundary: a tampered journal arrives there. So a read
 * produces either an `Entry` or a reason, and a caller cannot proceed without
 * choosing. Throwing is the idiomatic answer to an invalid input and it is the
 * wrong one here — the model refuses structurally, by set membership, one layer
 * out, and a returned refusal is what that looks like where illegal values
 * actually arrive.
 *
 * THE DOMAIN TYPE IS THE TRUTH AND THE SCHEMA IS ITS MIRROR, in the read
 * direction. `entrySchemaMirrorsEntry` stops compiling the moment the parsed
 * type and `Entry` stop describing each other, which is the difference between a
 * duplicate and a mirror: a field dropped from a schema, a vocabulary member
 * missing from a tuple, or a domain type that grew are each a type error here
 * rather than a value that parsed and lost something. That is also what holds
 * the restated vocabularies below to their unions, so they need no second roster
 * to be checked against.
 *
 * THE WRITE DIRECTION CANNOT BE MIRRORED, because the deps transform is not an
 * identity, so it is pinned twice instead. `encodeEntry` builds an `EntryWire` —
 * the schema's own INPUT type — before it stringifies, so a domain shape the
 * wire has no counterpart for is a type error rather than the empty object
 * `JSON.stringify` writes for a set; and `test/interpreter/wire.test.ts`
 * round-trips a multi-dep arrival back to an `Entry` equal to the one written.
 *
 * WHAT IT DOES NOT CHECK. A row's syntax is this file's; a journal's HISTORY is
 * `journalLegalOn`'s — dense seqs, every decision enabled at its replayed
 * prefix, every record reproduced by the decider. The seam between them is the
 * seam between a malformed row and a well-formed row of a run that never
 * happened, and `src/interpreter/executor.ts` reads a journal through both.
 *
 * WHERE THE DEPS CHANGE SHAPE. `DecisionEvent` carries the model's own SET and the wire
 * carries an ascending array, so this module is the seam that converts, and the
 * repeat an array can hold is refused here — by `depsDistinct`, before the
 * surviving array becomes the set. A journal on disk did not have to come from
 * this process, which is why the refusal is at the boundary and not only at the
 * type.
 *
 * THE OTHER GAP IS LEFT OPEN DELIBERATELY: `seq` enters unbranded, where every
 * identity in `src/domain/ids.ts` is branded. A brand exists to stop two
 * identities being interchanged, and the sequence number, the executor cursor
 * and the journal's length are not two things — the journal is dense, so
 * `executorSound` is stated as arithmetic across all three. A brand there would
 * have to be cast into existence at every site the model writes as arithmetic,
 * and a brand that is cast is ceremony. What the parse enforces instead is what
 * a brand could not have said: a sequence number is a whole number no smaller
 * than the first, and whether the whole run of them is a history this machine
 * could have taken is `journalLegalOn`'s question.
 */

import * as z from "zod";

import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { Entry } from "../actor/journal.ts";
import { allEffects } from "../domain/effect.ts";
import { depsDistinct } from "../domain/enablement.ts";
import {
  asProjectId,
  asTaskId,
  asTicketId,
  type TicketId,
} from "../domain/ids.ts";

/** A wire integer already inside the range the domain mints its identifiers from. */
const identifierNumber = z.int().min(1);

const ticketIdSchema = identifierNumber.transform(asTicketId);
const taskIdSchema = identifierNumber.transform(asTaskId);
const projectIdSchema = identifierNumber.transform(asProjectId);

/** An arrival's dependencies: an array here, refused for a repeat, and the model's set after. */
const depsSchema = z
  .array(ticketIdSchema)
  .refine(depsDistinct, {
    message: "names a ticket twice, and the arrival draws a set",
  })
  .transform((deps): ReadonlySet<TicketId> => new Set(deps));

const stageSchema = z.object({
  fanout: z.int().min(1),
  combinator: z.enum(["CUnanimousPass", "CAnyPass"]),
});

const wrapUpSchema = z.discriminatedUnion("wrapUp", [
  z.object({ wrapUp: z.literal("WNone") }),
  z.object({ wrapUp: z.literal("WExclusive"), resource: z.int().min(1) }),
]);

const attemptSchema = z.discriminatedUnion("attempt", [
  z.object({ attempt: z.literal("WONone") }),
  z.object({
    attempt: z.literal("WOAttempt"),
    project: projectIdSchema,
    invalidated: z.boolean(),
  }),
]);

const phaseSchema = z.enum([
  "PDraft",
  "PPending",
  "PWorking",
  "PEvaluating",
  "PWrapUp",
  "PWrapUpHolding",
  "PDone",
  "PEscalated",
  "PRevoked",
]);

const transitionSchema = z.object({
  ticket: ticketIdSchema,
  from: phaseSchema,
  to: phaseSchema,
});

/** The effect vocabulary is read off `src/domain/effect.ts` rather than restated, because it is exported to be read. */
const recordSchema = z.object({
  label: z.string(),
  transitions: z.array(transitionSchema).readonly(),
  effects: z.array(z.enum(allEffects)).readonly(),
  attempt: attemptSchema,
});

/** The decisions whose whole payload is the ticket they name. */
function eventTicketOnly<Tag extends DecisionEvent["event"]>(tag: Tag) {
  return z.object({ event: z.literal(tag), ticket: ticketIdSchema });
}

const decisionEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("Arrive"),
    deps: depsSchema,
    program: z.array(stageSchema).readonly(),
    project: projectIdSchema,
    wrapUp: wrapUpSchema,
  }),
  eventTicketOnly("Release"),
  eventTicketOnly("Revoke"),
  eventTicketOnly("Dispatch"),
  z.object({
    event: z.literal("TaskDone"),
    ticket: ticketIdSchema,
    taskId: taskIdSchema,
    verdict: z.enum(["VPass", "VFail"]),
  }),
  eventTicketOnly("WorkReduce"),
  eventTicketOnly("EvalReduce"),
  z.object({
    event: z.literal("Dequeue"),
    ticket: ticketIdSchema,
    moved: z.boolean(),
  }),
  z.object({
    event: z.literal("GateResolve"),
    ticket: ticketIdSchema,
    outcome: z.enum(["WOk", "WFailed"]),
  }),
  eventTicketOnly("CompleteDuplicate"),
  eventTicketOnly("RevalFail"),
  eventTicketOnly("OpRetry"),
]);

/** One stored row: the sequence number, the decision event, and the record the decision produced. */
const entrySchema = z.object({
  seq: z.int().min(1),
  event: decisionEventSchema,
  rec: recordSchema,
});

/** A whole stored journal, in the order the store kept it. */
const journalSchema = z.array(entrySchema).readonly();

/** Assignable in both directions, or `never` — and `never` is what fails to compile below. */
type Mirrors<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : never
  : never;

/** The compile-time half of the parse: the schema and the domain type describe each other, on every build. */
export const entrySchemaMirrorsEntry: Mirrors<
  z.infer<typeof entrySchema>,
  Entry
> = true;

/** A stored row as JSON holds it: the schema's own input, which is what makes the write direction checkable. */
type EntryWire = z.input<typeof entrySchema>;

/** Writes one `Entry` as the text a store keeps, laying the arrival's set out ascending. */
export function encodeEntry(entry: Entry): string {
  const event: EntryWire["event"] =
    entry.event.event === "Arrive"
      ? { ...entry.event, deps: [...entry.event.deps].sort((a, b) => a - b) }
      : entry.event;
  const wire: EntryWire = { ...entry, event };
  return JSON.stringify(wire);
}

/** What a parse answers: the value, or the reason it was refused. */
export type Parsed<Value> =
  | { readonly parsed: "Ok"; readonly value: Value }
  | { readonly parsed: "Refused"; readonly why: string };

/** Renders the schema's complaint as one line, so the library's own error type stops at this module. */
function parseRefusal(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.map((key) => String(key)).join(".");
      return `${at === "" ? "$" : at}: ${issue.message}`;
    })
    .join("; ");
}

/** Reads one wire row into an `Entry`, refusing anything the schema does not describe. */
export function parseEntry(raw: unknown): Parsed<Entry> {
  const result = entrySchema.safeParse(raw);
  return result.success
    ? { parsed: "Ok", value: result.data }
    : { parsed: "Refused", why: parseRefusal(result.error) };
}

/** Reads a whole stored journal, refusing the lot when any row is not one this machine writes. */
export function parseJournal(raw: unknown): Parsed<readonly Entry[]> {
  const result = journalSchema.safeParse(raw);
  return result.success
    ? { parsed: "Ok", value: result.data }
    : { parsed: "Refused", why: parseRefusal(result.error) };
}
