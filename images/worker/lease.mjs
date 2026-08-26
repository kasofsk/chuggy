import { workerRequest } from "./transport.mjs";

export const heartbeatIntervalMilliseconds = 60_000;

export function keepWorkerLease(
  task,
  bearer,
  services = {
    request: workerRequest,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
) {
  let pending;
  let failure;
  const heartbeat = () => {
    if (pending !== undefined) return;
    pending = services
      .request(task, bearer, "/v1/heartbeat", { method: "POST" })
      .catch((error) => {
        failure ??= error;
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = services.setInterval(heartbeat, heartbeatIntervalMilliseconds);
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    services.clearInterval(timer);
    await pending;
    if (failure !== undefined) throw failure;
  };
}
