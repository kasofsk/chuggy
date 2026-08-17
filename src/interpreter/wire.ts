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
 * THE DOMAIN TYPE IS THE TRUTH AND THE SCHEMA IS ITS MIRROR.
 * `entrySchemaMirrorsEntry` stops compiling the moment the two stop describing
 * each other, which is the difference between a duplicate and a mirror: a field
 * dropped from a schema, a vocabulary member missing from a tuple, or a domain
 * type that grew are each a type error here rather than a value that parsed and
 * lost something. That is also what holds the restated vocabularies below to
 * their unions, so they need no second roster to be checked against.
 *
 * WHAT IT DOES NOT CHECK. A row's syntax is this file's; a journal's HISTORY is
 * `journalLegalOn`'s — dense seqs, every decision enabled at its replayed
 * prefix, every record reproduced by the decider. The seam between them is the
 * seam between a malformed row and a well-formed row of a run that never
 * happened, and `src/interpreter/executor.ts` reads a journal through both.
 *
 * THE ONE REPRESENTATION GAP THIS PARSE CLOSES: the model's arrival draws its
 * deps as a SET where `Cmd` carries an array, so an array with a repeat is a
 * value the model has no counterpart for, and it is refused here rather than
 * reaching a decider that would keep it.
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

import type { Cmd } from "../actor/command.ts";
import type { Entry } from "../actor/journal.ts";
import { allEffects } from "../domain/effect.ts";
import { asProjectId, asTaskId, asTicketId } from "../domain/ids.ts";

/** A wire integer already inside the range the domain mints its identifiers from. */
const identifierNumber = z.int().min(1);

const ticketIdSchema = identifierNumber.transform(asTicketId);
const taskIdSchema = identifierNumber.transform(asTaskId);
const projectIdSchema = identifierNumber.transform(asProjectId);

/** An arrival's dependencies, refusing the repeat that the model's set cannot express. */
const depsSchema = z
  .array(ticketIdSchema)
  .readonly()
  .refine((deps) => new Set(deps).size === deps.length, {
    message: "names a ticket twice, and the arrival draws a set",
  });

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
function cmdTicketOnly<Tag extends Cmd["cmd"]>(tag: Tag) {
  return z.object({ cmd: z.literal(tag), ticket: ticketIdSchema });
}

const cmdSchema = z.discriminatedUnion("cmd", [
  z.object({
    cmd: z.literal("JArrive"),
    deps: depsSchema,
    program: z.array(stageSchema).readonly(),
    project: projectIdSchema,
    wrapUp: wrapUpSchema,
  }),
  cmdTicketOnly("JRelease"),
  cmdTicketOnly("JRevoke"),
  cmdTicketOnly("JDispatch"),
  z.object({
    cmd: z.literal("JTaskDone"),
    ticket: ticketIdSchema,
    taskId: taskIdSchema,
    verdict: z.enum(["VPass", "VFail"]),
  }),
  cmdTicketOnly("JWorkReduce"),
  cmdTicketOnly("JEvalReduce"),
  z.object({
    cmd: z.literal("JDequeue"),
    ticket: ticketIdSchema,
    moved: z.boolean(),
  }),
  z.object({
    cmd: z.literal("JGateResolve"),
    ticket: ticketIdSchema,
    outcome: z.enum(["WOk", "WFailed"]),
  }),
  cmdTicketOnly("JCompleteDuplicate"),
  cmdTicketOnly("JRevalFail"),
  cmdTicketOnly("JOpRetry"),
]);

/** One stored row: the sequence number, the decision event, and the record the decision produced. */
const entrySchema = z.object({
  seq: z.int().min(1),
  cmd: cmdSchema,
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
