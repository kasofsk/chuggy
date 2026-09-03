/**
 * The wire's shapes for an inquiry against a lead: the body the ask door takes,
 * what it answers, and the listing a member reads.
 *
 * Every case that proves a bound builds its text FROM the bound rather than
 * naming a length, so a retuned constant moves the case with it instead of
 * leaving one that passes against the old number.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  inquiriesAnsweredMax,
  inquiryQuestionCharsMax,
  nativeHttpRoutes,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import { leadInquirySchema } from "../../src/contract/requests.ts";
import {
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
} from "../../src/contract/responses.ts";

const entry = {
  session: "inq-one",
  asker: "geoff",
  mine: true,
  state: "Closed",
  turnState: "Answered",
  ordinal: 1,
  question: "what stopped ticket 14?",
  answer: "its brief names no branch",
  failure: undefined,
  askedAt: "2026-09-02T10:00:00.000Z",
  model: "claude-opus-5",
  tokens: 41_234,
  costMicros: 182_000,
  durationMs: 74_210,
};

test("the two doors hang off the lead and are parameterised the same way", () => {
  assert.equal(
    nativeHttpRoutes.leadInquiries,
    `${nativeHttpRoutes.lead}/inquiries`,
  );
  assert.equal(
    nativeHttpRoutes.leadInquiry,
    `${nativeHttpRoutes.leadInquiries}/:session`,
  );
});

test("an inquiry carries its question, its answer and what the turn cost", () => {
  const parsed = leadInquiryResponseSchema.parse(entry);
  assert.equal(parsed.question, entry.question);
  assert.equal(parsed.answer, entry.answer);
  assert.equal(parsed.costMicros, entry.costMicros);
});

/**
 * `asker` and `mine` are §1.4's whole answer to who asked and whether it is the
 * caller's, and the schema is not strict, so a body carrying them would parse
 * whether or not the schema declared them. `mine` is required, which is what
 * makes deleting it from the shape red; `asker` is not, because a membership
 * that has been revoked leaves an inquiry the durable listing answers with no
 * asker, and a required field would make that row unparseable rather than
 * ownerless.
 */
test("the listing names who asked and whether it is the caller's", () => {
  const parsed = leadInquiryResponseSchema.parse(entry);
  assert.equal(parsed.asker, entry.asker);
  assert.equal(parsed.mine, true);

  const ownerless: Record<string, unknown> = { ...entry };
  delete ownerless["asker"];
  assert.equal(
    leadInquiryResponseSchema.parse(ownerless).asker,
    undefined,
    "an inquiry whose asker's membership is gone was refused rather than listed",
  );

  const unowned: Record<string, unknown> = { ...entry };
  delete unowned["mine"];
  assert.ok(
    !leadInquiryResponseSchema.safeParse(unowned).success,
    "an inquiry saying nothing about whose it is was accepted",
  );
});

test("an inquiry the pod has not answered carries neither answer nor measure", () => {
  const parsed = leadInquiryResponseSchema.parse({
    ...entry,
    state: "Open",
    turnState: "Queued",
    answer: undefined,
    model: undefined,
    tokens: undefined,
    costMicros: undefined,
    durationMs: undefined,
  });
  assert.equal(parsed.answer, undefined);
  assert.equal(parsed.model, undefined);
});

test("a failed inquiry names a failure the roster holds and no other", () => {
  assert.ok(
    leadInquiryResponseSchema.safeParse({
      ...entry,
      turnState: "Failed",
      answer: undefined,
      failure: "AgentFailed",
    }).success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({ ...entry, failure: "Bored" })
      .success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({ ...entry, turnState: "Running" })
      .success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({ ...entry, state: "Sleeping" })
      .success,
  );
});

test("neither text the wire carries may pass the column that holds it", () => {
  assert.ok(
    leadInquiryResponseSchema.safeParse({
      ...entry,
      question: "q".repeat(inquiryQuestionCharsMax),
      answer: "a".repeat(sessionTurnResultCharsMax),
    }).success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({
      ...entry,
      question: "q".repeat(inquiryQuestionCharsMax + 1),
    }).success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({
      ...entry,
      answer: "a".repeat(sessionTurnResultCharsMax + 1),
    }).success,
  );
  assert.ok(
    !leadInquiryResponseSchema.safeParse({ ...entry, question: "" }).success,
  );
});

test("a listing answers with a page and not with a project's whole history", () => {
  const page = (count: number) =>
    Array.from({ length: count }, (_, ordinal) => ({
      ...entry,
      session: `inq-${String(ordinal)}`,
    }));

  assert.equal(
    leadInquiriesResponseSchema.parse({ inquiries: page(inquiriesAnsweredMax) })
      .inquiries.length,
    inquiriesAnsweredMax,
  );
  assert.ok(
    !leadInquiriesResponseSchema.safeParse({
      inquiries: page(inquiriesAnsweredMax + 1),
    }).success,
  );
});

test("the ask door takes the two identities the caller mints and the question", () => {
  const body = { session: "inq-one", turn: "inq-turn-one", question: "why?" };
  assert.deepEqual(leadInquirySchema.parse(body), body);

  assert.ok(
    !leadInquirySchema.safeParse({ ...body, question: "" }).success,
    "an empty question was accepted",
  );
  assert.ok(
    !leadInquirySchema.safeParse({
      ...body,
      question: "q".repeat(inquiryQuestionCharsMax + 1),
    }).success,
    "a question past the door's bound was accepted",
  );
  assert.ok(
    !leadInquirySchema.safeParse({ turn: body.turn, question: "why?" }).success,
    "a body minting no session was accepted",
  );
  assert.ok(
    !leadInquirySchema.safeParse({ ...body, ordinal: 1 }).success,
    "a field the door does not read was accepted",
  );
});

test("the ask door answers the fork, its one turn and where that turn sits", () => {
  const accepted = { session: "inq-one", turn: "inq-turn-one", ordinal: 1 };
  assert.deepEqual(leadInquiryAcceptedSchema.parse(accepted), accepted);
  assert.ok(
    !leadInquiryAcceptedSchema.safeParse({ ...accepted, ordinal: -1 }).success,
  );
});
