import assert from "node:assert/strict";
import test from "node:test";

import { httpBoundedText } from "../../src/adapters/http/boundedResponse.ts";

test("an answer inside the bound is read whole", async () => {
  assert.equal(await httpBoundedText(new Response("token"), 64), "token");
});

test("an answer past the bound is nothing rather than a prefix", async () => {
  assert.equal(await httpBoundedText(new Response("0123456789"), 4), undefined);
});

test("an answer with no body at all is the empty one", async () => {
  assert.equal(
    await httpBoundedText(new Response(null, { status: 204 }), 64),
    "",
  );
});

test("a body arriving in pieces is bounded across all of them", async () => {
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode("0123"));
      controller.enqueue(new TextEncoder().encode("4567"));
      controller.close();
    },
  });
  assert.equal(await httpBoundedText(new Response(body), 6), undefined);
});
