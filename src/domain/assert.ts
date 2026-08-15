/**
 * The two assertion mechanisms the engineering bar names by hand, homed in the
 * layer that may not reach anything else: `assertNever` for the default arm of
 * an exhaustive switch, and `invariant` for the liberal assertions domain code
 * is required to carry.
 *
 * They live here rather than in a shared utility directory because they are
 * pure and because the domain is the deepest layer — a helper above it could
 * not be called from inside it without breaking the module-graph rule that
 * governs this directory. Every layer above may import downward.
 *
 * Neither is model content: `model/domain.qnt` has no counterpart to either.
 * They are the toolchain's contribution, and the later slices consume them.
 */

/** Thrown by both helpers, so a failed assertion is distinguishable by type. */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Assert `condition`, narrowing it for the compiler when it holds.
 *
 * The message is a plain string rather than a lazily-built one: domain
 * assertions sit on hot replay paths, and a thunk allocated per call to
 * describe a failure that does not happen costs more than the string it saves.
 */
export function invariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

/**
 * The default arm of a switch over a discriminated union. Reaching it is a
 * compile error while the switch is exhaustive, and a thrown `AssertionError`
 * naming the unhandled value if one ever arrives at runtime — which is exactly
 * what a decoded golden trace can deliver, since its tags come from outside
 * TypeScript's knowledge.
 */
export function assertNever(value: never, message: string): never {
  throw new AssertionError(`${message}: ${render(value) ?? "undefined"}`);
}

/**
 * `JSON.stringify` at the return type it actually has. The standard library
 * declares the one-argument overload as returning `string`, and it returns
 * `undefined` for a function or a bare `undefined` — and the value that reaches
 * `assertNever` is by definition one the declared types were wrong about, so
 * this is the one place that overload cannot be taken at its word.
 */
function render(value: unknown): string | undefined {
  return JSON.stringify(value);
}
