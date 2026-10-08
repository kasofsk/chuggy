/**
 * The GitHub account lookup against a recording forge answering what GitHub
 * answered: a known name, an unknown one, each refusal and outage, and that
 * nothing GitHub wrote in free text is kept.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { githubUserLookup } from "../../src/adapters/forge/githubUserLookup.ts";
import { fixtureForge } from "./forgeFixtures.ts";

const marker = "MARKER-not-for-a-response";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A known account as GitHub answered it, trimmed to the fields around the ones read. */
function user(type: string): Response {
  return json({
    login: "Octo-Cat",
    id: 990000001,
    node_id: marker,
    type,
    name: marker,
    bio: marker,
  });
}

async function looked(answer: Response | Error) {
  const forge = fixtureForge([answer]);
  const lookup = await githubUserLookup({ fetch: forge.requestFetch }).lookup(
    "octo-cat",
  );
  return { lookup, forge };
}

test("a known name answers the numeric id as text, the login as GitHub spells it, and its kind, asked with no credential", async () => {
  const { lookup, forge } = await looked(user("User"));
  assert.deepEqual(lookup, {
    looked: "Found",
    account: { id: "990000001", login: "Octo-Cat" },
    kind: "User",
  });
  assert.ok(!JSON.stringify(lookup).includes(marker));
  const [call] = forge.calls;
  assert.equal(call?.url, "https://api.github.com/users/octo-cat");
  assert.equal(call?.method, "GET");
  assert.equal(call?.redirect, "error");
  assert.ok(!("authorization" in (call?.headers ?? {})));
});

test("an organisation and a bot are answered with their kind for the plane to refuse", async () => {
  for (const kind of ["Organization", "Bot"])
    assert.deepEqual((await looked(user(kind))).lookup, {
      looked: "Found",
      account: { id: "990000001", login: "Octo-Cat" },
      kind,
    });
});

test("a 404 is an unknown account, and every other refusal, a throttle and no answer are outages", async () => {
  assert.deepEqual((await looked(json({ message: "Not Found" }, 404))).lookup, {
    looked: "Unknown",
  });
  for (const answer of [
    json({ message: marker }, 403, { "x-ratelimit-remaining": "0" }),
    json({ message: marker }, 403),
    json({ message: marker }, 401),
    json({ message: marker }, 422),
    json({ message: marker }, 500),
    json({ login: "..", id: 1, type: "User" }),
    new TypeError("unreachable"),
  ])
    assert.deepEqual((await looked(answer)).lookup, { looked: "Unavailable" });
});
