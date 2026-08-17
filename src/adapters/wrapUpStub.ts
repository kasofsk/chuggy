/**
 * The wrap-up performer, as a stub: it records the notices and gate
 * instructions it was handed, and attempts nothing.
 *
 * The held/handed pair is the same two readings the other stubs expose,
 * because at-least-once is observable only as their difference. What a real
 * performer owes beyond absorption — re-answering a repeated gate instruction
 * with the same attempt's outcome — has no observable half in a stub that
 * performs nothing, so the port states it and this file cannot demonstrate it.
 */

import type { Effect } from "../domain/effect.ts";
import {
  emissionKey,
  type Emission,
  type WrapUpPort,
} from "../interpreter/ports.ts";

/** One handed instruction: which of the two, about which decision and ticket. */
export interface WrapUpNote {
  readonly effect: Effect;
  readonly emission: Emission;
}

/** The performer with both readings exposed: what it holds, and what it was handed. */
export interface WrapUpStub extends WrapUpPort {
  readonly held: ReadonlyMap<string, WrapUpNote>;
  readonly handed: readonly WrapUpNote[];
}

/** A fresh performer: nothing held, and nothing handed to it yet. */
export function wrapUpStub(): WrapUpStub {
  const held = new Map<string, WrapUpNote>();
  const handed: WrapUpNote[] = [];
  const note = (effect: Effect, emission: Emission): Promise<void> => {
    const one: WrapUpNote = { effect, emission };
    handed.push(one);
    held.set(emissionKey(emission), one);
    return Promise.resolve();
  };
  return {
    held,
    handed,
    enqueueWrapUp: (emission) => note("EnqueueWrapUp", emission),
    openGate: (emission) => note("OpenGate", emission),
  };
}
