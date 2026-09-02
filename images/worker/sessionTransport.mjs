/**
 * The session pod's one way to reach the worker plane: `workerRequest`'s bounded
 * retry, against the same base URL and under the session bearer.
 *
 * A RETRY IS FOR A CONDITION, NEVER FOR A DECISION. The session routes answer
 * `stop` and `retry` as distinct things — a fenced attempt is `401`, a batch
 * that changed under its own number is `409`, an exhausted store is `413` — and
 * asking any of those again gets the same answer fifteen times before the caller
 * is told anything. So a thrown fetch and a server error are retried and every
 * other status is returned for the caller to read.
 */

import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";

const attemptsMax = 15;
const retryMilliseconds = 2_000;
const retryAfterMillisecondsMax = 60_000;
const serverErrorStatusMin = 500;

/** How long the plane asked to be left alone for, inside this module's own cap. */
function retryDelay(response) {
  const asked = Number.parseInt(
    response?.headers?.get?.("retry-after") ?? "",
    10,
  );
  if (!Number.isSafeInteger(asked) || asked <= 0) return retryMilliseconds;
  return Math.min(asked * 1_000, retryAfterMillisecondsMax);
}

export async function sessionRequest(
  task,
  bearer,
  path,
  init = {},
  transport = { fetch: globalThis.fetch, wait },
) {
  let refusal;
  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    let delay = retryMilliseconds;
    try {
      const response = await transport.fetch(
        new URL(path, task.workerPlane.url),
        {
          ...init,
          headers: { authorization: `Bearer ${bearer}`, ...init.headers },
        },
      );
      if (response.status < serverErrorStatusMin) return response;
      refusal = new Error(
        `worker plane ${path} answered ${String(response.status)}`,
      );
      delay = retryDelay(response);
    } catch (failure) {
      refusal = failure;
    }
    if (attempt === attemptsMax) throw refusal;
    await transport.wait(delay);
  }
  throw refusal ?? new Error("worker plane retry bound was exhausted");
}

/** What the plane says when the answer is a decision the pod may not retry past. */
export function sessionStopped(response) {
  return response.status === 401 || response.status === 409;
}
