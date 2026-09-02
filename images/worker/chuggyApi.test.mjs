import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  chuggyBoundedBody,
  chuggyMediaType,
  chuggyRequest,
  chuggyRequestAttemptsMax,
  chuggyRequestIsRead,
} from "./chuggyApi.mjs";

const task = { api: { url: "https://api.test:8443" } };
const bearer = "chgs_0123456789abcdef0123456789abcdef";

function transportOf(answers) {
  const calls = [];
  const waits = [];
  return {
    calls,
    waits,
    transport: {
      fetch: async (url, init) => {
        calls.push({ url: url.toString(), init });
        const given = answers[Math.min(calls.length - 1, answers.length - 1)];
        if (given instanceof Error) throw given;
        return given;
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  };
}

function bodyOf(text) {
  const bytes = Buffer.from(text);
  return {
    status: 200,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

test("every call carries the session bearer, the media type and no redirect", async () => {
  const { calls, transport } = transportOf([{ status: 200 }]);

  await chuggyRequest(task, bearer, "/api/v1/projects", {}, transport);

  assert.equal(calls[0].url, "https://api.test:8443/api/v1/projects");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${bearer}`);
  assert.equal(calls[0].init.headers.accept, chuggyMediaType);
  assert.equal(calls[0].init.redirect, "manual");
});

test("a read is asked again after a server error and a write never is", async () => {
  const read = transportOf([{ status: 503 }, { status: 503 }, { status: 200 }]);

  const answer = await chuggyRequest(task, bearer, "/p", {}, read.transport);

  assert.equal(answer.status, 200);
  assert.equal(read.calls.length, chuggyRequestAttemptsMax);

  const write = transportOf([{ status: 503 }, { status: 200 }]);

  const refused = await chuggyRequest(
    task,
    bearer,
    "/p",
    { method: "POST" },
    write.transport,
  );

  assert.equal(
    refused.status,
    503,
    "a write that was answered was asked again",
  );
  assert.equal(write.calls.length, 1);
});

test("no write method is retried, however many times the API answers 5xx", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "delete"]) {
    const { calls, waits, transport } = transportOf([
      { status: 503 },
      { status: 200 },
    ]);

    const answer = await chuggyRequest(
      task,
      bearer,
      "/p",
      { method },
      transport,
    );

    assert.equal(calls.length, 1, `${method} was asked again`);
    assert.equal(answer.status, 503, method);
    assert.deepEqual(waits, [], `${method} waited to ask again`);
  }
});

test("only GET and HEAD are the methods this client may ask twice", () => {
  assert.equal(chuggyRequestIsRead({ method: "GET" }), true);
  assert.equal(chuggyRequestIsRead({ method: "head" }), true);
  assert.equal(chuggyRequestIsRead({}), true);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"])
    assert.equal(chuggyRequestIsRead({ method }), false, method);
});

test("no init may take the bearer off a call or make it follow a redirect", async () => {
  const { calls, transport } = transportOf([{ status: 200 }]);

  await chuggyRequest(
    task,
    bearer,
    "/p",
    {
      method: "POST",
      redirect: "follow",
      headers: { authorization: "Bearer someone-else", accept: "text/html" },
    },
    transport,
  );

  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${bearer}`);
  assert.equal(calls[0].init.headers.accept, chuggyMediaType);
});

test("a write whose transport threw is not retried into a second command", async () => {
  const { calls, transport } = transportOf([
    new Error("socket hang up"),
    { status: 200 },
  ]);

  await assert.rejects(
    chuggyRequest(task, bearer, "/p", { method: "POST" }, transport),
    /socket hang up/,
  );
  assert.equal(calls.length, 1);
});

test("a session placed with no API origin cannot call one", async () => {
  await assert.rejects(
    chuggyRequest(
      {},
      bearer,
      "/p",
      {},
      transportOf([{ status: 200 }]).transport,
    ),
    /no API origin/,
  );
});

test("a body over the bound is cut on a character and says it was cut", async () => {
  const whole = await chuggyBoundedBody(bodyOf("kestrel"), 1_024);
  assert.deepEqual(whole, { text: "kestrel", cut: false });

  const cut = await chuggyBoundedBody(bodyOf("ééééé"), 4);

  assert.equal(cut.cut, true);
  assert.equal(cut.text, "éé");
  assert.ok(Buffer.byteLength(cut.text) <= 4);
});

test("a response that answers only text is bounded the same way", async () => {
  const cut = await chuggyBoundedBody(
    { status: 200, text: async () => "0123456789" },
    4,
  );

  assert.deepEqual(cut, { text: "0123", cut: true });
});
