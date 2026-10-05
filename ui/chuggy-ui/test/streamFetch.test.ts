/**
 * The stream's fetch port: the browser's response narrowed to what the
 * transport reads of it, which includes the wait a server with no room names.
 */

import { afterEach, expect, test, vi } from "vitest";

import { streamFetch } from "../app/browser/ports.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function answered(response: Response): { readonly asked: RequestInit[] } {
  const asked: RequestInit[] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    asked.push(init);
    return Promise.resolve(response);
  });
  return { asked };
}

const init = {
  headers: { accept: "text/event-stream" },
  signal: new AbortController().signal,
};

test("a server with no room is handed over with the wait it named", async () => {
  answered(
    new Response(null, { status: 503, headers: { "retry-after": "7" } }),
  );
  const response = await streamFetch("/live", init);
  expect(response.status).toBe(503);
  expect(response.retryAfter).toBe("7");
  expect(response.body).toBeNull();
});

test("an answer naming no wait hands none over, and its body is one to read", async () => {
  const { asked } = answered(new Response("data: {}\n\n", { status: 200 }));
  const response = await streamFetch("/live", init);
  expect(response.retryAfter).toBeUndefined();
  const read = await response.body?.getReader().read();
  expect(new TextDecoder().decode(read?.value)).toBe("data: {}\n\n");
  expect(asked[0]).toMatchObject({ method: "GET", headers: init.headers });
});
