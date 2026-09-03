/**
 * The three inquiry routes through the real app: the status each refusal
 * reaches the wire as, the media type the ask door requires, and the body each
 * answers held against the schema that names it.
 *
 * THE BOUNDARY IS A DOUBLE AND THE APP IS REAL, because what is being settled
 * here is the transport. What the boundary itself decides — the gate, the
 * document, the bound — is settled beside it in
 * `test/interpreter/leadInquiry.test.ts`.
 *
 * `InquiriesInFlight` IS `409` AND CARRIES NO `retry-after`, which the case
 * holds both ways round: a retry cannot succeed until one of the asker's own
 * inquiries settles, and the console retries a `429` three times before drawing
 * a word.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
} from "../../src/contract/responses.ts";
import type { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  asSessionId,
  asSessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import type { LeadInquiryAsked } from "../../src/interpreter/leadInquiry.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

/** What the app takes, which is one boundary and not the three methods under test. */
type NativeInquiryWeb = Parameters<typeof createNativeHttpApp>[0];

const root = "/api/v1/tenants/acme/projects/atlas/lead/inquiries";
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };
const mine = asSessionId("inq-geoff");
const asked = asSessionTurnId("inq-turn-geoff");

const entry = {
  session: mine,
  asker: "geoff",
  mine: true,
  state: "Closed",
  turnState: "Answered",
  ordinal: 1,
  question: "what stopped 14?",
  answer: "its brief names no branch",
  askedAt: asPublicInstant("2026-09-02T10:00:00.000Z"),
  model: "claude-opus-5",
  tokens: 41_234,
  costMicros: 182_000,
  durationMs: 74_210,
} as const;

interface InquiryCase {
  readonly calls: string[];
  readonly asked?: LeadInquiryAsked;
  readonly found?: boolean;
}

function inquiryWeb(held: InquiryCase): NativeInquiryWeb {
  const found = held.found ?? true;
  return {
    ...unservedNativeWeb,
    leadInquiries: (_principal, partition) => {
      held.calls.push(`inquiries:${partition.tenant}/${partition.project}`);
      return Promise.resolve(
        found
          ? { result: "Found", inquiries: [entry] }
          : { result: "NotFound" },
      );
    },
    leadInquiry: (_principal, _partition, session) => {
      held.calls.push(`inquiry:${session}`);
      return Promise.resolve(
        found ? { result: "Found", inquiry: entry } : { result: "NotFound" },
      );
    },
    askLead: (_principal, _partition, input) => {
      held.calls.push(`ask:${input.session}:${input.turn}:${input.question}`);
      return Promise.resolve(
        held.asked ?? {
          result: "Asked",
          session: input.session,
          turn: input.turn,
          ordinal: 1,
        },
      );
    },
  };
}

function appOf(held: InquiryCase) {
  return servedNativeHttpApp(inquiryWeb(held));
}

test("the two doors hang off the lead exactly where the app registers them", () => {
  assert.equal(
    nativeHttpRoutes.leadInquiries
      .replace(":tenant", "acme")
      .replace(":project", "atlas"),
    root,
  );
  assert.equal(
    nativeHttpRoutes.leadInquiry,
    `${nativeHttpRoutes.leadInquiries}/:session`,
  );
});

test("the lead's inquiries are listed as the listing schema names them", async () => {
  const held: InquiryCase = { calls: [] };
  const app = appOf(held);
  const answered = await app.inject({
    method: "GET",
    url: root,
    headers: authorized,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(leadInquiriesResponseSchema.parse(answered.json()), {
    inquiries: [{ ...entry }],
  });
  assert.deepEqual(held.calls, ["inquiries:acme/atlas"]);
  await app.close();
});

test("one inquiry is answered as one entry of the listing's own shape", async () => {
  const held: InquiryCase = { calls: [] };
  const app = appOf(held);
  const answered = await app.inject({
    method: "GET",
    url: `${root}/${mine}`,
    headers: authorized,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(leadInquiryResponseSchema.parse(answered.json()), {
    ...entry,
  });
  assert.deepEqual(held.calls, [`inquiry:${mine}`]);
  await app.close();
});

test("a project the caller may not read answers nothing on either read", async () => {
  const held: InquiryCase = { calls: [], found: false };
  const app = appOf(held);
  for (const url of [root, `${root}/${mine}`]) {
    const answered = await app.inject({
      method: "GET",
      url,
      headers: authorized,
    });
    assert.equal(answered.statusCode, 404);
    assert.equal(answered.json<HttpErrorEnvelope>().error.code, "NotFound");
  }
  await app.close();
});

test("asking answers the fork, its one turn and where that turn sits", async () => {
  const held: InquiryCase = { calls: [] };
  const app = appOf(held);
  const answered = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { session: mine, turn: asked, question: "what stopped 14?" },
  });
  assert.equal(answered.statusCode, 202);
  assert.deepEqual(leadInquiryAcceptedSchema.parse(answered.json()), {
    session: mine,
    turn: asked,
    ordinal: 1,
  });
  assert.equal(
    answered.headers["location"],
    `/api/v1/tenants/acme/projects/atlas/lead/inquiries/${mine}`,
  );
  assert.deepEqual(held.calls, [`ask:${mine}:${asked}:what stopped 14?`]);
  await app.close();
});

test("a retried ask is the same status and the same ordinal", async () => {
  const held: InquiryCase = {
    calls: [],
    asked: {
      result: "AlreadyAsked",
      session: mine,
      turn: asked,
      ordinal: 1,
    },
  };
  const app = appOf(held);
  const answered = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { session: mine, turn: asked, question: "what stopped 14?" },
  });
  assert.equal(answered.statusCode, 202);
  assert.equal(leadInquiryAcceptedSchema.parse(answered.json()).ordinal, 1);
  await app.close();
});

test("each refusal reaches the wire as its own status and its own code", async () => {
  const refusals: readonly (readonly [
    LeadInquiryAsked["result"],
    number,
    string,
  ])[] = [
    ["NotFound", 404, "NotFound"],
    ["NoLead", 404, "NotFound"],
    ["LeadNotStarted", 409, "LeadNotStarted"],
    ["LeadClosed", 409, "LeadClosed"],
    ["InFlight", 409, "InquiriesInFlight"],
  ];
  for (const [result, status, code] of refusals) {
    const held: InquiryCase = {
      calls: [],
      asked: { result } as LeadInquiryAsked,
    };
    const app = appOf(held);
    const answered = await app.inject({
      method: "POST",
      url: root,
      headers: versioned,
      payload: { session: mine, turn: asked, question: "what stopped 14?" },
    });
    assert.equal(answered.statusCode, status, result);
    assert.equal(answered.json<HttpErrorEnvelope>().error.code, code);
    assert.equal(
      answered.headers["retry-after"],
      undefined,
      `${result} told the caller to come back on a clock`,
    );
    await app.close();
  }
});

test("the ask door refuses a body the versioned media type did not carry", async () => {
  const held: InquiryCase = { calls: [] };
  const app = appOf(held);
  const answered = await app.inject({
    method: "POST",
    url: root,
    headers: authorized,
    payload: { session: mine, turn: asked, question: "what stopped 14?" },
  });
  assert.equal(answered.statusCode, 415);
  assert.deepEqual(held.calls, []);
  await app.close();
});

test("a body the door does not read is refused before the boundary", async () => {
  for (const payload of [
    { turn: asked, question: "q" },
    { session: mine, turn: asked, question: "" },
    { session: mine, turn: asked, question: "q", ordinal: 1 },
  ]) {
    const held: InquiryCase = { calls: [] };
    const app = appOf(held);
    const answered = await app.inject({
      method: "POST",
      url: root,
      headers: versioned,
      payload,
    });
    assert.equal(answered.statusCode, 400);
    assert.deepEqual(held.calls, []);
    await app.close();
  }
});
