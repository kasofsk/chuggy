/**
 * The platform capabilities the decision layer takes as arguments.
 *
 * Every ambient thing this console touches — the clock, the network, the
 * timers, the draws, the digest, the two stores, the cookies, the address bar
 * and the worker — is spelled once here, so `ui/chuggy-ui/app/core/` names none of them and a suite can hand it
 * something else. A store a browser refuses in a private window is read as
 * empty rather than thrown from.
 */

import type { FormRequest } from "../core/authorization.ts";
import type { ApiFetchInit } from "../core/apiRequest.ts";
import type { StreamResponse } from "../core/streamConnection.ts";
import { fetchJsonThrough } from "../core/sessionHolder.ts";
import type { KeyValuePort, SessionLocation } from "../core/sessionHolder.ts";
import type { MarkdownSyntaxWorker } from "./ui/markdownSyntax.ts";

export function nowMs(): number {
  return Date.now();
}

/** Milliseconds that never go back, for telling how long something took. */
export function elapsedMs(): number {
  return performance.now();
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
    retryAfter: response.headers.get("retry-after") ?? undefined,
  };
}

/** How long a request for JSON is waited on, body and all. A renewal keeps
 * every other document of the origin from renewing until its own is answered. */
export const fetchJsonWaitMs = 20_000;

export function fetchJson(request: FormRequest | string): Promise<unknown> {
  const waited = new AbortController();
  const timer = setTimeout(() => {
    waited.abort();
  }, fetchJsonWaitMs);
  return fetchJsonThrough(
    (url, init) => fetch(url, { ...init, signal: waited.signal }),
    request,
  ).finally(() => {
    clearTimeout(timer);
  });
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

/** Tells `heard` each time another document of this origin changes the
 * persistent store. The document that made the change is not told. */
export function persistentChangeHeard(heard: () => void): void {
  addEventListener("storage", heard);
}

/**
 * Runs `body` while no other document of this origin is running one under
 * `name`, by the Web Locks API, rejecting where the turn did not come within
 * `waitMs`, and at once where the browser has no such API or withholds it.
 * Only a document that is shown waits: a browser grants a waiting request to
 * a document it has frozen, whose body cannot run, so the wait is given up as
 * the document is hidden and asked afresh if it is shown again.
 */
export function exclusively<T>(
  name: string,
  waitMs: number,
  body: () => Promise<T>,
): Promise<T> {
  if (!("locks" in navigator)) return body();
  return new Promise<T>((resolve) => {
    let leave: (() => void) | undefined;
    const ended = (): void => {
      removeEventListener("pagehide", hidden);
      removeEventListener("pageshow", shown);
    };
    function ask(): void {
      const waited = new AbortController();
      const timer = setTimeout(() => {
        waited.abort();
      }, waitMs);
      let left = false;
      leave = () => {
        left = true;
        waited.abort();
      };
      const asked = navigator.locks.request(
        name,
        { signal: waited.signal },
        () => {
          clearTimeout(timer);
          ended();
          return body();
        },
      );
      const answered = (): void => {
        clearTimeout(timer);
        if (left) return;
        ended();
        resolve(asked);
      };
      asked.then(answered, answered);
    }
    function hidden(): void {
      leave?.();
      leave = undefined;
    }
    function shown(): void {
      if (leave === undefined) ask();
    }
    addEventListener("pagehide", hidden);
    addEventListener("pageshow", shown);
    ask();
  });
}

export function redirect(url: string): void {
  location.assign(url);
}

/** Leaves this document for another address in this entry's place, so Back does not return to the one left. */
export function replaceLocation(url: string): void {
  location.replace(url);
}

/** Loads this document again, at the address and the fragment it is at. */
export function reloadLocation(): void {
  location.reload();
}

/** Tells `heard` each time the fragment changes under this document, which loads nothing. */
export function anchorHeard(heard: () => void): void {
  addEventListener("hashchange", heard);
}

/** Tells `heard` each time the browser shows this document again as it was left, out of its back-forward cache; the answer stops the telling. */
export function pageRestoredHeard(heard: () => void): () => void {
  const shown = (event: PageTransitionEvent): void => {
    if (event.persisted) heard();
  };
  addEventListener("pageshow", shown);
  return () => {
    removeEventListener("pageshow", shown);
  };
}

/** Every cookie a script may read here, none where the browser refuses the read. */
export function cookiesRead(): string {
  try {
    return document.cookie;
  } catch {
    return "";
  }
}

/** Hands the browser one cookie to keep or to end. */
export function cookieWritten(line: string): void {
  try {
    document.cookie = line;
  } catch {
    return;
  }
}

/** This console's own origin, where its API answers and where a forge is told to return an authorization. */
export function currentOrigin(): string {
  return location.origin;
}

/** Puts text on the clipboard, answering whether the browser allowed it. */
export async function clipboardWritten(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Where this tab is, as the path and query a sign-in's return is read from. */
export function currentLocation(): SessionLocation {
  return { pathname: location.pathname, search: location.search };
}

/** Moves the address without a navigation, so nothing the tab holds is lost. */
export function replacePath(path: string): void {
  history.replaceState(null, "", path);
}

/** Where this tab is, as the path something that leaves it returns to. */
export function currentPath(): string {
  return `${location.pathname}${location.search}`;
}

/** The anchor this tab was opened at, without its `#`. */
export function currentAnchor(): string {
  return location.hash.slice(1);
}

/**
 * Starts the worker that colours code, this console's own module on its own
 * thread. `heard` is told what it says, and `{ failed: true }` where it could
 * not be loaded or broke.
 */
export function syntaxWorkerOpened(
  heard: (message: unknown) => void,
): MarkdownSyntaxWorker {
  const worker = new Worker(
    new URL("./ui/markdownSyntaxWorker.ts", import.meta.url),
    { type: "module" },
  );
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    heard(event.data);
  });
  worker.addEventListener("error", () => {
    heard({ failed: true });
  });
  return {
    ask: (asked) => {
      worker.postMessage(asked);
    },
    end: () => {
      worker.terminate();
    },
  };
}
