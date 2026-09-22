/**
 * The identifiers this machine counts with, each branded so the compiler can
 * tell them apart. In a structurally typed language two aliases of `number`
 * are the same type, so a ticket id and a task's wire number would be
 * silently interchangeable — and the boundary uses both, in the same rows,
 * one line apart.
 *
 * Every one of them is a `number` rather than a `bigint`, and the model's
 * `int` is unbounded, so that choice is an assumption and is checked rather
 * than assumed: `asSafeInteger` refuses anything outside the range JavaScript
 * represents exactly, and every value entering the domain from a trace or a
 * boundary passes through it. The alternative — `bigint` throughout — buys
 * exactness this domain does not need: a ticket id and a stage index come
 * from universes `Config` bounds (`nTickets`, `maxStages`), and a task's wire
 * number counts one ticket's tasks, which no deployment brings near the exact
 * range — and pays for it at every arithmetic site.
 */

declare const ticketIdBrand: unique symbol;
declare const taskIdBrand: unique symbol;
declare const stageIndexBrand: unique symbol;
declare const installationIdBrand: unique symbol;

/** A ticket's identity: supplied at release from a bounded universe, sparse, never reused. */
export type TicketId = number & { readonly [ticketIdBrand]: true };

/**
 * The number that names a task outside the machine: minted per ticket by the
 * interpreter when it projects a decision's tasks onto executions, injective
 * and monotone within its ticket. Inside, a task is named by the contract's
 * `TaskIdentity`, which carries no number at all.
 */
export type TaskId = number & { readonly [taskIdBrand]: true };

/** A zero-based index into a ticket's released plan. */
export type StageIndex = number & { readonly [stageIndexBrand]: true };

/** The durable authority whose journal gives local ticket identities meaning. */
export type InstallationId = string & {
  readonly [installationIdBrand]: true;
};

/** A ticket identity that remains unambiguous outside its installation. */
export interface TicketRef {
  readonly installation: InstallationId;
  readonly ticket: TicketId;
}

/** Parses the canonical UUID stored for one installation authority. */
export function asInstallationId(value: string): InstallationId {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    throw new RangeError(`installation id: ${value} is not a canonical UUID`);
  return value as InstallationId;
}

/**
 * Refuses a number JavaScript cannot represent exactly. Every quantity here is
 * bounded by a declared constant, so this failing means a bound was wrong
 * rather than that the arithmetic overflowed.
 */
export function asSafeInteger(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${what}: ${String(value)} is not an exactly representable integer; a declared bound is wrong`,
    );
  }
  return value;
}

/** Brands a non-negative integer as a ticket id. */
export function asTicketId(value: number): TicketId {
  asSafeInteger(value, "ticket id");
  if (value < 1)
    throw new RangeError(`ticket id: ${String(value)} is below the first id`);
  return value as TicketId;
}

/** Brands a positive integer as a task's wire number. */
export function asTaskId(value: number): TaskId {
  asSafeInteger(value, "task id");
  if (value < 1)
    throw new RangeError(`task id: ${String(value)} is below the first id`);
  return value as TaskId;
}

/** Brands a non-negative integer as a stage index. */
export function asStageIndex(value: number): StageIndex {
  asSafeInteger(value, "stage index");
  if (value < 0)
    throw new RangeError(`stage index: ${String(value)} is negative`);
  return value as StageIndex;
}
