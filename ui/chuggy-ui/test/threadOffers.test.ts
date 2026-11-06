/**
 * What a member's thread puts in front of them, read off its conversation:
 * which calls are offers and pages, where a card stands against its subject,
 * what a confirmation's reply says it came to, how a reply the mailbox has
 * not taken is kept, and when the console follows a `navigate`.
 */

import { describe, expect, test } from "vitest";

import type { ConsolePage } from "../../../src/contract/consolePage.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { threadOfferReplyText } from "../../../src/contract/threadOffers.ts";
import type {
  ConversationExchange,
  ConversationStep,
} from "../app/core/conversation.ts";
import type { OperationStep } from "../app/core/operationFollow.ts";
import {
  threadNavigateAppliedMax,
  threadNavigateAppliedWith,
  threadNavigateDue,
  threadNavigateOf,
  threadOfferAnswerOf,
  threadOfferConfirmed,
  threadOfferOf,
  threadOfferReleaseMutation,
  threadOfferReleaseStanding,
  threadOfferReplies,
  threadOfferRevokeMutation,
  threadOfferRevokeStanding,
  threadOfferSettledSentence,
  threadOfferUnsentKept,
  threadOfferUnsentKey,
  threadOfferUnsentLetGo,
  threadOfferUnsentMax,
  threadOfferUnsentOf,
  threadOfferUnsentRead,
} from "../app/core/threadOffers.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";
import { creationDraft } from "./ticketCreationFixture.ts";

function call(
  name: string,
  input: unknown,
  result?: { readonly text: string; readonly isError: boolean },
): ConversationStep {
  return {
    step: "ToolCall",
    id: `toolu_${name}`,
    name: `mcp__chuggy__${name}`,
    input,
    ...(result === undefined ? {} : { result }),
  };
}

const answered = { text: "ok", isError: false } as const;
const refused = { text: "no such page", isError: true } as const;

const release = {
  offer: "Release",
  call: "toolu_offer_release",
  ticket: 12,
  authoringVersion: 3,
} as const;

const revoke = {
  offer: "Revoke",
  call: "toolu_offer_revoke",
  ticket: 11,
  revision: 2,
} as const;

const ticket: TicketResponse = {
  ticket: 11,
  revision: 2,
  phase: "Pending",
  sequence: 7,
  changedAt: "2026-09-02T10:00:00Z",
  revokedDependencies: [],
  revokedDependenciesTruncated: false,
} as unknown as TicketResponse;

describe("reading the calls", () => {
  test("an offer is a call of the offer tools with the contract's own arguments that the image did not refuse", () => {
    expect(
      threadOfferOf(
        call("offer_release", { ticket: 12, authoringVersion: 3 }, answered),
      ),
    ).toStrictEqual(release);
    expect(
      threadOfferOf(call("offer_revoke", { ticket: 11, revision: 2 })),
    ).toStrictEqual(revoke);
    for (const step of [
      call("offer_release", { ticket: 12, authoringVersion: 3 }, refused),
      call("offer_release", { ticket: 12 }),
      call("release_draft", { ticket: 12, authoringVersion: 3 }),
      { step: "Text", text: "release 12?" } as const,
    ])
      expect(threadOfferOf(step)).toBeUndefined();
  });

  test("a page is a navigate the image answered without refusing, naming a page the console names", () => {
    expect(
      threadNavigateOf(
        call("navigate", { page: "Ticket", ticket: 41 }, answered),
      ),
    ).toStrictEqual({
      call: "toolu_navigate",
      page: { page: "Ticket", ticket: 41 },
    });
    for (const step of [
      call("navigate", { page: "Ticket", ticket: 41 }),
      call("navigate", { page: "Ticket", ticket: 41 }, refused),
      call("navigate", { page: "Elsewhere" }, answered),
    ])
      expect(threadNavigateOf(step)).toBeUndefined();
  });

  test("a mailbox's replies are read by the call each answers, and nothing else is one", () => {
    const declined = {
      call: "toolu_offer_release",
      decision: "Declined",
    } as const;
    const replies = threadOfferReplies([
      { inputKind: "UserMessage", input: threadOfferReplyText(declined) },
      { inputKind: "OfferReply", input: "not a reply" },
      { inputKind: "OfferReply", input: threadOfferReplyText(declined) },
      {
        inputKind: "OfferReply",
        input: threadOfferReplyText({
          call: "toolu_offer_release",
          decision: "Confirmed",
          outcome: "Succeeded",
        }),
      },
    ]);
    expect([...replies]).toStrictEqual([["toolu_offer_release", declined]]);
  });
});

describe("whether a page answers an offer", () => {
  test("an offer is unreplied only where every turn after its own is on the page", () => {
    const declined = { call: "toolu_a", decision: "Declined" } as const;
    const replies = new Map([["toolu_a", declined]]);
    const tail = {
      turns: [{ turn: "t-40" }, { turn: "t-41" }],
      nextBefore: 40,
    };
    expect(
      threadOfferAnswerOf(tail, replies, { call: "toolu_a", turn: "t-3" }),
    ).toStrictEqual({ answer: "Replied", reply: declined });
    expect(
      threadOfferAnswerOf(tail, replies, { call: "toolu_b", turn: "t-41" }),
    ).toStrictEqual({ answer: "Unreplied" });
    for (const turn of ["t-3", undefined])
      expect(
        threadOfferAnswerOf(tail, replies, { call: "toolu_b", turn }),
      ).toStrictEqual({ answer: "Unread" });
    expect(
      threadOfferAnswerOf({ turns: tail.turns }, replies, {
        call: "toolu_b",
        turn: "t-3",
      }),
    ).toStrictEqual({ answer: "Unreplied" });
  });
});

describe("where a card stands", () => {
  test("a release offer is open only at the draft's own authoring version, and superseded past it", () => {
    expect(threadOfferReleaseStanding(release, creationDraft)).toStrictEqual({
      standing: "Open",
    });
    expect(
      threadOfferReleaseStanding(release, {
        ...creationDraft,
        authoringVersion: 4,
      }),
    ).toStrictEqual({ standing: "Superseded" });
    const released: DraftResponse = { ...creationDraft, state: "Released" };
    expect(threadOfferReleaseStanding(release, released)).toStrictEqual({
      standing: "Closed",
      why: "Draft 12 is released",
    });
  });

  test("a revoke offer is open only at the ticket's own revision, and never for a ticket past revoking", () => {
    expect(threadOfferRevokeStanding(revoke, ticket)).toStrictEqual({
      standing: "Open",
    });
    expect(
      threadOfferRevokeStanding(revoke, { ...ticket, revision: 3 }),
    ).toStrictEqual({ standing: "Superseded" });
    expect(
      threadOfferRevokeStanding(revoke, { ...ticket, phase: "Done" }),
    ).toStrictEqual({ standing: "Closed", why: "#11 is Done" });
  });

  test("a confirmation releases exactly the offered version and revokes the offered ticket", () => {
    expect(
      threadOfferReleaseMutation(release, {
        ...creationDraft,
        authoringVersion: 3,
      }),
    ).toStrictEqual({
      mutation: "ReleaseDraft",
      ticket: 12,
      authoringVersion: 3,
      configurationRevision: "r3",
    });
    expect(() =>
      threadOfferReleaseMutation(release, { ...creationDraft, ticket: 13 }),
    ).toThrow(RangeError);
    expect(threadOfferRevokeMutation(revoke)).toStrictEqual({
      mutation: "RevokeTicket",
      ticket: 11,
      expectedRevision: revoke.revision,
    });
  });
});

describe("what a confirmation came to", () => {
  const settled = (
    state: "Succeeded" | "Refused",
    refusal?: string,
  ): OperationStep =>
    ({
      step: "Settled",
      operation: "op",
      state,
      refusal: refusal === undefined ? undefined : { type: refusal },
    }) as OperationStep;

  test("a settled operation is done or refused under its code, and any other ending is unseen", () => {
    expect(threadOfferConfirmed("c", settled("Succeeded"))).toStrictEqual({
      call: "c",
      decision: "Confirmed",
      outcome: "Succeeded",
    });
    expect(
      threadOfferConfirmed("c", settled("Refused", "AuthoringChanged")),
    ).toStrictEqual({
      call: "c",
      decision: "Confirmed",
      outcome: "Refused",
      refusal: "AuthoringChanged",
    });
    expect(
      threadOfferConfirmed("c", {
        step: "Abandoned",
        cause: { type: "Overstepped" },
        refused: false,
      }),
    ).toStrictEqual({ call: "c", decision: "Confirmed", outcome: "Unsettled" });
  });

  test("a settled card says what became of the offer", () => {
    expect(
      threadOfferSettledSentence(release, { call: "c", decision: "Declined" }),
    ).toBe("Declined");
    expect(
      threadOfferSettledSentence(revoke, {
        call: "c",
        decision: "Confirmed",
        outcome: "Succeeded",
      }),
    ).toBe("Revoked");
    expect(
      threadOfferSettledSentence(release, {
        call: "c",
        decision: "Confirmed",
        outcome: "Refused",
        refusal: "AuthoringChanged",
      }),
    ).toBe("Not released · AuthoringChanged");
  });
});

describe("following a navigate", () => {
  const sentFrom: ConsolePage = { page: "Ticket", ticket: 41 };
  const target: ConsolePage = { page: "TicketEdit", ticket: 41 };

  function exchange(
    id: string,
    page: ConsolePage | undefined,
    work: readonly ConversationStep[],
  ): ConversationExchange {
    return {
      id,
      ask: {
        ask: "Message",
        text: "open it for editing",
        ...(page === undefined ? {} : { page }),
      },
      work,
      standing: { standing: "Answered" },
      before: [],
    };
  }

  const navigated = call("navigate", target, answered);
  const exchanges = [exchange("a", sentFrom, [navigated])];

  test("the newest exchange's navigate is followed from the page its message was sent from", () => {
    expect(
      threadNavigateDue({ mine: true, exchanges, page: sentFrom, applied: [] }),
    ).toStrictEqual({ call: "toolu_navigate", page: target });
  });

  test("a call is not followed in another member's thread, from another page, or twice", () => {
    for (const due of [
      { mine: false, exchanges, page: sentFrom, applied: [] },
      { mine: true, exchanges, page: { page: "Inbox" }, applied: [] },
      { mine: true, exchanges, page: undefined, applied: [] },
      { mine: true, exchanges, page: sentFrom, applied: ["toolu_navigate"] },
    ] as const)
      expect(threadNavigateDue(due)).toBeUndefined();
  });

  test("a call in an older exchange, or answering a message sent from no page, is not followed", () => {
    expect(
      threadNavigateDue({
        mine: true,
        exchanges: [...exchanges, exchange("b", sentFrom, [])],
        page: sentFrom,
        applied: [],
      }),
    ).toBeUndefined();
    expect(
      threadNavigateDue({
        mine: true,
        exchanges: [exchange("a", undefined, [navigated])],
        page: sentFrom,
        applied: [],
      }),
    ).toBeUndefined();
  });

  test("the calls followed are remembered up to the bound, the oldest let go first", () => {
    let applied: readonly string[] = [];
    for (let at = 0; at <= threadNavigateAppliedMax; at += 1)
      applied = threadNavigateAppliedWith(applied, `call-${String(at)}`);
    expect(applied).toHaveLength(threadNavigateAppliedMax);
    expect(applied[0]).toBe("call-1");
    expect(threadNavigateAppliedWith(["a", "b"], "a")).toStrictEqual([
      "b",
      "a",
    ]);
  });
});

describe("a reply the mailbox has not taken", () => {
  function store(): KeyValuePort {
    const held = new Map<string, string>();
    return {
      read: (key) => held.get(key) ?? null,
      write: (key, value) => {
        held.set(key, value);
      },
      remove: (key) => {
        held.delete(key);
      },
    };
  }
  const declined = { call: "toolu_a", decision: "Declined" } as const;
  const confirmed = {
    call: "toolu_a",
    decision: "Confirmed",
    outcome: "Succeeded",
  } as const;

  test("is kept by thread and call, in place of the one its call had, until it is let go", () => {
    const kept = store();
    threadOfferUnsentKept(kept, "thread-1", declined);
    threadOfferUnsentKept(kept, "thread-1", confirmed);
    threadOfferUnsentKept(kept, "thread-2", declined);
    expect(threadOfferUnsentOf(kept, "thread-1", "toolu_a")).toStrictEqual(
      confirmed,
    );
    expect(threadOfferUnsentRead(kept)).toHaveLength(2);
    threadOfferUnsentLetGo(kept, "thread-1", "toolu_a");
    expect(threadOfferUnsentOf(kept, "thread-1", "toolu_a")).toBeUndefined();
    expect(threadOfferUnsentOf(kept, "thread-2", "toolu_a")).toStrictEqual(
      declined,
    );
  });

  test("is kept to a bound, the oldest let go first, and nothing is read from what is not a list of them", () => {
    const kept = store();
    for (let at = 0; at <= threadOfferUnsentMax; at += 1)
      threadOfferUnsentKept(kept, "thread-1", {
        ...declined,
        call: `call-${String(at)}`,
      });
    expect(threadOfferUnsentRead(kept)).toHaveLength(threadOfferUnsentMax);
    expect(threadOfferUnsentOf(kept, "thread-1", "call-0")).toBeUndefined();
    for (const garbage of ["{", "[1]", '[{"session":"t","reply":{}}]'])
      expect(
        threadOfferUnsentRead({
          ...kept,
          read: (key) => (key === threadOfferUnsentKey ? garbage : null),
        }),
      ).toStrictEqual([]);
  });
});
