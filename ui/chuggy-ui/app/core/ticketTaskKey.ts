/**
 * The machine's own name for a task, read back into the structure that named
 * it.
 *
 * A key is `work:<ticket>:<cycle>` or
 * `evaluation:<ticket>:<work_cycle>:<stage>:<generation>:<evaluator>`, so the
 * cycle a run belongs to and the stage that judged it are stated in the key
 * rather than recovered from the order rows arrive in. Nothing here sorts and
 * nothing here guesses.
 *
 * A KEY THAT WILL NOT PARSE IS AN ARM, NOT A DEFAULT. Placing an unreadable key
 * in a cycle would put a run under a cycle nobody can check it belongs to, so
 * `Unreadable` carries the key it could not read and the ledger draws it as a
 * row of its own. One illegible field makes the whole key unreadable: a key
 * assembled from the fields that happened to parse is the guess this module
 * exists to refuse.
 *
 * EVERY FIELD IS A WHOLE NON-NEGATIVE NUMBER WRITTEN PLAINLY. A padded, signed,
 * fractional or exponent spelling is a key this console cannot claim to have
 * read, because it is not the spelling the machine writes.
 */

const taskKeyFieldPattern = /^(?:0|[1-9][0-9]*)$/u;

export const taskKeyWorkPrefix = "work";
export const taskKeyEvaluationPrefix = "evaluation";

const taskKeyWorkFields = 2;
const taskKeyEvaluationFields = 5;

export type TicketTaskKey =
  | { readonly kind: "Work"; readonly ticket: number; readonly cycle: number }
  | {
      readonly kind: "Evaluation";
      readonly ticket: number;
      readonly workCycle: number;
      readonly stage: number;
      readonly generation: number;
      readonly evaluator: number;
    }
  | { readonly kind: "Unreadable"; readonly taskKey: string };

/** A whole non-negative number as the machine writes one, or nothing. */
function taskKeyNumber(field: string | undefined): number | undefined {
  if (field === undefined || !taskKeyFieldPattern.test(field)) return undefined;
  const value = Number(field);
  return Number.isSafeInteger(value) ? value : undefined;
}

function taskKeyWork(fields: readonly string[]): TicketTaskKey | undefined {
  if (fields.length !== taskKeyWorkFields) return undefined;
  const ticket = taskKeyNumber(fields[0]);
  const cycle = taskKeyNumber(fields[1]);
  if (ticket === undefined || cycle === undefined) return undefined;
  return { kind: "Work", ticket, cycle };
}

function taskKeyEvaluation(
  fields: readonly string[],
): TicketTaskKey | undefined {
  if (fields.length !== taskKeyEvaluationFields) return undefined;
  const ticket = taskKeyNumber(fields[0]);
  const workCycle = taskKeyNumber(fields[1]);
  const stage = taskKeyNumber(fields[2]);
  const generation = taskKeyNumber(fields[3]);
  const evaluator = taskKeyNumber(fields[4]);
  if (
    ticket === undefined ||
    workCycle === undefined ||
    stage === undefined ||
    generation === undefined ||
    evaluator === undefined
  )
    return undefined;
  return {
    kind: "Evaluation",
    ticket,
    workCycle,
    stage,
    generation,
    evaluator,
  };
}

/** The key as the machine wrote it, or the fact that it cannot be read. */
export function ticketTaskKeyParse(taskKey: string): TicketTaskKey {
  const [prefix, ...rest] = taskKey.split(":");
  if (prefix === taskKeyWorkPrefix)
    return taskKeyWork(rest) ?? { kind: "Unreadable", taskKey };
  if (prefix === taskKeyEvaluationPrefix)
    return taskKeyEvaluation(rest) ?? { kind: "Unreadable", taskKey };
  return { kind: "Unreadable", taskKey };
}

/** Which ticket the key names, absent where it names none it could be read from. */
export function ticketTaskKeyTicket(key: TicketTaskKey): number | undefined {
  switch (key.kind) {
    case "Work":
    case "Evaluation":
      return key.ticket;
    case "Unreadable":
      return undefined;
  }
}

/** Which work cycle the run belongs to: its own, or the one it judged. */
export function ticketTaskKeyCycle(key: TicketTaskKey): number | undefined {
  switch (key.kind) {
    case "Work":
      return key.cycle;
    case "Evaluation":
      return key.workCycle;
    case "Unreadable":
      return undefined;
  }
}

/**
 * Whether a key a change frame names belongs to this ticket. The frame's
 * resource is the task key itself, so this is what lets one ticket's page
 * re-read on its own executions and leave every other ticket's alone.
 */
export function ticketTaskKeyNamesTicket(
  taskKey: string,
  ticket: number,
): boolean {
  return ticketTaskKeyTicket(ticketTaskKeyParse(taskKey)) === ticket;
}
