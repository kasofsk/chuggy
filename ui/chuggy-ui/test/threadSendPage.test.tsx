/**
 * A message names the page its reader pressed Send on: the page at that
 * press, none where the reader is on no page, and on a press that retries the
 * same turn, the page of that press.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ConsolePage } from "../../../src/contract/consolePage.ts";
import { useThreadSend } from "../app/browser/thread/threadSend.tsx";
import { answer } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { threadPartition } from "./threadFixture.ts";
import { threadSendWrapped } from "./threadSendWrapped.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface SentBody {
  readonly turn: string;
  readonly page?: ConsolePage;
}

/** Every message body the door is handed, each answered by the next response
 * a case names and taken where it names none. */
function messagesPosted(answers: (() => Response)[] = []): SentBody[] {
  const bodies: SentBody[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        answer(sessionPlacementBody({ thread: "InCluster" })),
      );
    if (!url.endsWith("/messages"))
      return Promise.resolve(new Response(null, { status: 404 }));
    bodies.push(
      JSON.parse(
        typeof init.body === "string" ? init.body : "null",
      ) as SentBody,
    );
    return Promise.resolve(
      answers.shift()?.() ?? answer({ turn: "t", ordinal: 1 }, 202),
    );
  });
  return bodies;
}

function sendingFrom(page: ConsolePage | undefined) {
  return renderHook(
    (props: { readonly page: ConsolePage | undefined }) =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
        page: props.page,
      }),
    { wrapper: threadSendWrapped(), initialProps: { page } },
  );
}

async function pressed(
  result: ReturnType<typeof sendingFrom>["result"],
  text: string,
): Promise<void> {
  await act(async () => {
    await result.current.composer.onSend(text, []);
  });
}

test("a message names the page its reader pressed Send on", async () => {
  const bodies = messagesPosted();
  const sending = sendingFrom({ page: "Ticket", ticket: 41 });

  await pressed(sending.result, "what is blocking it?");
  sending.rerender({ page: { page: "TicketEdit", ticket: 41 } });
  await pressed(sending.result, "and now?");

  expect(bodies.map((body) => body.page)).toEqual([
    { page: "Ticket", ticket: 41 },
    { page: "TicketEdit", ticket: 41 },
  ]);
});

test("a message sent from no page names none", async () => {
  const bodies = messagesPosted();
  const sending = sendingFrom(undefined);

  await pressed(sending.result, "what is blocking it?");

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).not.toHaveProperty("page");
});

test("pressing again under the same turn names the page of that press", async () => {
  const backlogged = () =>
    new Response(JSON.stringify({ error: { code: "ThreadBacklogged" } }), {
      status: 429,
      headers: { "retry-after": "0" },
    });
  const bodies = messagesPosted([backlogged, backlogged, backlogged]);
  const sending = sendingFrom({ page: "Ticket", ticket: 41 });

  await pressed(sending.result, "what is blocking it?");
  const kept = bodies.length;
  sending.rerender({ page: { page: "Inbox" } });
  await pressed(sending.result, "what is blocking it?");

  expect(bodies).toHaveLength(kept + 1);
  expect(bodies.at(-1)?.turn).toBe(bodies[0]?.turn);
  expect(bodies[0]?.page).toEqual({ page: "Ticket", ticket: 41 });
  expect(bodies.at(-1)?.page).toEqual({ page: "Inbox" });
});
