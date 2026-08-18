/**
 * A transform takes the text composed so far, the view, and whatever params
 * its name declares, and returns what replaces it. A pipeline is these folded
 * in order.
 *
 * The params are a tuple the spec computes rather than one argument, and the
 * tuple is empty when a name declares none. A single argument typed `void`
 * would still have to be passed at every call that takes no params, which is
 * most of them.
 *
 * One that opens a prompt ignores its input rather than being a kind of its
 * own, so a pipeline can be reordered without its head being retyped.
 *
 * PROMPT TEXT AND NOTHING ELSE. A transform returns the whole replacement, so
 * a pipeline is last-writer-wins, and that is right for text and wrong for
 * anything composing by precedence or intersection. A task's tools and its
 * permissions are the two this fold must never be reached for: under
 * last-writer-wins a later step silently widens what an earlier one narrowed.
 */

/** The names a spec declares, narrowed to the ones a trace entry can carry. */
export type TransformName<Spec> = keyof Spec & string;

/** Empty exactly when the params are `void`, which is what lets `add` omit them. */
export type ParamsOf<Params> = [Params] extends [void] ? [] : [params: Params];

export type Transform<View, Params> = (
  input: string,
  view: View,
  ...params: ParamsOf<Params>
) => string;

export interface TraceEntry<Name extends string> {
  readonly transformName: Name;
  readonly output: string;
}

/** A fold cannot say which transform a line came from; the trace says what the prompt was after each. */
export interface Composition<Name extends string> {
  readonly prompt: string;
  readonly trace: readonly TraceEntry<Name>[];
}
