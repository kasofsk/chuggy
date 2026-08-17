/**
 * An ordered configuration of transform names, resolved against a registry and
 * folded over a seed. Adding returns a new chain, so a base can be shared.
 *
 * A name resolves when it is added rather than when the chain runs, so a
 * configuration error does not wait for the run that needed the prompt.
 *
 * The method is `add` and not `then`: an object carrying a `then` is a thenable
 * and would be awaited by anything that touched it.
 */

import type { TransformName } from "./names.ts";
import type { Composition, TraceEntry, Transform } from "./transform.ts";
import type { Registry } from "./registry.ts";

export interface Chain<View> {
  add(name: TransformName): Chain<View>;
  compose(seed: string, view: View): Composition;
}

interface ChainStep<View> {
  readonly name: TransformName;
  readonly transform: Transform<View>;
}

export function chainOf<View>(registry: Registry<View>): Chain<View> {
  return chainOfFrom(registry, []);
}

function chainOfFrom<View>(
  registry: Registry<View>,
  steps: readonly ChainStep<View>[],
): Chain<View> {
  return {
    add(name: TransformName): Chain<View> {
      const transform = registry.transformNamed(name);
      if (transform === undefined) {
        throw new Error(`chain: no transform is registered as ${name}`);
      }
      return chainOfFrom(registry, [...steps, { name, transform }]);
    },
    compose(seed: string, view: View): Composition {
      return chainOfComposed(steps, seed, view);
    },
  };
}

/** An empty prompt reads to its reader exactly like a full one, so it is refused. */
function chainOfComposed<View>(
  steps: readonly ChainStep<View>[],
  seed: string,
  view: View,
): Composition {
  const trace: TraceEntry[] = [];
  let text = seed;
  for (const step of steps) {
    text = step.transform(text, view);
    trace.push({ transformName: step.name, output: text });
  }
  if (text.trim() === "") {
    throw new Error(`chain: composed no prompt after ${chainOfHowFar(trace)}`);
  }
  return { prompt: text, trace };
}

/** The refusal has no prompt to show, so it says how far the fold got instead. */
function chainOfHowFar(trace: readonly TraceEntry[]): string {
  const last = trace.at(-1);
  if (last === undefined) {
    return "an empty chain";
  }
  return `${String(trace.length)} transform(s), last ${last.transformName}`;
}
