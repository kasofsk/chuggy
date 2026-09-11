import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";

const attemptsMax = 15;
const retryMilliseconds = 2_000;

/**
 * One request to the worker plane, retried while it fails.
 *
 * A STATUS THE CALLER NAMES AS SETTLED IS AN ANSWER RATHER THAN A FAILURE.
 * Asking again for something the plane has already decided gets the same answer
 * fifteen times before the caller is told anything, so a route whose refusal the
 * pod acts on — a credential this deployment does not mint — names that status
 * here and reads it. Everything else is a condition, and is retried.
 */
export async function workerRequest(
  task,
  bearer,
  path,
  init = {},
  transport = {},
) {
  const {
    fetch: send = globalThis.fetch,
    wait: pause = wait,
    settled = [],
  } = transport;
  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    try {
      const response = await send(new URL(path, task.workerPlane.url), {
        ...init,
        headers: { authorization: `Bearer ${bearer}`, ...init.headers },
      });
      if (!response.ok && !settled.includes(response.status))
        throw new Error(
          `worker plane ${path} answered ${String(response.status)}`,
        );
      return response;
    } catch (failure) {
      if (attempt === attemptsMax) throw failure;
      await pause(retryMilliseconds);
    }
  }
  throw new Error("worker plane retry bound was exhausted");
}
