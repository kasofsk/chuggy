/**
 * The one place the console touches the network.
 *
 * Every request goes out under the same abort bound, which sits above the
 * server's own request timeout, so a stalled socket ends as a value the caller
 * can draw rather than as a promise nothing settles. A request descriptor goes
 * in and a classified outcome comes out; no caller sees a status code or a
 * thrown fetch.
 */

import { classify } from "../app/protocol.js";

export const transportTimeoutMs = 20_000;

/**
 * @param {string} url
 * @param {RequestInit} options
 */
async function bounded(url, options) {
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, transportTimeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: abort.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** An empty or unparsable body is no body; the status still classifies. */
async function readBody(response) {
  try {
    const text = await response.text();
    return text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * @param {{ method: string, url: string, headers: Record<string, string>,
 *   body?: string }} request
 */
export async function send(request) {
  try {
    const response = await bounded(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    return classify(
      response.status,
      (name) => response.headers.get(name),
      await readBody(response),
    );
  } catch {
    return { outcome: "Fault", code: "Unreachable", status: 0 };
  }
}

/**
 * A JSON read outside the API, used for the runtime configuration, for
 * discovery and for the token exchange. It rejects rather than classifying,
 * because its three callers are boot steps with their own drawn failures.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 */
export async function readJson(url, options) {
  const response = await bounded(url, options ?? {});
  if (!response.ok)
    throw new Error(`${url} answered ${String(response.status)}`);
  return response.json();
}
