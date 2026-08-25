import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";

const attemptsMax = 15;
const retryMilliseconds = 2_000;

export async function workerRequest(
  task,
  bearer,
  path,
  init = {},
  transport = { fetch: globalThis.fetch, wait },
) {
  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    try {
      const response = await transport.fetch(
        new URL(path, task.workerPlane.url),
        {
          ...init,
          headers: { authorization: `Bearer ${bearer}`, ...init.headers },
        },
      );
      if (!response.ok)
        throw new Error(
          `worker plane ${path} answered ${String(response.status)}`,
        );
      return response;
    } catch (failure) {
      if (attempt === attemptsMax) throw failure;
      await transport.wait(retryMilliseconds);
    }
  }
  throw new Error("worker plane retry bound was exhausted");
}
