/**
 * The one place the console touches the network.
 *
 * A request descriptor goes in and a classified outcome comes out; no caller
 * sees a status code or a thrown fetch. The abort bound sits above the
 * server's own request timeout, so a stalled socket ends as an outcome the
 * console can draw rather than as a promise nothing settles.
 */

import { classify } from "../app/protocol.js";

export const transportTimeoutMs = 20_000;

/**
 * @param {{ method: string, url: string, headers: Record<string, string>,
 *   body?: string }} request
 */
export async function send(request) {
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, transportTimeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: abort.signal,
      credentials: "omit",
      cache: "no-store",
    });
    return classify(
      response.status,
      (name) => response.headers.get(name),
      await readBody(response),
    );
  } catch {
    return { outcome: "Fault", code: "Unreachable", status: 0 };
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

/** A JSON read outside the API, used for the runtime configuration and discovery. */
export async function readJson(url) {
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok)
    throw new Error(`${url} answered ${String(response.status)}`);
  return response.json();
}
