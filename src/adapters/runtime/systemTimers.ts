import type { ProjectStreamTimers } from "../../interpreter/projectStream.ts";

/**
 * The project stream's timers over Node's own, unreferenced so that a stream
 * left open does not hold the process past the drain a signal answers.
 */
export const systemTimers: ProjectStreamTimers = {
  repeat: (everyMs, tick) => {
    const handle = setInterval(tick, everyMs);
    handle.unref();
    return {
      cancel: () => {
        clearInterval(handle);
      },
    };
  },
  once: (afterMs, tick) => {
    const handle = setTimeout(tick, afterMs);
    handle.unref();
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  },
  nowMs: () => Date.now(),
};
