/**
 * How the Context view reads the runtime's own lines, which arrive as JSON no
 * schema holds: an object as its fields, and a count as a number or nothing.
 */

/** A value as the object it is, or nothing where it is not one. */
export function contextRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A count as the runtime wrote it, or none where it wrote no number. */
export function contextNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
