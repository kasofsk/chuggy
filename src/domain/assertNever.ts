/**
 * The exhaustiveness terminator. The default arm of a switch over a
 * discriminated union calls it, so a variant added without being handled is a
 * compile error at that switch rather than a value falling through it.
 */

/** Rejects a value the type system has already proved unreachable. */
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
