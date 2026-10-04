/**
 * A message the reader sends, from the press: drawn before the door answers,
 * and once — never twice and never gone — while the door takes it, the mailbox
 * comes to list it, the store comes to hold its ask, and the mailbox's tail
 * moves past it. A press the door refuses is drawn once too, back in the box.
 */

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type {
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadTurnResponse,
} from "../../../src/contract/responses.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { frame, streamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import { threadConversationMounted } from "./threadConversationMount.tsx";
import { threadBody, threadStream, threadTurn } from "./threadFixture.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type StoreEntry = ThreadTranscriptResponse["entries"][number];

function stored(uuid: string, type: string, text: string): StoreEntry {
  return {
    uuid,
    type,
    timestamp: "2026-09-02T10:00:00Z",
    message: { content: [{ type: "text", text }] },
  };
}

const before = threadTurn({
  turn: "turn-1",
  ordinal: 1,
  input: "is 40 open",
  result: "40 is open.",
});

const earlier: readonly StoreEntry[] = [
  stored("uuid-a", "user", "is 40 open"),
  stored("uuid-b", "assistant", "40 is open."),
];

/** One message post, held until the case answers it. */
interface Post {
  readonly turn: string;
  readonly message: string;
  readonly answered: (response: Response) => void;
}

interface Door {
  readonly posts: Post[];
  /** The store's entries, which a case adds to as the session writes. */
  readonly entries: StoreEntry[];
  readonly draw: (thread: ThreadResponse) => void;
  readonly container: HTMLElement;
}

/** The door a case's page asks: its reads answered at once from `entries`,
 * and each message posted held in `posts` until the case answers it. */
function doorAsked(
  posts: Post[],
  entries: readonly StoreEntry[],
): (
  url: string,
  init?: { readonly method?: string; readonly body?: string },
) => Promise<Response> {
  return (url, init) => {
    if (url.endsWith("/hosted-runs"))
      return Promise.resolve(answer({ granted: true }));
    if (url.endsWith("/session-placement"))
      return Promise.resolve(
        answer(sessionPlacementBody({ thread: "InCluster" })),
      );
    if (url.includes("/transcript"))
      return Promise.resolve(
        answer({
          stream: threadStream,
          entries,
          held: entries.flatMap((held) =>
            held.uuid === undefined ? [] : [held.uuid],
          ),
          cut: 1,
          elided: 0,
          truncated: false,
        }),
      );
    if (init?.method !== "POST" || !url.endsWith("/messages"))
      return Promise.resolve(answer({ code: "NotFound" }, 404));
    const sent = JSON.parse(init.body ?? "") as {
      readonly turn: string;
      readonly message: string;
    };
    return new Promise<Response>((answered) => {
      posts.push({ ...sent, answered });
    });
  };
}

function mounted(thread: ThreadResponse): Door {
  const posts: Post[] = [];
  const entries: StoreEntry[] = [...earlier];
  vi.stubGlobal("fetch", doorAsked(posts, entries));
  const server = streamServer(
    [
      {
        status: 200,
        chunks: [frame("ready", undefined, { version: 1 })],
        hold: true,
      },
    ],
    "token",
  );
  const view = threadConversationMounted(thread, server);
  return { posts, entries, container: view.container, draw: view.draw };
}

function box(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
}

/** The asks drawn that say `text`, each the element the library keeps for its
 * message. */
function asksSaying(container: HTMLElement, text: string): readonly Element[] {
  return Array.from(
    container.querySelectorAll('[data-message-id$="-ask"]'),
  ).filter((ask) => ask.textContent === text);
}

/** `text` typed and Enter pressed, and nothing waited on after the press but
 * what the press itself queued: no timer, and no answer from any door. */
async function entered(text: string): Promise<void> {
  fireEvent.change(box(), { target: { value: text } });
  await waitFor(() => {
    expect(box().value).toBe(text);
  });
  await act(async () => {
    fireEvent.keyDown(box(), { key: "Enter" });
    await Promise.resolve();
  });
}

function post(door: Door, at: number): Post {
  const held = door.posts[at];
  if (held === undefined) throw new Error(`no message was posted at ${at}`);
  return held;
}

async function accepted(held: Post, ordinal: number): Promise<void> {
  await act(async () => {
    held.answered(answer({ turn: held.turn, ordinal }, 202));
    await Promise.resolve();
  });
  await settled();
}

function listedAs(
  held: Post,
  state: ThreadTurnResponse["state"],
): ThreadTurnResponse {
  return {
    turn: held.turn,
    ordinal: 2,
    inputKind: "UserMessage",
    input: held.message,
    state,
    tools: [],
  };
}

const asked = "where does 41 stand";

test("a message is drawn at the press, before the door answers, with the engine under it", async () => {
  const door = mounted(threadBody({ turns: [before] }));
  await settled();
  await entered(asked);
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  expect(
    door.container.querySelector(".conversation-waiting-engine"),
  ).not.toBeNull();
  expect(box().value).toBe("");
  expect(post(door, 0).message).toBe(asked);
  styleless();
});

test("a message is drawn once while the door takes it, the mailbox lists it, the store holds it and the tail moves past it", async () => {
  const door = mounted(threadBody({ turns: [before] }));
  await settled();
  await entered(asked);
  const [drawn] = asksSaying(door.container, asked);
  const held = post(door, 0);
  await accepted(held, 2);
  expect(asksSaying(door.container, asked)).toStrictEqual([drawn]);

  door.draw(threadBody({ turns: [before, listedAs(held, "Queued")] }));
  await settled();
  expect(asksSaying(door.container, asked)).toStrictEqual([drawn]);

  door.entries.push(stored("uuid-c", "user", asked));
  door.draw(
    threadBody({ batches: 2, turns: [before, listedAs(held, "Claimed")] }),
  );
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(1);

  door.entries.push(stored("uuid-d", "assistant", "41 waits on 40."));
  door.draw(
    threadBody({ batches: 3, turns: [before, listedAs(held, "Answered")] }),
  );
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(1);

  door.draw(threadBody({ batches: 3, turns: [] }));
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  styleless();
});

test("a mailbox that lists the turn before the door answers draws the message once, and once after", async () => {
  const door = mounted(threadBody({ turns: [before] }));
  await settled();
  await entered(asked);
  const held = post(door, 0);
  door.draw(threadBody({ turns: [before, listedAs(held, "Queued")] }));
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  await accepted(held, 2);
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  door.draw(threadBody({ turns: [before] }));
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(0);
  styleless();
});

test("a message the door refuses leaves the column and is back in the box", async () => {
  const door = mounted(threadBody({ turns: [before] }));
  await settled();
  await entered(asked);
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  await act(async () => {
    post(door, 0).answered(answer({ error: { code: "Invalid" } }, 400));
    await Promise.resolve();
  });
  await settled();
  expect(asksSaying(door.container, asked)).toHaveLength(0);
  expect(box().value).toBe(asked);
  styleless();
});

test("two messages sent before the mailbox lists either are each drawn once, in the order sent", async () => {
  const door = mounted(threadBody({ turns: [before] }));
  await settled();
  await entered(asked);
  await entered("and 42");
  const said = (): readonly (string | null)[] =>
    Array.from(
      door.container.querySelectorAll('[data-message-id$="-ask"]'),
      (ask) => ask.textContent,
    ).slice(-2);
  expect(said()).toStrictEqual([asked, "and 42"]);
  await accepted(post(door, 0), 2);
  await accepted(post(door, 1), 3);
  expect(said()).toStrictEqual([asked, "and 42"]);
  door.draw(threadBody({ turns: [before, listedAs(post(door, 0), "Queued")] }));
  await settled();
  expect(said()).toStrictEqual([asked, "and 42"]);
  expect(asksSaying(door.container, asked)).toHaveLength(1);
  expect(asksSaying(door.container, "and 42")).toHaveLength(1);
  styleless();
});
