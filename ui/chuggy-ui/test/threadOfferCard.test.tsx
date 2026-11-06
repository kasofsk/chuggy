/**
 * An offer drawn as a card: Confirm runs the member's own operation at the
 * version offered and then replies, Decline replies and runs nothing, a card
 * whose subject moved past the version offered has no Confirm, and a card the
 * mailbox holds a reply for is drawn settled and reads nothing.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { threadOfferReplyText } from "../../../src/contract/threadOffers.ts";
import {
  ThreadOfferCard,
  useThreadOfferDrawn,
} from "../app/browser/thread/ThreadOfferCard.tsx";
import type { ThreadOfferCall } from "../app/core/threadOffers.ts";
import {
  answer,
  openedStream,
  operationAt,
  queryClientUnretried,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { creationDraft } from "./ticketCreationFixture.ts";
import { threadBody, threadTurn } from "./threadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

const release: ThreadOfferCall = {
  offer: "Release",
  call: "toolu_release",
  ticket: 12,
  authoringVersion: 3,
};

const revoke: ThreadOfferCall = {
  offer: "Revoke",
  call: "toolu_revoke",
  ticket: 11,
  revision: 1,
};

const pendingTicket = {
  ticket: 11,
  phase: "Pending",
  sequence: 9,
  ...ticketInstants,
};

/** The API as a card meets it: the draft and the ticket as a case names
 * them, every submission accepted and settled done, and every reply taken. */
function served(
  draft: unknown = creationDraft,
  ticket: unknown = pendingTicket,
) {
  return scriptedFetch((request: SentRequest) => {
    if (request.url.includes("/offer-replies"))
      return answer({ turn: "t", ordinal: 4 }, 202);
    if (request.method === "POST")
      return answer({ operation: "op-one", state: "Pending" }, 202);
    if (request.url.includes("/operations/"))
      return answer({
        ...(operationAt("Succeeded") as object),
        decidedSequence: 9,
      });
    if (request.url.includes("/drafts/12")) return answer(draft);
    if (request.url.includes("/tickets/11")) return answer(ticket);
    return answer({
      partition: atlas,
      sequence: 9,
      tickets: [{ ...pendingTicket, ticket: 12 }],
    });
  });
}

async function drawn(
  offer: ThreadOfferCall,
  api: ReturnType<typeof served>,
  reply?: Parameters<typeof ThreadOfferCard>[0]["reply"],
): Promise<void> {
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={queryClientUnretried()}
      transport={openedStream().ports.fetch}
    >
      <ThreadOfferCard
        partition={atlas}
        session="thread-geoff"
        offer={offer}
        reply={reply}
      />
    </ScreenHarness>,
  );
  await settled();
}

function posted(api: ReturnType<typeof served>, path: string): unknown[] {
  return api.sent
    .filter((sent) => sent.method === "POST" && sent.url.endsWith(path))
    .map((sent) => sent.body);
}

test("Confirm releases exactly the version offered, as the member, and then replies with what it came to", async () => {
  const api = served();
  await drawn(release, api);

  await turned(() => {
    screen.getByRole("button", { name: "Confirm" }).click();
  });
  await settled();

  expect(posted(api, "/operations")).toStrictEqual([
    {
      operation: expect.any(String) as unknown,
      mutation: {
        mutation: "ReleaseDraft",
        ticket: 12,
        authoringVersion: 3,
        configurationRevision: "r3",
      },
    },
  ]);
  expect(posted(api, "/offer-replies")).toStrictEqual([
    {
      turn: "offer-reply-toolu_release",
      reply: {
        call: "toolu_release",
        decision: "Confirmed",
        outcome: "Succeeded",
      },
    },
  ]);
  expect(screen.getByRole("status").textContent).toBe("Released");
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
});

test("Decline replies and submits nothing", async () => {
  const api = served();
  await drawn(revoke, api);

  await turned(() => {
    screen.getByRole("button", { name: "Decline" }).click();
  });
  await settled();

  expect(posted(api, "/operations")).toStrictEqual([]);
  expect(posted(api, "/offer-replies")).toStrictEqual([
    {
      turn: "offer-reply-toolu_revoke",
      reply: { call: "toolu_revoke", decision: "Declined" },
    },
  ]);
  expect(screen.getByRole("status").textContent).toBe("Declined");
});

test("Confirm revokes the offered ticket at the revision offered", async () => {
  const api = served();
  await drawn(revoke, api);

  await turned(() => {
    screen.getByRole("button", { name: "Confirm" }).click();
  });
  await settled();

  expect(posted(api, "/operations")).toStrictEqual([
    {
      operation: expect.any(String) as unknown,
      mutation: { mutation: "RevokeTicket", ticket: 11 },
    },
  ]);
});

test("a card whose draft or ticket moved past the version offered is superseded, and offers no Confirm", async () => {
  for (const [offer, api] of [
    [release, served({ ...creationDraft, authoringVersion: 4 })],
    [revoke, served(creationDraft, { ...pendingTicket, revision: 2 })],
  ] as const) {
    await drawn(offer, api);
    expect(
      screen.getByText("Superseded · It changed since this was offered"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    cleanup();
  }
});

test("a card the mailbox holds a reply for is drawn settled, and reads and sends nothing", async () => {
  const api = served();
  await drawn(release, api, {
    call: "toolu_release",
    decision: "Confirmed",
    outcome: "Refused",
    refusal: "AuthoringChanged",
  });

  expect(screen.getByText("Not released · AuthoringChanged")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
  expect(
    api.sent.filter((sent) => sent.url.includes("/drafts/")),
  ).toStrictEqual([]);
});

test("the reader's own thread draws a card for each offer, settled by the reply its mailbox holds, and another member's draws none", async () => {
  const api = served();
  vi.stubGlobal("fetch", api.fetch);
  const replied = threadTurn({
    turn: "offer-reply-toolu_release",
    ordinal: 2,
    inputKind: "OfferReply",
    input: threadOfferReplyText({
      call: "toolu_release",
      decision: "Declined",
    }),
  });
  const thread = threadBody({
    turns: [threadTurn({ turn: "thread-turn-1" }), replied],
  });
  const step = {
    step: "ToolCall",
    id: "toolu_release",
    name: "mcp__chuggy__offer_release",
    input: { ticket: 12, authoringVersion: 3 },
  } as const;
  const others = renderHook(() =>
    useThreadOfferDrawn(atlas, { ...thread, mine: false }),
  );
  expect(others.result.current).toBeUndefined();
  const mine = renderHook(() => useThreadOfferDrawn(atlas, thread));
  const drawnOffer: ReactNode = mine.result.current?.(step);
  expect(
    mine.result.current?.({ step: "Thinking", text: "weighing it" }),
  ).toBeNull();
  render(
    <ScreenHarness
      partition={atlas}
      client={queryClientUnretried()}
      transport={openedStream().ports.fetch}
    >
      {drawnOffer}
    </ScreenHarness>,
  );
  await settled();
  expect(screen.getByText("Declined")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});
