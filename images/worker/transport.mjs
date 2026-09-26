import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";

import {
  workerContractHeader,
  workerContractRelease,
} from "@chuggy/worker-contract/workerContract";

const attemptsMax = 15;
const retryMilliseconds = 2_000;
const serverErrorStatusMin = 500;

/** The headers every worker-plane request carries: the caller's own, its bearer, and the contract release this image was built with. */
export function workerPlaneHeaders(bearer, headers = {}) {
  return {
    authorization: `Bearer ${bearer}`,
    ...headers,
    [workerContractHeader]: workerContractRelease,
  };
}

/**
 * One request to the worker plane, retried while it fails.
 *
 * A RETRY IS FOR A CONDITION, NEVER FOR A DECISION. A thrown fetch and a server
 * error are retried; any other failing status is the plane's answer, and asking
 * again only delays the caller hearing it. So it raises at once, unless the
 * caller names it as settled — a credential this deployment does not mint — and
 * reads it instead.
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
  let failure;
  for (let attempt = 1; attempt <= attemptsMax; attempt += 1) {
    let response;
    try {
      response = await send(new URL(path, task.workerPlane.url), {
        ...init,
        headers: workerPlaneHeaders(bearer, init.headers),
      });
    } catch (thrown) {
      failure = thrown;
    }
    if (response !== undefined) {
      if (response.ok || settled.includes(response.status)) return response;
      failure = new Error(
        `worker plane ${path} answered ${String(response.status)}`,
      );
      if (response.status < serverErrorStatusMin) throw failure;
    }
    if (attempt === attemptsMax) throw failure;
    await pause(retryMilliseconds);
  }
  throw new Error("worker plane retry bound was exhausted");
}
