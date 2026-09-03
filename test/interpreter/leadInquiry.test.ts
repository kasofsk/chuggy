/**
 * The inquiry side of the boundary: the gate each door takes, what the wire
 * carries, and what the door does with a durable answer it did not expect.
 *
 * EVERY CASE IS ABOUT A DECISION AND NOT ABOUT A PORT. The store is a stub that
 * records what it was asked for, so what a case holds is the argument the
 * boundary composed and the answer it turned a verdict into — the durable side
 * of each is `test/postgres/inquiryDurable.test.ts`'s.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  inquiriesAnsweredMax,
  inquiryQuestionCharsMax,
} from "../../src/contract/http.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import {
  inquiryStanding,
  parseInquiry,
} from "../../src/interpreter/inquiry.ts";
import {
  leadInquiryAsked,
  leadInquiryEntry,
  leadInquiryTurnInput,
  type LeadInquiryOpened,
  type LeadInquiryRecord,
  type LeadInquiryStore,
} from "../../src/interpreter/leadInquiry.ts";
import {
  nativeWeb,
  type ProjectAccess,
} from "../../src/interpreter/nativeWeb.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { unaskedNativeWebPorts } from "./nativeWebFixtures.ts";

const partition: Partition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};
const reader = asPrincipal("oidc:https://ory.test/:geoff");
const stranger = asPrincipal("oidc:https://ory.test/:sam");
const session = asSessionId("inq-one");
const turn = asSessionTurnId("inq-turn-one");

/** A membership that holds exactly the access a case names, and audits to one subject. */
function accessHolding(...held: readonly string[]): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) =>
      Promise.resolve(
        held.includes(kind)
          ? {
              kind: asAuthorityKind("OidcUser"),
              subject: asAuthoritySubject("geoff"),
            }
          : undefined,
      ),
  };
}

const record: LeadInquiryRecord = {
  session,
  principal: reader,
  asker: "geoff",
  state: "Open",
  turn,
  turnState: "Queued",
  ordinal: 1,
  input: leadInquiryTurnInput({ question: "what stopped 14?", asker: "geoff" }),
  askedAt: asPublicInstant("2026-09-02T10:00:00.000Z"),
};

/** A store that records what it was asked and answers what the case named. */
function storeAnswering(
  answers: {
    readonly inquiries?: readonly LeadInquiryRecord[];
    readonly inquiry?: LeadInquiryRecord;
    readonly opened?: LeadInquiryOpened;
  },
  asked: unknown[],
): LeadInquiryStore {
  return {
    inquiries: (named, limit) => {
      asked.push({ inquiries: named, limit });
      return Promise.resolve(answers.inquiries ?? []);
    },
    inquiry: (named, wanted) => {
      asked.push({ inquiry: named, session: wanted });
      return Promise.resolve(answers.inquiry);
    },
    open: (input) => {
      asked.push(input);
      return Promise.resolve(
        answers.opened ?? {
          opened: "Opened",
          session: input.session,
          ordinal: 1,
        },
      );
    },
  };
}

/**
 * The boundary over one inquiry store, every other port the narrowest thing
 * that satisfies its type — because a case here that reached one would be a
 * case about something else.
 */
function webOver(store: LeadInquiryStore, access: ProjectAccess) {
  return nativeWeb(
    access,
    ...unaskedNativeWebPorts,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    store,
  );
}

test("a member with Read reaches all three doors and one without reaches none", async () => {
  for (const [held, expected] of [
    [["Read"], "Found"],
    [[], "NotFound"],
  ] as const) {
    const asked: unknown[] = [];
    const web = webOver(
      storeAnswering({ inquiries: [record], inquiry: record }, asked),
      accessHolding(...held),
    );
    assert.equal((await web.leadInquiries(reader, partition)).result, expected);
    assert.equal(
      (await web.leadInquiry(reader, partition, session)).result,
      expected,
    );
    const asking = await web.askLead(reader, partition, {
      session,
      turn,
      question: "what stopped 14?",
    });
    assert.equal(asking.result, expected === "Found" ? "Asked" : "NotFound");
  }
});

/**
 * `Mutate` is NOT what asking takes, and the case is written the way round that
 * makes a gate widened to it red: a member who holds `Mutate` and not `Read`
 * reaches nothing.
 */
test("a member with Mutate alone cannot ask, because asking is a read", async () => {
  const web = webOver(storeAnswering({}, []), accessHolding("Mutate"));
  assert.equal(
    (
      await web.askLead(reader, partition, {
        session,
        turn,
        question: "what stopped 14?",
      })
    ).result,
    "NotFound",
  );
});

test("the question the door offers carries the standing rule and the asker", async () => {
  const asked: unknown[] = [];
  const web = webOver(storeAnswering({}, asked), accessHolding("Read"));
  await web.askLead(reader, partition, {
    session,
    turn,
    question: "what stopped 14?",
  });
  const offered = asked[0] as { readonly question: string };
  const document = parseInquiry(offered.question);
  assert.equal(document.question, "what stopped 14?");
  assert.equal(
    document.asker,
    "geoff",
    "the asker came from the body rather than from the membership",
  );
  assert.equal(document.standing, inquiryStanding);
});

test("a question outside the door's bound is refused before a store is reached", async () => {
  const asked: unknown[] = [];
  const web = webOver(storeAnswering({}, asked), accessHolding("Read"));
  for (const question of ["", "q".repeat(inquiryQuestionCharsMax + 1)])
    await assert.rejects(
      web.askLead(reader, partition, { session, turn, question }),
      RangeError,
    );
  assert.deepEqual(asked, []);
  assert.equal(
    (
      await web.askLead(reader, partition, {
        session,
        turn,
        question: "q".repeat(inquiryQuestionCharsMax),
      })
    ).result,
    "Asked",
  );
});

test("the listing asks for a page and never for a project's whole history", async () => {
  const asked: unknown[] = [];
  const web = webOver(
    storeAnswering({ inquiries: [] }, asked),
    accessHolding("Read"),
  );
  await web.leadInquiries(reader, partition);
  assert.deepEqual(asked, [
    { inquiries: partition, limit: inquiriesAnsweredMax },
  ]);
});

test("mine is decided against the reader and the principal never crosses", () => {
  const mine = leadInquiryEntry(record, reader);
  const theirs = leadInquiryEntry(record, stranger);
  assert.equal(mine.mine, true);
  assert.equal(theirs.mine, false);
  assert.equal("principal" in mine, false);
  assert.equal(mine.question, "what stopped 14?");
  assert.equal(mine.answer, undefined);
  assert.equal(mine.model, undefined);
});

test("an answered inquiry carries the answer and what the pod measured", () => {
  const entry = leadInquiryEntry(
    {
      ...record,
      state: "Closed",
      turnState: "Answered",
      answer: "its brief names no branch",
      measured: {
        model: "claude-opus-5",
        tokens: 41_234,
        costMicros: 182_000,
        durationMs: 74_210,
        tools: [],
      },
    },
    reader,
  );
  assert.equal(entry.answer, "its brief names no branch");
  assert.equal(entry.model, "claude-opus-5");
  assert.equal(entry.tokens, 41_234);
  assert.equal(entry.costMicros, 182_000);
  assert.equal(entry.durationMs, 74_210);
});

test("an inquiry whose asker's membership is gone carries no asker", () => {
  const { asker, ...ownerless } = record;
  assert.equal(asker, "geoff");
  const entry = leadInquiryEntry(ownerless, reader);
  assert.equal("asker" in entry, false);
});

/**
 * A document no door wrote is REFUSED rather than repaired: a listing that
 * showed a member a question nobody asked would be worse than one that failed,
 * because the member would act on it.
 */
test("an inquiry carrying a document no door wrote is refused", () => {
  assert.throws(
    () => leadInquiryEntry({ ...record, input: "not a document" }, reader),
    RangeError,
  );
  assert.throws(
    () =>
      leadInquiryEntry(
        {
          ...record,
          input: JSON.stringify({
            version: 1,
            question: "q",
            asker: "a",
            standing: "a rule nobody wrote",
          }),
        },
        reader,
      ),
    RangeError,
  );
});

test("each refusal the durable side names is the refusal the door answers", () => {
  for (const opened of [
    "NoLead",
    "LeadNotStarted",
    "LeadClosed",
    "InFlight",
  ] as const)
    assert.deepEqual(leadInquiryAsked({ opened }, session, turn), {
      result: opened,
    });
  assert.deepEqual(
    leadInquiryAsked({ opened: "Opened", session, ordinal: 1 }, session, turn),
    { result: "Asked", session, turn, ordinal: 1 },
  );
  assert.deepEqual(
    leadInquiryAsked(
      { opened: "AlreadyOpen", session, ordinal: 3 },
      session,
      turn,
    ),
    { result: "AlreadyAsked", session, turn, ordinal: 3 },
  );
});

/**
 * A definer that answered another fork would hand the caller an ordinal in a
 * session they are not watching, and they would poll it for ever. The
 * comparison is here as well as in the definer, because there is no answer this
 * side could give that would be right.
 */
test("a durable answer naming another fork is refused rather than reported", () => {
  const other: SessionId = asSessionId("inq-somebody-else");
  for (const opened of ["Opened", "AlreadyOpen"] as const)
    assert.throws(
      () =>
        leadInquiryAsked({ opened, session: other, ordinal: 1 }, session, turn),
      /answered inq-somebody-else/,
    );
});
