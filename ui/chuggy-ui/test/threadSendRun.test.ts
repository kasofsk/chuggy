/**
 * Every arm of one press of `Send`, over scripted ports and with no renderer.
 *
 * THE ARMS THAT MATTER ARE THE ONES THAT COULD REPORT A MESSAGE AS SENT. The
 * composer clears the box and discards the text on `Sent`, so an arm that
 * answered it where nothing had been enqueued would tell a member their message
 * landed with nothing in any mailbox. Any read a press makes is answered a
 * fault, so a press that read anything could not pass quietly.
 */

import { expect, test } from "vitest";

import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { threadMessageSent } from "../app/core/threadSendRun.ts";
import { threadRefusalWord } from "../app/core/threads.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { threadHome, threadOtherSession } from "./threadFixture.ts";

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

/** The ports one press runs over: every post is scripted and recorded with the
 * session it was addressed to, and every read is unscripted. */
function serving(served: Served): Run {
  const posted: { url: string; turn: string }[] = [];
  let presses = 0;
  const fetch = (
    url: string,
    init?: { readonly method?: string; readonly body?: string | Uint8Array },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      const body = JSON.parse(
        typeof init.body === "string" ? init.body : "null",
      ) as { readonly turn: string };
      posted.push({ url, turn: body.turn });
      const at = presses;
      presses += 1;
      return Promise.resolve((served.posts[at] ?? unscripted)());
    }
    return Promise.resolve(unscripted());
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

test("a press the door accepts is sent", async () => {
  const run = serving({
    posts: [answered({ turn: message.turn, ordinal: 4 }, 202)],
  });
  expect(
    await threadMessageSent(run.ports, threadHome, threadOtherSession, message),
  ).toStrictEqual({ send: "Sent", ordinal: 4 });
  expect(run.posted().length).toBe(1);
});

/** The door refuses another member's session before it enqueues, so the
 * refusal is the whole answer and nothing is read or sent after it. */
test("a session not the caller's is refused, and nothing is sent elsewhere", async () => {
  const run = serving({ posts: [disputed] });
  expect(
    await threadMessageSent(run.ports, threadHome, threadOtherSession, message),
  ).toStrictEqual({
    send: "Refused",
    what: "Send",
    cause: threadRefusalWord("NotYourThread"),
  });
  expect(run.posted().length, "a refused press was sent again").toBe(1);
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
    threadHome,
    threadOtherSession,
    message,
  );
  expect(answer.send).toBe("Refused");
  expect(run.posted().length).toBe(1);
});
