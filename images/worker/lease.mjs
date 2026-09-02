import { workerRequest } from "./transport.mjs";

export const heartbeatIntervalMilliseconds = 60_000;

/**
 * The lease a pod keeps while it holds an attempt. The path is a parameter
 * because a work attempt and a session attempt are leased on different routes
 * and by nothing else different.
 */
export function keepWorkerLease(task, bearer, services = {}) {
  const {
    request = workerRequest,
    setInterval: schedule = globalThis.setInterval,
    clearInterval: unschedule = globalThis.clearInterval,
    path = "/v1/heartbeat",
  } = services;
  let pending;
  let failure;
  const heartbeat = () => {
    if (pending !== undefined) return;
    pending = request(task, bearer, path, { method: "POST" })
      .catch((error) => {
        failure ??= error;
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = schedule(heartbeat, heartbeatIntervalMilliseconds);
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    unschedule(timer);
    await pending;
    if (failure !== undefined) throw failure;
  };
}
