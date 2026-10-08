/**
 * The shared bounded request: what it sends, the status and JSON it answers,
 * and each way of not answering raised as one fault.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundedJsonRequest,
  BoundedJsonUnanswered,
} from "../../src/interpreter/boundedJsonRequest.ts";
import { fixtureForge } from "../adapters/forgeFixtures.ts";

function asked(answer: Response | Error, body?: unknown) {
  const forge = fixtureForge([answer]);
  return {
    forge,
    answer: boundedJsonRequest({
      fetcher: forge.requestFetch,
      url: new URL("http://directory.invalid/things?x=1"),
      method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(1_000),
      bytesMax: 16,
      readsMax: 2,
      ...(body === undefined ? {} : { body }),
    }),
  };
}

test("a body is sent as JSON with no redirect followed, and any status is answered with its JSON", async () => {
  const { forge, answer } = asked(new Response('{"a":1}', { status: 409 }), {
    b: 2,
  });
  assert.deepEqual(await answer, { status: 409, json: { a: 1 } });
  assert.deepEqual(forge.calls[0]?.headers, {
    accept: "application/json",
    "content-type": "application/json",
  });
  assert.equal(forge.calls[0]?.body, '{"b":2}');
  assert.equal(forge.calls[0]?.redirect, "error");
});

test("an empty body and one that is not JSON are answered as no JSON", async () => {
  for (const body of ["", "not json", new Uint8Array([0xff])])
    assert.deepEqual(await asked(new Response(body, { status: 200 })).answer, {
      status: 200,
      json: undefined,
    });
});

test("no connection, a body past the byte bound, and one past the read bound are each unanswered", async () => {
  const chunked = (chunks: readonly string[]) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
    );
  for (const answer of [
    new TypeError("refused"),
    new Response("x".repeat(17)),
    chunked(["1", "2", "3"]),
  ])
    await assert.rejects(asked(answer).answer, BoundedJsonUnanswered);
  assert.deepEqual(await asked(chunked(["[1", "]"])).answer, {
    status: 200,
    json: [1],
  });
});
