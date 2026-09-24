/**
 * What a refused decision input settles with. It imports nothing of this
 * layer, so the wire's codec and the decision port can both name it.
 */

import {
  ticketRefusalTags,
  type TicketRefusal,
} from "../domain/generated/modelTypes.ts";

/**
 * The refusals the boundary decides before `decide` is asked anything: a
 * release whose revision or configuration moved, a dispatch whose fence did,
 * and a source nobody could read. Each is a fact about rows or a remote rather
 * than about the ticket, so it carries no payload.
 */
export type BoundaryRefusalCode =
  | "AuthoringChanged"
  | "ConfigurationInvalid"
  | "TicketChanged"
  | "SelectionChanged"
  | "ExecutionSourceUnreadable"
  | "ExecutionSourceDenied"
  | "BriefNamesNoRepository";

/** Every boundary refusal, in the order this file declares them, so a suite and a CHECK can iterate rather than restate. */
export const allBoundaryRefusalCodes: readonly BoundaryRefusalCode[] = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
];

/**
 * The finite vocabulary a refused operation answers with: the machine's
 * refusals and the boundary's. It is closed because 006 requires a stable
 * safe code, and an open one is a code a client cannot branch on.
 */
export type RefusalCode = TicketRefusal["type"] | BoundaryRefusalCode;

/** Every refusal code, the machine's first, so a suite and a CHECK can iterate rather than restate. */
export const allRefusalCodes: readonly RefusalCode[] = [
  ...ticketRefusalTags,
  ...allBoundaryRefusalCodes,
];

/**
 * A refusal as the writer settles it. The machine's carries what `decide`
 * refused with, and its tag is the code; the boundary's is the code alone.
 */
export type Refusal = TicketRefusal | { readonly type: BoundaryRefusalCode };

/** Whether a refusal is the machine's, and so carries its payload. */
export function isTicketRefusal(refusal: Refusal): refusal is TicketRefusal {
  return ticketRefusalTags.some((tag) => tag === refusal.type);
}

/** A boundary refusal, spelled as the writer settles it. */
export function boundaryRefusal(code: BoundaryRefusalCode): Refusal {
  return { type: code };
}
