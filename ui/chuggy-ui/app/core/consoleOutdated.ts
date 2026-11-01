/**
 * Whether this console is older than the API: it has met an answer whose shape
 * it cannot read, which is a frame the stream skipped or a read whose document
 * the schema refused. Nothing unsets it, because only a reload makes the
 * console newer.
 */

import { ApiOutcomeError } from "./apiRequest.ts";

/** A JSON document the console's own schema refused, and not a body that was
 * never JSON, which a proxy's page answers too. */
export function consoleOutdatedRead(error: unknown): boolean {
  return (
    error instanceof ApiOutcomeError &&
    error.result.outcome === "Unreadable" &&
    error.result.shapeRefused === true
  );
}
