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
  throw new AssertionError(`${message}: ${render(value)}`);
}

/**
 * Describe a value that the types said could not exist, without ever throwing
 * while doing it.
 *
 * That last clause is the whole requirement. This runs on the failure path of
 * an assertion, so an exception raised here replaces the caller's message —
 * the one naming what went wrong — with a `TypeError` about rendering, and the
 * defect that reached `assertNever` is reported as a defect in `assertNever`.
 *
 * Both fallbacks are reachable rather than defensive. `JSON.stringify` throws
 * on a BigInt and on a circular structure, and a decoded golden trace produces
 * the first: ITF serializes integers as `{#bigint}`, so the values arriving
 * from the corpus in s3 are bigints. `String` throws on a symbol.
 */
function render(value: unknown): string {
  try {
    const json = stringify(value);
    if (json !== undefined) {
      return json;
    }
  } catch {
    // Fall through to the string coercion, which renders a bigint as its
    // digits and a circular object as `[object Object]` — both of which say
    // more than nothing.
  }
  try {
    return String(value);
  } catch {
    return "<unrenderable>";
  }
}

/**
 * `JSON.stringify` at the return type it actually has. The standard library
 * declares the one-argument overload as returning `string`, and it returns
 * `undefined` for a function or a bare `undefined` — and the value that reaches
 * `assertNever` is by definition one the declared types were wrong about, so
 * this is the one place that overload cannot be taken at its word.
 */
function stringify(value: unknown): string | undefined {
  return JSON.stringify(value);
}
