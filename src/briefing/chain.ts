/**
 * An ordered configuration of transform names and the params each is added
 * with, resolved against a registry and folded over a seed. Adding returns a
 * new chain, so a base can be shared.
 *
 * A name the spec has not got, and params of the wrong shape for the name they
 * are added under, are both type errors where the chain is written in
 * TypeScript. Where it is written in a ticket, the name is a parsed string and
 * the type is what the parse claimed, so `add` refuses one that resolves to
 * nothing rather than trusting the claim.
 *
 * The method is `add` and not `then`: an object carrying a `then` is a thenable
 * and would be awaited by anything that touched it.
 */

import type { Registry } from "./registry.ts";
import type {
  Composition,
  ParamsOf,
  TraceEntry,
  TransformName,
} from "./transform.ts";

export interface Chain<View, Spec> {
  add<Name extends TransformName<Spec>>(
    name: Name,
    ...params: ParamsOf<Spec[Name]>
  ): Chain<View, Spec>;
  compose(seed: string, view: View): Composition<TransformName<Spec>>;
}

/** A step binds its params where their type is still known, so the fold makes one call. */
interface ChainStep<View, Spec> {
  readonly name: TransformName<Spec>;
  readonly applied: (input: string, view: View) => string;
}

export function chainOf<View, Spec>(
  registry: Registry<View, Spec>,
): Chain<View, Spec> {
  return chainOfFrom(registry, []);
}

function chainOfFrom<View, Spec>(
  registry: Registry<View, Spec>,
  steps: readonly ChainStep<View, Spec>[],
): Chain<View, Spec> {
  return {
    add<Name extends TransformName<Spec>>(
      name: Name,
      ...params: ParamsOf<Spec[Name]>
    ): Chain<View, Spec> {
      const transform = registry.transformNamed(name);
      if (transform === undefined) {
        throw new Error(`chain: no transform is registered as ${name}`);
      }
      const applied = (input: string, view: View): string =>
        transform(input, view, ...params);
      return chainOfFrom(registry, [...steps, { name, applied }]);
    },
    compose(seed: string, view: View): Composition<TransformName<Spec>> {
      return chainOfComposed(steps, seed, view);
    },
  };
}

/** An empty prompt reads to its reader exactly like a full one, so it is refused. */
function chainOfComposed<View, Spec>(
  steps: readonly ChainStep<View, Spec>[],
  seed: string,
  view: View,
): Composition<TransformName<Spec>> {
  const trace: TraceEntry<TransformName<Spec>>[] = [];
  let text = seed;
  for (const step of steps) {
    text = step.applied(text, view);
    trace.push({ transformName: step.name, output: text });
  }
  if (text.trim() === "") {
    throw new Error(`chain: composed no prompt after ${chainOfHowFar(trace)}`);
  }
  return { prompt: text, trace };
}

/** The refusal has no prompt to show, so it says how far the fold got instead. */
function chainOfHowFar(trace: readonly TraceEntry<string>[]): string {
  const last = trace.at(-1);
  if (last === undefined) {
    return "an empty chain";
  }
  return `${String(trace.length)} transform(s), last ${last.transformName}`;
}
