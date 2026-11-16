/**
 * The routes whose contract body reads an absent body as empty, as the API
 * answers a write that carries none: reached however it is framed, while a body
 * that is carried is still the API's media type alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { callerApp } from "./callerAppFixture.ts";

const member = asPrincipal("member");
const asked: string[] = [];

/** A merge door and a take door, each answering NotFound to every write it is asked. */
function emptyBodyApp() {
  return callerApp(member, {
    proposalMerges: {
      merge: () => {
        asked.push("merge");
        return Promise.resolve({ result: "NotFound" });
      },
    },
    takes: {
      write: (_principal, _partition, _ticket, kind) => {
        asked.push(kind);
        return Promise.resolve({ result: "NotFound" });
      },
    },
  });
}

const doors = [
  ["merge", nativeHttpRoutes.ticketProposalMerge],
  ["Take", nativeHttpRoutes.ticketTake],
] as const;

function pathOf(route: string): string {
  return route
    .replace(":tenant", "acme")
    .replace(":project", "atlas")
    .replace(":ticket", "999999");
}

/** A bodiless write's framings: none at all, a zero length, an empty chunked body, and an empty body under a media type. */
const bodylessFramings: readonly (readonly [
  Record<string, string>,
  string?,
])[] = [
  [{}],
  [{ "content-length": "0" }, ""],
  [{ "transfer-encoding": "chunked" }, ""],
  [{ "content-type": nativeHttpMediaType }, ""],
  [{ "content-type": "application/octet-stream" }, ""],
];

test("a write carrying no body reaches an empty-body door however it is framed", async () => {
  asked.length = 0;
  await using app = emptyBodyApp();
  for (const [name, route] of doors)
    for (const [framing, payload] of bodylessFramings) {
      const answered = await app.inject({
        method: "POST",
        url: pathOf(route),
        headers: { authorization: "Bearer valid", ...framing },
        ...(payload === undefined ? {} : { payload }),
      });
      const label = `${name} ${JSON.stringify(framing)}`;
      assert.equal(answered.statusCode, 404, label);
      assert.equal(
        errorEnvelopeSchema.parse(answered.json()).error.code,
        "NotFound",
        label,
      );
    }
  assert.deepEqual(asked, [
    ...Array<string>(bodylessFramings.length).fill("merge"),
    ...Array<string>(bodylessFramings.length).fill("Take"),
  ]);
});

test("a body an empty-body door is sent is read under the API's media type and refused under any other or none", async () => {
  asked.length = 0;
  await using app = emptyBodyApp();
  for (const [name, route] of doors) {
    const write = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: pathOf(route),
        headers: { authorization: "Bearer valid", ...headers },
        payload: "{}",
      });
    assert.equal(
      (await write({ "content-type": nativeHttpMediaType })).statusCode,
      404,
      name,
    );
    for (const headers of [{}, { "content-type": "application/json" }])
      assert.equal(
        (await write(headers)).statusCode,
        415,
        `${name} ${JSON.stringify(headers)}`,
      );
  }
  assert.deepEqual(asked, ["merge", "Take"]);
});
