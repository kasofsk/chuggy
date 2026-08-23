import { setTimeout } from "node:timers/promises";

import type { RuntimePacing } from "../../interpreter/serviceRuntime.ts";

/** Paces process quanta with Node's abortable timer. */
export const systemPacing: RuntimePacing = {
  wait: async (milliseconds, signal) => {
    try {
      await setTimeout(milliseconds, undefined, { signal });
    } catch (error: unknown) {
      if (!signal.aborted) throw error;
    }
  },
};
