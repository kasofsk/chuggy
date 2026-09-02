/**
 * What a session identity may be, and what the two bearer languages are, which
 * together are the whole of what this module decides.
 *
 * THE JWS HERE IS SIGNED RATHER THAN SHAPED. A hand-written string with dots in
 * it would prove the pattern rejects that string; a real compact serialization
 * is what an issuer actually presents, and the disjointness the API routes on is
 * a claim about those, not about a plausible-looking literal.
 */

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  allSessionCapabilities,
  allSessionKinds,
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnInputKinds,
  allSessionTurnStates,
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  sessionBearerPattern,
  sessionBearerPrefix,
  sessionCapabilitiesMax,
  sessionIdentityCharsMax,
} from "../../src/interpreter/agentSession.ts";
import { sessionStoreStreamCharsMax } from "../../src/contract/http.ts";
import { populated } from "./roster.ts";

/** Every brander, beside the subject its refusal has to name. */
const branders: readonly {
  readonly what: string;
  readonly brand: (value: string) => string;
}[] = [
  { what: "session id", brand: asSessionId },
  { what: "session turn id", brand: asSessionTurnId },
  { what: "session attempt id", brand: asSessionAttemptId },
  { what: "session bearer id", brand: asSessionBearerId },
  { what: "session bearer secret", brand: asSessionBearerSecret },
];

/** One unpaired surrogate, which every UTF-8 encoding folds to one replacement. */
const unpaired = `lead${String.fromCharCode(0xd800)}`;

/** A secret minted the way the scheduler mints one, which is what the pattern is for. */
function mintedSecret(): string {
  return `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
}

/** A real compact JWS, signed, so the disjointness claim is about the thing an issuer presents. */
function compactJws(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: "https://issuer.test", sub: "member" }),
  ).toString("base64url");
  const signature = createHmac("sha256", "a signing key")
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

test("an identity the column can hold is returned unchanged", () => {
  for (const brand of [
    asSessionId,
    asSessionTurnId,
    asSessionAttemptId,
    asSessionBearerId,
  ]) {
    assert.equal(brand("identity-one"), "identity-one");
  }
  const secret = mintedSecret();
  assert.equal(asSessionBearerSecret(secret), secret);
});

test("the longest identity a row holds is accepted and one past it is not", () => {
  const longest = "a".repeat(sessionIdentityCharsMax);
  assert.equal(asSessionId(longest), longest);
  assert.throws(() => asSessionId(`${longest}a`), RangeError);
});

test("an empty identity is refused by every brander, naming its own subject", () => {
  for (const { what, brand } of populated(branders, "the session branders")) {
    assert.throws(
      () => brand(""),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("an unpaired surrogate is refused by every brander", () => {
  for (const { what, brand } of populated(branders, "the session branders")) {
    assert.throws(
      () => brand(unpaired),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("an over-length identity is refused by every brander", () => {
  const past = "a".repeat(sessionIdentityCharsMax + 1);
  for (const { what, brand } of populated(branders, "the session branders")) {
    assert.throws(
      () => brand(past),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, new RegExp(`^${what}: `, "u"));
        return true;
      },
    );
  }
});

test("a bearer secret outside the bearer language is refused", () => {
  for (const refused of [
    "identity-one",
    randomUUID(),
    `chgs_${"a".repeat(31)}`,
    `chgs_${"a".repeat(241)}`,
    `chgs_${"a".repeat(40)}!`,
    ` ${mintedSecret()}`,
    `${mintedSecret()} `,
  ]) {
    assert.throws(
      () => asSessionBearerSecret(refused),
      RangeError,
      `a bearer secret is refused: ${refused}`,
    );
  }
});

test("a minted secret matches the pattern and a real compact JWS never does", () => {
  assert.match(mintedSecret(), sessionBearerPattern);
  const jws = compactJws();
  assert.equal(jws.split(".").length, 3, "the fixture is a compact JWS");
  assert.doesNotMatch(
    jws,
    sessionBearerPattern,
    "a token an issuer presents must never route to the session authority",
  );
  assert.ok(
    jws.startsWith("ey"),
    "a compact JWS begins with the base64url of an object, which the prefix cannot",
  );
});

test("a stream the store and the row agree on is returned unchanged", () => {
  const stream = "018f2c-agent-session/checkpoints.jsonl";
  assert.equal(asSessionStoreStream(stream), stream);
  const longest = "a".repeat(sessionStoreStreamCharsMax);
  assert.equal(asSessionStoreStream(longest), longest);
  assert.throws(() => asSessionStoreStream(`${longest}a`), RangeError);
});

test("a stream carrying a control or whitespace character is refused at the door", () => {
  for (const refused of [
    "stream one",
    "stream\tone",
    "stream\none",
    "stream\u000bone",
    "stream\u001fone",
    "stream\u007fone",
    "stream\u00a0one",
    " stream",
    "stream ",
  ]) {
    assert.throws(
      () => asSessionStoreStream(refused),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /^store stream: /u);
        return true;
      },
      `a stream is refused: ${JSON.stringify(refused)}`,
    );
  }
});

test("every roster holds its members in the order the schema iterates", () => {
  assert.deepEqual(allSessionKinds, ["Lead", "Thread", "Inquiry"]);
  assert.deepEqual(allSessionStates, ["Open", "Closed"]);
  assert.deepEqual(allSessionCapabilities, [
    "RepositoryRead",
    "RepositoryWrite",
    "RunCommands",
  ]);
  assert.deepEqual(allSessionTurnInputKinds, [
    "Observation",
    "UserMessage",
    "Wake",
    "Inquiry",
  ]);
  assert.deepEqual(allSessionTurnStates, [
    "Queued",
    "Claimed",
    "Answered",
    "Failed",
    "Abandoned",
  ]);
  assert.deepEqual(allSessionTurnFailures, [
    "AgentFailed",
    "AgentRateLimited",
    "AgentTurnsExhausted",
    "AgentBudgetExhausted",
    "StoreRefused",
    "AttemptLost",
    "SessionClosed",
  ]);
});

test("no roster member repeats, and the capability roster fits the bound a row checks", () => {
  const rosters: readonly (readonly string[])[] = [
    allSessionKinds,
    allSessionStates,
    allSessionCapabilities,
    allSessionTurnInputKinds,
    allSessionTurnStates,
    allSessionTurnFailures,
  ];
  for (const roster of populated(rosters, "the session rosters")) {
    assert.equal(
      new Set(populated(roster, "a session roster")).size,
      roster.length,
    );
  }
  assert.ok(allSessionCapabilities.length <= sessionCapabilitiesMax);
});
