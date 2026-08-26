/**
 * Node's timers, as the project stream hub's clock.
 *
 * Every handle is unreferenced: a heartbeat or a lifetime is a bound on work
 * already in flight, never a reason for the process to stay alive.
 */

import type {
  ProjectStreamTimer,
  ProjectStreamTimers,
} from "../../interpreter/projectStream.ts";

export const systemStreamTimers: ProjectStreamTimers = {
  repeat: (everyMs, tick) => {
    const handle = setInterval(tick, everyMs);
    handle.unref();
    return {
      cancel: () => {
        clearInterval(handle);
      },
    } satisfies ProjectStreamTimer;
  },
  once: (afterMs, tick) => {
    const handle = setTimeout(tick, afterMs);
    handle.unref();
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    } satisfies ProjectStreamTimer;
  },
  nowMs: () => Date.now(),
};
