/** Validated identifiers shared by installation and project boundaries. */

declare const ticketIdBrand: unique symbol;
declare const taskIdBrand: unique symbol;
declare const stageIndexBrand: unique symbol;
declare const installationIdBrand: unique symbol;

/** A project-local ticket identity. */
export type TicketId = number & { readonly [ticketIdBrand]: true };

/** A numeric task identity. */
export type TaskId = number & { readonly [taskIdBrand]: true };

/** A zero-based index into a ticket's authored program. */
export type StageIndex = number & { readonly [stageIndexBrand]: true };

/** The installation authority for project-local identities. */
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

/** Refuses a number JavaScript cannot represent exactly. */
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

/** Brands a non-negative integer as a task id. */
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

/** Task ids are one-indexed; the base is named once so the arithmetic carries the convention. */
export const firstTaskId: TaskId = 1 as TaskId;
