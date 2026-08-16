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
 * Every branch is reachable rather than defensive, and each is reached by a
 * different kind of value:
 *
 *   - `JSON.stringify` RETURNS UNDEFINED for a function, a bare `undefined`
 *     and a symbol. Those fall to the string coercion, which renders all
 *     three.
 *   - It THROWS on a circular structure — and would throw on a bigint, which
 *     is why the replacer below exists. A decoded golden trace is the reason
 *     to care: ITF serializes integers as `{#bigint}`, so what arrives from
 *     the corpus in s3 is a record with bigint FIELDS, and coercing that whole
 *     record with `String` would render it `[object Object]` and lose the very
 *     tag that names the unhandled case. The replacer keeps the record
 *     renderable as a record.
 *   - `String` throws on an object with a null prototype, which has no
 *     `toString` to call. Reaching the last branch therefore takes a value
 *     that defeats both — a null-prototype object inside a cycle is the
 *     smallest one, and it is what the test uses.
 */
function render(value: unknown): string {
  try {
    const json = stringify(value);
    if (json !== undefined) {
      return json;
    }
  } catch {
    // Fall through to the string coercion.
  }
  try {
    return String(value);
  } catch {
    return "<unrenderable>";
  }
}

/**
 * Renders a bigint as its digits with an `n` suffix, so a record carrying one
 * survives `JSON.stringify` instead of throwing the whole record away. The
 * suffix is deliberate: it keeps the rendering unambiguous against a string
 * field that happened to hold digits.
 */
function bigintsAsDigits(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}

/**
 * `JSON.stringify` at the return type it actually has. The standard library
 * declares the one-argument overload as returning `string`, and it returns
 * `undefined` for a function, a bare `undefined` and a symbol — and the value
 * that reaches `assertNever` is by definition one the declared types were
 * wrong about, so this is the one place that overload cannot be taken at its
 * word.
 */
function stringify(value: unknown): string | undefined {
  return JSON.stringify(value, bigintsAsDigits);
}

/**
 * An error's message, for a `catch` that has to report one.
 *
 * IT IS HERE BECAUSE THREE LAYERS CATCH, and each was carrying its own copy:
 * the replayer, the corpus reader, and the randomized walker. `catch` binds
 * `unknown`, so every one of them needs the same two lines — and a helper that
 * is written once per layer is a helper the next layer writes a fourth time.
 * The domain is where it goes for the reason the two assertions above are here:
 * it is pure, total, and the deepest layer, so every layer above can import it
 * and none of them has to reach sideways for it.
 *
 * `AssertionError` needs no clause of its own: it extends `Error`, so the copy
 * that named it separately was testing the same thing twice.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
