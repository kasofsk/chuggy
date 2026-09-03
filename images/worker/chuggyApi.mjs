/**
 * The pod's one way to reach this installation's own API: `sessionTransport`'s
 * bounded retry, against `task.api.url` instead of the worker plane, under the
 * same session bearer. THERE IS NO SECOND CREDENTIAL — the API resolves that
 * bearer to the session's principal and authorizes every call through the
 * project membership exactly as it authorizes a console user's, so a tool call
 * is a command the session's own membership admits and nothing more.
 *
 * A READ IS RETRIED AND A WRITE IS NOT, and a read is exactly `GET` and `HEAD`.
 * A retry is for a condition; a write that was answered is a decision, and
 * asking again would either duplicate it or hide the refusal from the model the
 * answer is for. A read is asked again on a thrown transport AND on a server
 * error, because both are conditions and neither is an answer the caller can
 * act on; a write gets one attempt and whatever came back. The writes this
 * client makes are each fenced by the API on something the caller had to
 * supply — a project sequence, a draft version, an idempotency key — so a
 * duplicate that did escape would be refused rather than applied twice.
 *
 * THE RETRY BOUND IS UNDER THE TOOL TIMEOUT ON PURPOSE. A tool call is cut off
 * at `chuggyToolTimeoutMs`; a client that spent longer than that retrying would
 * be one whose every failure reaches the model as a timeout with no status in
 * it, which is the one thing a relayed answer exists to prevent.
 *
 * A REDIRECT IS AN ANSWER. Following one would send the bearer to whatever the
 * `location` named, so the status is returned and the tool relays it.
 */

import { Buffer } from "node:buffer";
import { setTimeout as wait } from "node:timers/promises";
import { URL } from "node:url";
import { TextDecoder } from "node:util";

/** The media type both directions of this API are written in. */
export const chuggyMediaType = "application/vnd.chuggy.v1+json";

/** The versioned base path built onto the origin `task.api.url` names. */
export const chuggyBasePath = "/api/v1";

/** How many times one read is asked, and how long between two asks. */
export const chuggyRequestAttemptsMax = 3;
export const chuggyRequestRetryMs = 1_000;

const serverErrorStatusMin = 500;
const readMethods = new Set(["GET", "HEAD"]);

/** Whether a method is one this client may ask a second time. */
export function chuggyRequestIsRead(init) {
  return readMethods.has((init?.method ?? "GET").toUpperCase());
}

/**
 * One call to the API under the session bearer. `path` is the whole versioned
 * path and query; `task.api.url` is an origin and never carries one.
 */
export async function chuggyRequest(
  task,
  bearer,
  path,
  init = {},
  transport = { fetch: globalThis.fetch, wait },
) {
  const origin = task?.api?.url;
  if (typeof origin !== "string" || origin.length === 0)
    throw new Error("the session was placed with no API origin");
  // A pod with no bearer would otherwise send `Bearer undefined` and read the
  // API's 401 back as its own membership refusing it, which is the one thing a
  // relayed answer must not let the model conclude.
  if (typeof bearer !== "string" || bearer.length === 0)
    throw new Error("the session was placed with no bearer");
  const retries = chuggyRequestIsRead(init) ? chuggyRequestAttemptsMax : 1;
  let refusal;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await transport.fetch(new URL(path, origin), {
        ...init,
        // After the spread, not before it: the bearer and the refusal to follow
        // a redirect are this client's properties and not each caller's to
        // choose. A caller reaching either would be the one thing an `init` may
        // not do.
        redirect: "manual",
        headers: {
          ...init.headers,
          authorization: `Bearer ${bearer}`,
          accept: chuggyMediaType,
        },
      });
      if (response.status < serverErrorStatusMin) return response;
      if (attempt === retries) return response;
      refusal = undefined;
    } catch (failure) {
      refusal = failure;
      if (attempt === retries) throw refusal;
    }
    await transport.wait(chuggyRequestRetryMs);
  }
  throw refusal ?? new Error("the API retry bound was exhausted");
}

/**
 * What one answer weighs, never more than the bound, and whether it was cut.
 * The body is drawn a chunk at a time and abandoned at the bound rather than
 * read whole and sliced, because a project's history is larger than a pod's
 * memory and a tool answer is charged to the turn's tokens either way.
 */
export async function chuggyBoundedBody(response, bytesMax) {
  const stream = response.body;
  if (stream === undefined || stream === null || stream.getReader === undefined)
    return cutText(await response.text(), bytesMax);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes > bytesMax)
        return { text: cutBytes(text, bytesMax), cut: true };
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { text: text + decoder.decode(), cut: false };
}

function cutText(text, bytesMax) {
  const cut = cutBytes(text, bytesMax);
  return { text: cut, cut: cut.length !== text.length };
}

/** The longest prefix of `text` whose UTF-8 encoding fits, cut on a character. */
function cutBytes(text, bytesMax) {
  if (Buffer.byteLength(text) <= bytesMax) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle)) <= bytesMax) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low);
}
