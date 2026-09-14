import assert from "node:assert/strict";
import { test } from "node:test";
import {
  endpointPath,
  nativeHttpEndpoints,
} from "../../src/contract/endpoints.ts";
import {
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "../../src/contract/http.ts";

test("endpoint paths encode opaque segments without substituting inside identities", () => {
  assert.equal(
    endpointPath(nativeHttpEndpoints.thread.path, {
      tenant: "t/:project",
      project: "p%20?",
      session: "s/雪",
    }),
    "/api/v1/tenants/t%2F%3Aproject/projects/p%2520%3F/threads/s%2F%E9%9B%AA",
  );
});

test("query defaults and absent cursors retain their transport meaning", () => {
  assert.deepEqual(nativeHttpEndpoints.thread.query.parse({}), {
    limit: threadTurnsAnsweredMax,
  });
  assert.deepEqual(nativeHttpEndpoints.threadTranscript.query.parse({}), {
    after: 0,
    limit: sessionStorePageBatchesMax,
  });
  assert.deepEqual(nativeHttpEndpoints.runTurns.query.parse({}), { limit: 50 });
  assert.deepEqual(nativeHttpEndpoints.runTranscript.query.parse({}), {
    after: 0,
  });
  assert.deepEqual(
    nativeHttpEndpoints.thread.query.parse({ before: "0", limit: "1" }),
    { before: 0, limit: 1 },
  );
});

test("endpoint queries retain canonical integer and unknown-field refusals", () => {
  for (const before of ["01", "-1", "1.0", " 1", ["1", "2"], 1])
    assert.throws(
      () => nativeHttpEndpoints.thread.query.parse({ before }),
      TypeError,
    );
  assert.throws(
    () =>
      nativeHttpEndpoints.thread.query.parse({ before: "9007199254740992" }),
    RangeError,
  );
  assert.throws(
    () => nativeHttpEndpoints.thread.query.parse({ unknown: "1" }),
    /request has an unknown field/u,
  );
  assert.throws(
    () =>
      nativeHttpEndpoints.threadTranscript.query.parse({ stream: ["a", "b"] }),
    /stream is not text/u,
  );
});

test("bodyless thread commands retain empty and null-body compatibility", () => {
  for (const endpoint of [
    nativeHttpEndpoints.openThread,
    nativeHttpEndpoints.closeThread,
  ]) {
    for (const body of [undefined, null, {}])
      assert.deepEqual(endpoint.body.parse(body), {});
    assert.throws(() => endpoint.body.parse({ extra: true }), TypeError);
  }
});
