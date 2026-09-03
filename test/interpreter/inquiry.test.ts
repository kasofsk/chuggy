/**
 * The inquiry vocabulary: the roster a fork is opened with, the document its
 * one turn carries, and the objectives it is recorded under.
 *
 * Every bound here is COMPUTED FROM THE PARTS rather than written as a number,
 * because a suite that names a ceiling passes when the module and the suite
 * agree on the wrong one. The load-bearing case is not in this file: that a
 * roster of reads leaves every write tool in `disallowedTools` is a fact about
 * the module the pod actually runs, and `test/contract/imageTools.test.mjs`
 * reads that module rather than this one's copy of its shape.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { inquiryQuestionCharsMax } from "../../src/contract/http.ts";
import { leadInquirySchema } from "../../src/contract/requests.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import {
  inquiryCapabilities,
  inquiryDocument,
  inquiryDocumentVersion,
  inquiryInstructions,
  inquiryStanding,
  inquirySystemPrompt,
  inquiryText,
  parseInquiry,
} from "../../src/interpreter/inquiry.ts";
import {
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPrefix,
  sessionSystemPromptCharsMax,
} from "../../src/interpreter/leadTools.ts";

const asked = { question: "what stopped ticket 14?", asker: "geoff" };
const door = { session: "inq-one", turn: "inq-turn-one" };

test("a document written and read back is the same document", () => {
  const document = inquiryDocument(asked);
  assert.deepEqual(document, {
    version: inquiryDocumentVersion,
    question: asked.question,
    asker: asked.asker,
    standing: inquiryStanding,
  });
  assert.deepEqual(parseInquiry(inquiryText(document)), document);
});

test("the standing rule is put on the document rather than left to a caller", () => {
  assert.equal(inquiryDocument(asked).standing, inquiryStanding);
  assert.ok(
    inquiryInstructions.includes(inquiryStanding),
    "the prompt restates the rule instead of carrying it",
  );
});

test("a question the door would refuse is refused where the document is made", () => {
  assert.throws(
    () => inquiryDocument({ ...asked, question: "" }),
    /the question is empty/u,
  );
  assert.throws(
    () =>
      inquiryDocument({
        ...asked,
        question: "q".repeat(inquiryQuestionCharsMax + 1),
      }),
    /at most/u,
  );
  assert.doesNotThrow(() =>
    inquiryDocument({
      ...asked,
      question: "q".repeat(inquiryQuestionCharsMax),
    }),
  );
});

test("a document is refused rather than repaired", () => {
  const written = (fields: Readonly<Record<string, unknown>>) =>
    JSON.stringify({ ...inquiryDocument(asked), ...fields });

  assert.throws(() => parseInquiry("{"), /not the JSON one is written as/u);
  assert.throws(() => parseInquiry("[]"), /not an object/u);
  assert.throws(
    () => parseInquiry(written({ version: inquiryDocumentVersion + 1 })),
    /a version this release does not write/u,
  );
  assert.throws(
    () =>
      parseInquiry(
        written({ question: "q".repeat(inquiryQuestionCharsMax + 1) }),
      ),
    /past the door's bound/u,
  );
  assert.throws(
    () => parseInquiry(written({ asker: undefined })),
    /asker is not a value one carries/u,
  );
  assert.throws(
    () => parseInquiry(written({ standing: "answer however you like" })),
    /a standing rule nobody wrote/u,
  );
});

/**
 * The reader's bound and the door's are the same constant, so the question the
 * door accepts at exactly the bound is one the reader can read back. A reader
 * one character stricter than its door composes a turn nobody can parse, and
 * the member's inquiry is spent on a failure that names no reason.
 */
test("a question at exactly the bound survives the door and the reader alike", () => {
  const widest = { ...asked, question: "q".repeat(inquiryQuestionCharsMax) };
  const text = inquiryText(inquiryDocument(widest));

  assert.equal(
    leadInquirySchema.parse({ ...door, question: widest.question }).question
      .length,
    inquiryQuestionCharsMax,
  );
  assert.equal(parseInquiry(text).question, widest.question);
});

test("the objectives carry the lead's own and say what a fork is", () => {
  const lead = "# What this project is aiming at\n\nship the console";
  const prompt = inquirySystemPrompt(lead);

  assert.ok(
    prompt.includes(lead),
    "the lead's own objectives were not carried",
  );
  assert.ok(
    prompt.includes(inquiryStanding),
    "the standing rule is not stated",
  );
  assert.throws(() => inquirySystemPrompt(""), /the lead's prompt is empty/u);
});

/**
 * The ceiling is the lead's own plus what this module appends, and it is
 * computed here from those two parts: a number written in the suite would let
 * the module and the suite be wrong together.
 */
test("a prompt no lead could have carried is refused, and one it could is not", () => {
  const appended = inquirySystemPrompt("x").length - 1;
  const widest = "x".repeat(sessionSystemPromptCharsMax);

  assert.equal(inquirySystemPrompt(widest).length, appended + widest.length);
  assert.throws(
    () => inquirySystemPrompt(`${widest}x`),
    /at most/u,
    "a prompt past the lead's own ceiling was composed",
  );
});

/**
 * The door is gated on `Read` rather than on `Mutate` because everything the
 * fork can issue is a command the asker already had. That argument is only as
 * good as this: the roster admits exactly the project's reads, and strictly
 * fewer tools than a lead's own roster does.
 */
test("the roster admits exactly the project's reads and nothing further", () => {
  for (const held of inquiryCapabilities)
    assert.ok(
      (allSessionCapabilities as readonly string[]).includes(held),
      `${held} is not a capability the platform knows`,
    );

  const admitted = chuggyToolNames([...inquiryCapabilities]);
  assert.deepEqual(
    admitted,
    chuggyToolCapabilities.ProjectRead.map(
      (tool) => `${chuggyToolPrefix}${tool}`,
    ),
  );

  const lead = chuggyToolNames([
    "RepositoryRead",
    "ProjectRead",
    "DraftAuthor",
    "LeadDecision",
  ]);
  assert.ok(
    admitted.every((name) => lead.includes(name)) &&
      admitted.length < lead.length,
    "the inquiry roster is not a strict subset of the lead's",
  );
  for (const tool of [
    ...chuggyToolCapabilities.DraftAuthor,
    ...chuggyToolCapabilities.LeadDecision,
  ])
    assert.ok(
      !admitted.includes(`${chuggyToolPrefix}${tool}`),
      `${tool} is admitted by a roster that may not write`,
    );
});
