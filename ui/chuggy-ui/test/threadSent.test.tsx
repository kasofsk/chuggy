/**
 * A message the reader sends, from the press: drawn before the door answers,
 * and once — never twice and never gone — while the door takes it, the mailbox
 * comes to list it, the store comes to hold its ask, and the mailbox's tail
 * moves past it. A press the door refuses is drawn once too, back in the box.
 *
 * A screenshot pasted is sent with the message and the session's turn names
 * it, a sent turn draws the images it named from the project's own read of
 * each, and an upload that fails is said over the box with the text and the
 * image handed back and no message sent.
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
import {
  threadImageLine,
  threadImagesHeading,
  threadTurnBoundaryHeading,
} from "../../../src/contract/threadSeeding.ts";
import { conversationAskMessage } from "../app/core/conversation.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame, streamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import {
  threadConversationMounted,
  threadReadsAnswered,
} from "./threadConversationMount.tsx";
import { threadBody, threadTurn } from "./threadFixture.ts";

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
    const read = threadReadsAnswered(url, entries);
    if (read !== undefined) return Promise.resolve(read);
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

const artifact = "image/png:token-1";

/** A turn's input as the message door composes one naming `artifact`. */
const namingInput = `${threadImagesHeading}\n\n${threadImageLine({
  artifact,
  mediaType: "image/png",
  path: `/api/v1/tenants/acme/projects/atlas/artifacts/${encodeURIComponent(artifact)}`,
})}\n\n${threadTurnBoundaryHeading}\n\nwhat is wrong here`;

interface ImagesAsked {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/** The door a case's page asks: the reads answered at once, the image read
 * answered with `AQID`, and each upload and message as the case says. */
function imagesMounted(script: {
  readonly turns?: Parameters<typeof threadBody>[0]["turns"];
  readonly upload?: () => Response;
}): ImagesAsked[] {
  const asked: ImagesAsked[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    asked.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    const read = threadReadsAnswered(url, []);
    if (read !== undefined) return Promise.resolve(read);
    if (url.includes("/artifacts/"))
      return Promise.resolve(
        answer({ content: "AQID", mediaType: "image/png", encoding: "base64" }),
      );
    if (url.endsWith("/artifacts"))
      return Promise.resolve(
        script.upload?.() ?? answer({ artifact, digest: "d" }, 201),
      );
    if (url.endsWith("/messages"))
      return Promise.resolve(answer({ turn: "t", ordinal: 1 }, 202));
    return Promise.resolve(answer({ code: "NotFound" }, 404));
  });
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
  threadConversationMounted(threadBody({ turns: script.turns ?? [] }), server);
  return asked;
}

async function pastedAndSent(text: string): Promise<void> {
  fireEvent.paste(box(), {
    clipboardData: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "shot", { type: "image/png" }),
      ],
    },
  });
  await screen.findByRole("img", { name: "Image 1" });
  fireEvent.change(box(), { target: { value: text } });
  await waitFor(() => {
    expect(box().value).toBe(text);
  });
  await act(async () => {
    fireEvent.keyDown(box(), { key: "Enter" });
    await Promise.resolve();
  });
  await settled();
}

test("a pasted screenshot is uploaded and the message the session is sent names it", async () => {
  const asked = imagesMounted({});
  await settled();
  await pastedAndSent("what is wrong here");
  const posts = asked.filter((one) => one.method === "POST");
  expect(posts.map((one) => one.url.split("/").at(-1))).toStrictEqual([
    "artifacts",
    "messages",
  ]);
  expect(posts[1]?.body).toMatchObject({
    message: "what is wrong here",
    images: [artifact],
  });
  styleless();
});

test("a sent turn draws each image it named from the project's own read, and no Context card for it", async () => {
  const asked = imagesMounted({
    turns: [
      threadTurn({
        turn: "turn-1",
        input: namingInput,
        state: "Queued",
        result: undefined,
      }),
    ],
  });
  const drawn = await screen.findByRole("img", { name: "Image sent" });
  expect(drawn.getAttribute("src")).toBe("data:image/png;base64,AQID");
  expect(
    asked.some((one) =>
      one.url.endsWith(`/artifacts/${encodeURIComponent(artifact)}`),
    ),
  ).toBe(true);
  expect(screen.queryByText("Context")).toBeNull();
  expect(screen.getByText("what is wrong here")).toBeDefined();
  styleless();
});

test("an upload that fails is said over the box, nothing is sent, and the text and the image are handed back", async () => {
  const asked = imagesMounted({
    upload: () =>
      answer({ error: { code: "ArtifactTooLarge" }, bytesMax: 1 }, 413),
  });
  await settled();
  await pastedAndSent("what is wrong here");
  await screen.findByText("Not sent · Image too large");
  expect(asked.some((one) => one.url.endsWith("/messages"))).toBe(false);
  await waitFor(() => {
    expect(box().value).toBe("what is wrong here");
  });
  expect(screen.getByRole("img", { name: "Image 1" })).toBeDefined();
  styleless();
});

test("a turn's images section is read off its context into the images it names", () => {
  expect(conversationAskMessage(namingInput)).toStrictEqual({
    ask: "Message",
    text: "what is wrong here",
    images: [artifact],
  });
});
