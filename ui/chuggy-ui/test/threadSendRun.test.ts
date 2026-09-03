/**
 * Every arm of one press of `Send`, over scripted ports and with no renderer.
 *
 * THE ARMS THAT MATTER ARE THE ONES THAT COULD REPORT A MESSAGE AS SENT. The
 * composer clears the box and discards the text on `Sent`, so an arm that
 * answered it where nothing had been enqueued would tell a member their message
 * landed with nothing in any mailbox — and three of these arms are reachable
 * only when a read fails or a membership has gone, which no renderer case
 * arranges. So each one is a case here, at the tier that can express it.
 */

import { expect, test } from "vitest";

import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { threadMessageSent } from "../app/core/threadSendRun.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  threadBody,
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
  threadTurn,
} from "./threadFixture.ts";

const message = { turn: "thread-turn-a", message: "into the race" };

/**
 * One scripted response, in the media type the contract's own reader insists on
 * so a case cannot pass over a body the console would refuse. IT IS A FACTORY
 * AND NOT A VALUE: a `Response` body is read once, so a shared instance answers
 * the second reader an empty body and every case past the first would fail for
 * a reason no case is about.
 */
function answered(body: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": nativeHttpMediaType },
    });
}

interface Served {
  /** What `POST …/messages` answers, in the order the presses arrive. */
  readonly posts: readonly (() => Response)[];
  readonly listing?: () => Response;
  readonly standing?: () => Response;
}

interface Run {
  readonly ports: ApiPorts;
  readonly posted: () => readonly {
    readonly url: string;
    readonly turn: string;
  }[];
}

/** What a case that reached a read it did not script gets, so an unscripted
 * read fails the case rather than passing quietly. */
const unscripted = answered(
  { error: { code: "Unscripted", message: "no" } },
  500,
);

/** The ports one press runs over: every read the settlement makes is scripted
 * and every post is recorded with the session it was addressed to. */
function serving(served: Served): Run {
  const posted: { url: string; turn: string }[] = [];
  let presses = 0;
  const fetch = (
    url: string,
    init?: { readonly method?: string; readonly body?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "null") as { readonly turn: string };
      posted.push({ url, turn: body.turn });
      const at = presses;
      presses += 1;
      return Promise.resolve((served.posts[at] ?? unscripted)());
    }
    if (url.endsWith("/threads"))
      return Promise.resolve((served.listing ?? unscripted)());
    return Promise.resolve((served.standing ?? unscripted)());
  };
  return {
    ports: {
      fetch,
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
    posted: () => posted,
  };
}

const disputed = answered(
  { error: { code: "NotYourThread", message: "elsewhere" } },
  403,
);

/** The listing as the door's own answer implies it: the URL's session is not
 * the caller's, and the one that is, is marked. */
const listed = answered({
  threads: [
    threadEntry({ session: threadMineSession, mine: true }),
    threadEntry({ session: threadOtherSession }),
  ],
});

test("a press the door accepts is sent and settles nothing", async () => {
  const run = serving({
    posts: [answered({ turn: message.turn, ordinal: 4 }, 202)],
  });
  expect(
    await threadMessageSent(
      run.ports,
      threadPartition,
      threadOtherSession,
      message,
    ),
  ).toStrictEqual({ send: "Sent", ordinal: 4 });
  expect(run.posted().length, "an accepted press was settled anyway").toBe(1);
});

/**
 * The mailbox the message may have reached is the listing's `mine`, so a
 * listing that could not be read leaves the console unable to say whether it
 * landed — and saying it did would discard the text.
 */
test("a listing that could not be read is refused, never reported as sent", async () => {
  const run = serving({
    posts: [disputed],
    listing: answered({ error: { code: "InternalError", message: "no" } }, 500),
  });
  const answer = await threadMessageSent(
    run.ports,
    threadPartition,
    threadOtherSession,
    message,
  );
  expect(
    answer.send,
    "a settlement that could not reach the listing said the message landed",
  ).toBe("Refused");
  expect(run.posted().length, "it sent again over an unread listing").toBe(1);
});

/**
 * A membership revoked while a member was typing: the page still holds a read
 * saying the thread is theirs, the press earns the 403, and the listing then
 * carries no thread of theirs at all.
 */
test("a member with no thread of their own is refused, never reported as sent", async () => {
  const run = serving({
    posts: [disputed],
    listing: answered({
      threads: [threadEntry({ session: threadOtherSession })],
    }),
  });
  const answer = await threadMessageSent(
    run.ports,
    threadPartition,
    threadOtherSession,
    message,
  );
  expect(
    answer.send,
    "a member whose thread is gone was told their message landed",
  ).toBe("Refused");
  expect(run.posted().length).toBe(1);
});

test("a mailbox that could not be read is refused, never reported as sent", async () => {
  const run = serving({
    posts: [disputed],
    listing: listed,
    standing: answered(
      { error: { code: "InternalError", message: "no" } },
      500,
    ),
  });
  const answer = await threadMessageSent(
    run.ports,
    threadPartition,
    threadOtherSession,
    message,
  );
  expect(
    answer.send,
    "a settlement that could not read the mailbox said the message landed",
  ).toBe("Refused");
  expect(run.posted().length, "it sent again over an unread mailbox").toBe(1);
});

/** The turn being in the mailbox is the whole of what settles it: the door
 * enqueued before it compared, so there is nothing to send again. */
test("a mailbox holding the turn is sent, and is not sent again", async () => {
  const run = serving({
    posts: [disputed],
    listing: listed,
    standing: answered(
      threadBody({
        session: threadMineSession,
        turns: [threadTurn({ turn: message.turn, ordinal: 7 })],
      }),
    ),
  });
  expect(
    await threadMessageSent(
      run.ports,
      threadPartition,
      threadOtherSession,
      message,
    ),
  ).toStrictEqual({ send: "Sent", ordinal: 7 });
  expect(
    run.posted().length,
    "a message the mailbox already held was sent a second time",
  ).toBe(1);
});

/** A mailbox without the turn is a message that never landed, sent to the
 * session that resolved and under the identity the first press minted. */
test("a mailbox without the turn is sent again there, under the same turn", async () => {
  const run = serving({
    posts: [disputed, answered({ turn: message.turn, ordinal: 9 }, 202)],
    listing: listed,
    standing: answered(
      threadBody({
        session: threadMineSession,
        turns: [threadTurn({ turn: "thread-turn-other", ordinal: 6 })],
      }),
    ),
  });
  expect(
    await threadMessageSent(
      run.ports,
      threadPartition,
      threadOtherSession,
      message,
    ),
  ).toStrictEqual({ send: "Sent", ordinal: 9 });
  const posts = run.posted();
  expect(posts.length).toBe(2);
  expect(posts[1]?.turn, "the second send minted a fresh identity").toBe(
    message.turn,
  );
  expect(
    posts[1]?.url.includes(`/threads/${threadMineSession}/messages`),
    "the second send went somewhere other than the mailbox that resolved",
  ).toBe(true);
});

/**
 * THE SECOND SEND IS THE LAST. A settlement that settled its own second
 * refusal would read the listing and the mailbox again on every round, which
 * is a loop with a network in it.
 */
test("a second send the door disputes again is reported, not settled again", async () => {
  const run = serving({
    posts: [disputed, disputed],
    listing: listed,
    standing: answered(
      threadBody({
        session: threadMineSession,
        turns: [threadTurn({ turn: "thread-turn-other", ordinal: 6 })],
      }),
    ),
  });
  const answer = await threadMessageSent(
    run.ports,
    threadPartition,
    threadOtherSession,
    message,
  );
  expect(answer.send, "a second dispute was settled rather than reported").toBe(
    "Refused",
  );
  expect(run.posted().length, "the settlement sent a third time").toBe(2);
});

/** Every other rejection is the door's answer and not a race, so it is
 * reported without a read of its own. */
test("a rejection that is not a dispute is reported without settling", async () => {
  const run = serving({
    posts: [
      answered({ error: { code: "MessageTooLong", message: "no" } }, 400),
    ],
  });
  const answer = await threadMessageSent(
    run.ports,
    threadPartition,
    threadOtherSession,
    message,
  );
  expect(answer.send).toBe("Refused");
  expect(run.posted().length).toBe(1);
});
