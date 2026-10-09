/**
 * The session's JSON request, over a fetch that is no browser's.
 *
 * What is checked is what each kind of request is sent as and what each way of
 * failing rejects with: no answer, a refused status, a body lost on the way
 * and a body that is not JSON. The last case is the browser's own port, which
 * hands its `fetch` exactly what the core built.
 */

import { afterEach, expect, test, vi } from "vitest";

import { fetchJson } from "../app/browser/ports.ts";
import { FetchJsonError, fetchJsonThrough } from "../app/core/sessionHolder.ts";
import type {
  FetchJsonInit,
  FetchJsonPort,
  FetchJsonResponse,
} from "../app/core/sessionHolder.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const tokenRequest = {
  url: "https://auth.example/oauth2/token",
  body: "grant_type=refresh_token&refresh_token=renew",
};

const tokenInit = {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  },
  body: tokenRequest.body,
};

interface Fetching {
  readonly fetch: FetchJsonPort;
  readonly asked: { readonly url: string; readonly init: FetchJsonInit }[];
  /** How many times an answer's body was read. */
  readonly read: () => number;
}

/** A fetch answering `status` with `body`, where `body` as an error is one
 * lost on the way and `status` as an error is no answer at all. */
function fetching(status: number | Error, body: string | Error = ""): Fetching {
  const asked: Fetching["asked"] = [];
  let read = 0;
  const text: FetchJsonResponse["text"] = () => {
    read += 1;
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body);
  };
  return {
    asked,
    read: () => read,
    fetch: (url, init) => {
      asked.push({ url, init });
      if (typeof status !== "number") return Promise.reject(status);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text,
      });
    },
  };
}

/** What a request rejected with, failing the case where it was answered. */
async function rejection(request: Promise<unknown>): Promise<unknown> {
  try {
    await request;
  } catch (failure: unknown) {
    return failure;
  }
  throw new Error("the request was answered");
}

test("an address is asked for as a GET that accepts JSON, and its body is handed back parsed", async () => {
  const held = fetching(200, '{"issuer":"https://auth.example/"}');

  const value = await fetchJsonThrough(held.fetch, "/config.json");

  expect(value).toEqual({ issuer: "https://auth.example/" });
  expect(held.asked).toStrictEqual([
    { url: "/config.json", init: { headers: { accept: "application/json" } } },
  ]);
});

test("a form request is posted to its own address as a form", async () => {
  const held = fetching(200, '{"access_token":"access"}');

  const value = await fetchJsonThrough(held.fetch, tokenRequest);

  expect(value).toEqual({ access_token: "access" });
  expect(held.asked).toStrictEqual([
    { url: tokenRequest.url, init: tokenInit },
  ]);
});

test("a request that got no answer rejects as unanswered, with what the network said", async () => {
  const held = fetching(new TypeError("Failed to fetch"));

  const failure = await rejection(fetchJsonThrough(held.fetch, "/config.json"));

  expect(failure).toBeInstanceOf(FetchJsonError);
  expect(failure).toMatchObject({
    fault: { fault: "Unanswered" },
    message: "Failed to fetch",
  });
});

/** A value shaped like an error and not one of this realm's, as one thrown
 * across a frame is. */
const foreign: Error = { name: "TypeError", message: "Failed to fetch" };

test("a failure that is no Error rejects as unanswered, with wording of its own", async () => {
  const held = fetching(foreign);

  const failure = await rejection(fetchJsonThrough(held.fetch, "/config.json"));

  expect(failure).toBeInstanceOf(FetchJsonError);
  expect(failure).toMatchObject({
    fault: { fault: "Unanswered" },
    message: "the request got no answer",
  });
});

test("a refused status rejects with that status and the address asked, its body unread", async () => {
  const held = fetching(404, "{}");

  const failure = await rejection(fetchJsonThrough(held.fetch, tokenRequest));

  expect(failure).toBeInstanceOf(FetchJsonError);
  expect(failure).toMatchObject({
    fault: { fault: "Status", status: 404 },
    message: `${tokenRequest.url} answered 404`,
  });
  expect(held.read()).toBe(0);
});

test("a body lost on the way rejects as unanswered, not as a body that is not JSON", async () => {
  const held = fetching(200, new TypeError("network error"));

  const failure = await rejection(fetchJsonThrough(held.fetch, "/config.json"));

  expect(failure).toBeInstanceOf(FetchJsonError);
  expect(failure).toMatchObject({
    fault: { fault: "Unanswered" },
    message: "network error",
  });
});

test("a body that is not JSON rejects with the parser's own error", async () => {
  const held = fetching(200, "<!doctype html>");

  const failure = await rejection(fetchJsonThrough(held.fetch, "/config.json"));

  expect(failure).toBeInstanceOf(SyntaxError);
  expect(failure).not.toBeInstanceOf(FetchJsonError);
});

test("the browser's port hands its fetch what the core built, and nothing of its own", async () => {
  const asked: unknown[][] = [];
  vi.stubGlobal("fetch", (...handed: unknown[]) => {
    asked.push(handed);
    return Promise.resolve(new Response('{"access_token":"access"}'));
  });

  const value = await fetchJson(tokenRequest);

  expect(value).toEqual({ access_token: "access" });
  expect(asked).toStrictEqual([[tokenRequest.url, tokenInit]]);
});
