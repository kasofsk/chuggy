/**
 * The offer arguments and the reply document, held at the contract: what the
 * image validates an offer by is what the console reads one by, and what the
 * server writes as an `OfferReply` turn is what the console reads back.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  threadOfferReleaseSchema,
  threadOfferReplyRead,
  threadOfferReplySchema,
  threadOfferReplyText,
  threadOfferReplyVersion,
  threadOfferRevokeSchema,
} from "../../src/contract/threadOffers.ts";
import type { ThreadOfferReply } from "../../src/contract/threadOffers.ts";
import * as sessionTools from "../../src/contract/sessionTools.ts";

test("every reply a member can post reads back as itself off the turn it is written into", () => {
  const replies: readonly ThreadOfferReply[] = [
    { call: "toolu_01", decision: "Declined" },
    { call: "toolu_01", decision: "Confirmed", outcome: "Succeeded" },
    {
      call: "call-7",
      decision: "Confirmed",
      outcome: "Refused",
      refusal: "AuthoringChanged",
    },
    { call: "toolu_01", decision: "Confirmed", outcome: "Unsettled" },
  ];
  for (const reply of replies) {
    assert.ok(threadOfferReplySchema.safeParse(reply).success);
    assert.deepEqual(threadOfferReplyRead(threadOfferReplyText(reply)), reply);
  }
});

test("a turn input that is not a reply this release writes reads as none", () => {
  const reply = { call: "toolu_01", decision: "Declined" } as const;
  for (const text of [
    "declined",
    "{}",
    JSON.stringify(reply),
    JSON.stringify({ version: threadOfferReplyVersion + 1, offerReply: reply }),
    JSON.stringify({
      version: threadOfferReplyVersion,
      offerReply: { ...reply, outcome: "Succeeded" },
    }),
  ])
    assert.equal(threadOfferReplyRead(text), undefined, text);
});

test("a reply names a call by an identity the runtime mints, and a confirmation says what it came to", () => {
  for (const refused of [
    { call: "", decision: "Declined" },
    { call: "toolu 01", decision: "Declined" },
    { call: "x".repeat(129), decision: "Declined" },
    { call: "toolu_01", decision: "Confirmed" },
    { call: "toolu_01", decision: "Confirmed", outcome: "Released" },
    {
      call: "toolu_01",
      decision: "Confirmed",
      outcome: "Refused",
      refusal: "not a code",
    },
  ])
    assert.equal(
      threadOfferReplySchema.safeParse(refused).success,
      false,
      JSON.stringify(refused),
    );
});

test("an offer names its subject at a version, and nothing else", () => {
  assert.ok(
    threadOfferReleaseSchema.safeParse({ ticket: 12, authoringVersion: 3 })
      .success,
  );
  assert.ok(
    threadOfferRevokeSchema.safeParse({ ticket: 12, revision: 2 }).success,
  );
  for (const [schema, value] of [
    [threadOfferReleaseSchema, { ticket: 12 }],
    [threadOfferReleaseSchema, { ticket: 12, authoringVersion: 3, x: 1 }],
    [threadOfferRevokeSchema, { ticket: 12 }],
    [threadOfferRevokeSchema, { ticket: 0, revision: 2 }],
  ] as const)
    assert.equal(schema.safeParse(value).success, false);
});

test("the image is handed the offer arguments the console reads", () => {
  assert.equal(sessionTools.threadOfferReleaseSchema, threadOfferReleaseSchema);
  assert.equal(sessionTools.threadOfferRevokeSchema, threadOfferRevokeSchema);
});
