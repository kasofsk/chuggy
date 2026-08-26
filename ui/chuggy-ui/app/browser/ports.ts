/**
 * The platform capabilities the decision layer takes as arguments.
 *
 * Every ambient thing this console touches — the clock, the network, the
 * timers, the draws, the digest, the two stores and the address bar — is
 * spelled once here, so `ui/chuggy-ui/app/core/` names none of them and a suite can hand it
 * something else. A store a browser refuses in a private window is read as
 * empty rather than thrown from.
 */

import type { FormRequest } from "../core/authorization.ts";
import type { ApiFetchInit } from "../core/apiRequest.ts";
import type { StreamResponse } from "../core/projectStream.ts";
import type { KeyValuePort } from "../core/sessionHolder.ts";

export function nowMs(): number {
  return Date.now();
}

export function drawBytes(count: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(count));
}

export async function digest(
  message: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", message));
}

export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("the wait was abandoned before it began"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abandon);
      resolve();
    }, ms);
    function abandon(): void {
      clearTimeout(timer);
      reject(new Error("the wait was abandoned"));
    }
    signal?.addEventListener("abort", abandon, { once: true });
  });
}

export function apiFetch(url: string, init: ApiFetchInit): Promise<Response> {
  return fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: init.signal,
    credentials: "omit",
    redirect: "error",
  });
}

/** The response is narrowed to what the stream reads, so a suite can fake it. */
export async function streamFetch(
  url: string,
  init: {
    readonly headers: Record<string, string>;
    readonly signal: AbortSignal;
  },
): Promise<StreamResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: init.headers,
    signal: init.signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  const body = response.body;
  return {
    status: response.status,
    body: body === null ? null : { getReader: () => body.getReader() },
  };
}

/** The token endpoints speak form encoding; `/config.json` and discovery, GET. */
export async function fetchJson(
  request: FormRequest | string,
): Promise<unknown> {
  const response =
    typeof request === "string"
      ? await fetch(request, { headers: { accept: "application/json" } })
      : await fetch(request.url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: request.body,
        });
  if (!response.ok)
    throw new Error(
      `${typeof request === "string" ? request : request.url} answered ${String(response.status)}`,
    );
  return response.json();
}

function keyValuePort(store: () => Storage): KeyValuePort {
  return {
    read: (key: string) => {
      try {
        return store().getItem(key);
      } catch {
        return null;
      }
    },
    write: (key: string, value: string) => {
      try {
        store().setItem(key, value);
      } catch {
        return;
      }
    },
    remove: (key: string) => {
      try {
        store().removeItem(key);
      } catch {
        return;
      }
    },
  };
}

export const persistentStore = keyValuePort(() => localStorage);
export const transientStore = keyValuePort(() => sessionStorage);

export function redirect(url: string): void {
  location.assign(url);
}
