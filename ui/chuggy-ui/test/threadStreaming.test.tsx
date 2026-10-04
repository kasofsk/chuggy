/**
 * One thread's turn, written out a moment at a time: a scripted live stream, a
 * scripted store and a scripted mailbox under the thread's own conversation,
 * with what a reader is shown read back after each.
 *
 * The three sources are moved one at a time, because that is what a reader
 * watches: the stream says what is being written, the store comes to hold it
 * a while later, and the mailbox settles last. A case that moved two at once
 * would not see what is drawn between them.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type {
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadTurnResponse,
} from "../../../src/contract/responses.ts";
import type { ThreadLiveBlock } from "../../../src/contract/threadLive.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import { ThreadConversation } from "../app/browser/thread/ThreadConversation.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, holderDouble, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamOpening, StreamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import {
  threadBody,
  threadPartition,
  threadStream,
  threadTurn,
} from "./threadFixture.ts";

type StoreEntry = ThreadTranscriptResponse["entries"][number];

function entry(uuid: string, type: string, message: unknown): StoreEntry {
  return { uuid, type, timestamp: "2026-09-02T10:00:00Z", message };
}

const asked = "where does 41 stand";

/** The store as its session writes it: a batch per flush, each read from the
 * cursor it is asked at. */
const earlier: readonly StoreEntry[] = [
  entry("uuid-a", "user", { content: "is 40 open" }),
  entry("uuid-b", "assistant", {
    id: "msg_before",
    content: [{ type: "text", text: "40 is open." }],
  }),
];

const firstMessage: readonly StoreEntry[] = [
  entry("uuid-c", "user", { content: asked }),
  entry("uuid-d", "assistant", {
    id: "msg_a",
    content: [{ type: "thinking", thinking: "", signature: "sig" }],
  }),
  entry("uuid-e", "assistant", {
    id: "msg_a",
    content: [{ type: "text", text: "Looking at 41." }],
  }),
  entry("uuid-f", "assistant", {
    id: "msg_a",
    content: [
      { type: "tool_use", id: "toolu_1", name: "Read", input: { path: "41" } },
    ],
  }),
  entry("uuid-g", "user", {
    content: [
      { type: "tool_result", tool_use_id: "toolu_1", content: "waits on 40" },
    ],
  }),
];

const secondMessage: readonly StoreEntry[] = [
  entry("uuid-h", "assistant", {
    id: "msg_b",
    content: [{ type: "text", text: "It is **blocked** by 40." }],
  }),
];

/** Holds every transcript read asked while it is held, until released. */
interface Gate {
  held: boolean;
  readonly release: () => void;
}

interface Script {
  readonly server: StreamServer;
  /** The store's batches, which a case adds to as the session flushes. */
  readonly batches: (readonly StoreEntry[])[];
  readonly draw: (thread: ThreadResponse) => void;
  readonly container: HTMLElement;
  readonly gate: Gate;
  readonly unmount: () => void;
}

function page(
  batches: readonly (readonly StoreEntry[])[],
  after: number,
): ThreadTranscriptResponse {
  const entries = batches.slice(after).flat();
  return {
    stream: threadStream,
    entries,
    held: entries.flatMap((held) =>
      held.uuid === undefined ? [] : [held.uuid],
    ),
    cut: 1,
    elided: 0,
    truncated: false,
    ...(after < batches.length ? { nextAfter: batches.length } : {}),
  };
}

const held: StreamOpening = {
  status: 200,
  chunks: [frame("ready", undefined, { version: 1 })],
  hold: true,
};

function snapshot(of: {
  readonly turn?: string;
  readonly message?: string;
  readonly blocks: readonly ThreadLiveBlock[];
}): string {
  return frame("snapshot", undefined, { version: 1, held: of });
}

const nothingHeld = snapshot({ blocks: [] });

function scripted(
  thread: ThreadResponse,
  liveOpenings: readonly StreamOpening[],
): Script {
  const server = streamServer([held], "token", liveOpenings);
  const batches: (readonly StoreEntry[])[] = [earlier];
  const waiting: (() => void)[] = [];
  const gate: Gate = {
    held: false,
    release: () => {
      gate.held = false;
      for (const read of waiting.splice(0)) read();
    },
  };
  vi.stubGlobal("fetch", (url: string) => {
    if (!url.includes("/transcript"))
      return Promise.resolve(answer({ code: "NotFound" }, 404));
    const after = Number(
      new URL(url, "http://console").searchParams.get("after"),
    );
    if (!gate.held) return Promise.resolve(answer(page(batches, after)));
    return new Promise((resolve) => {
      waiting.push(() => {
        resolve(answer(page(batches, after)));
      });
    });
  });
  const holder = holderDouble();
  const client = new QueryClient();
  const drawn = (shown: ThreadResponse): ReactNode => (
    <SessionProvider holder={holder}>
      <QueryClientProvider client={client}>
        <ProjectStreamProvider
          partition={threadPartition}
          transport={server.ports.fetch}
        >
          <ThreadConversation partition={threadPartition} thread={shown} />
        </ProjectStreamProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = render(drawn(thread));
  return {
    server,
    batches,
    gate,
    container: view.container,
    draw: (shown) => {
      view.rerender(drawn(shown));
    },
    unmount: () => {
      view.unmount();
    },
  };
}

const before = threadTurn({
  turn: "turn-1",
  ordinal: 1,
  input: "is 40 open",
  result: "40 is open.",
});

/** The turn being answered, which carries what it came to only once the
 * mailbox has settled it. */
function turnAt(state: ThreadTurnResponse["state"]): ThreadTurnResponse {
  if (state === "Answered")
    return threadTurn({ turn: "turn-2", ordinal: 2, input: asked });
  return {
    turn: "turn-2",
    ordinal: 2,
    inputKind: "UserMessage",
    input: asked,
    state,
    tools: [],
  };
}

const toolRunning: readonly StoreEntry[] = [
  entry("uuid-c", "user", { content: asked }),
  entry("uuid-e", "assistant", {
    id: "msg_a",
    content: [{ type: "text", text: "Running the gates." }],
  }),
  entry("uuid-f", "assistant", {
    id: "msg_a",
    content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }],
  }),
];

function threadAt(
  state: ThreadTurnResponse["state"] | undefined,
  batches: number,
): ThreadResponse {
  return threadBody({
    batches,
    turns: state === undefined ? [before] : [before, turnAt(state)],
  });
}

function live(event: unknown): string {
  return frame("live", undefined, { version: 1, turn: "turn-2", event });
}

function began(message: string, index: number, kind: string, name?: string) {
  return live({
    live: "Block",
    message,
    index,
    kind,
    ...(name === undefined ? {} : { name }),
  });
}

function wrote(message: string, index: number, offset: number, text: string) {
  return live({ live: "Text", message, index, offset, text });
}

/** What a reader is shown of the turn being answered. */
function shown(container: HTMLElement): {
  readonly answer: string | undefined;
  readonly card: string | undefined;
  readonly cardLive: boolean;
  readonly writing: boolean;
  readonly engine: boolean;
  readonly standing: string | undefined;
} {
  const messages = container.querySelectorAll("[data-message-id]");
  const last = messages.item(messages.length - 1);
  const card = last.querySelector(".conversation-trigger");
  return {
    answer: last.querySelector(".run-report-bare")?.textContent ?? undefined,
    card: card?.textContent ?? undefined,
    cardLive: last.querySelector(".conversation-glyph-live") !== null,
    writing: last.querySelector(".conversation-writing") !== null,
    engine: container.querySelector(".conversation-waiting-engine") !== null,
    standing:
      last.lastElementChild?.firstElementChild?.textContent ?? undefined,
  };
}

async function until(
  container: HTMLElement,
  expected: Partial<ReturnType<typeof shown>>,
): Promise<void> {
  await waitFor(() => {
    expect(shown(container)).toMatchObject(expected);
  });
}

function answerNode(container: HTMLElement): Element {
  const reports = container.querySelectorAll(".run-report-bare");
  const found = reports.item(reports.length - 1);
  return found;
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The turn up to its first message being written and stored: sent, thought
 * about, begun, and a tool called and answered. */
async function firstMessageStored(script: Script): Promise<void> {
  script.draw(threadAt("Claimed", 1));
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  script.server.pushLive(began("msg_a", 1, "Text"));
  script.server.pushLive(wrote("msg_a", 1, 0, "Looking at 41."));
  script.server.pushLive(began("msg_a", 2, "ToolUse", "Read"));
  await until(script.container, { answer: "Looking at 41.", card: "Read" });
  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, { card: "Working" });
}

test("a turn as it is written: the wait, the thought, the words and the tool", async () => {
  const script = scripted(threadAt(undefined, 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  expect(script.server.liveSeen).toHaveLength(0);
  expect(shown(script.container)).toMatchObject({ answer: "40 is open." });

  script.draw(threadAt("Queued", 1));
  await until(script.container, {
    answer: undefined,
    card: undefined,
    engine: true,
    standing: "Queued",
  });
  expect(script.server.liveSeen).toHaveLength(1);

  script.draw(threadAt("Claimed", 1));
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  await until(script.container, {
    answer: undefined,
    card: "Thinking",
    cardLive: true,
    engine: true,
  });

  script.server.pushLive(began("msg_a", 1, "Text"));
  script.server.pushLive(wrote("msg_a", 1, 0, "Looking "));
  script.server.pushLive(wrote("msg_a", 1, 8, "at 41."));
  await until(script.container, {
    answer: "Looking at 41.",
    card: "Thought",
    cardLive: false,
    writing: true,
    engine: false,
  });
  const first = answerNode(script.container);

  script.server.pushLive(began("msg_a", 2, "ToolUse", "Read"));
  await until(script.container, {
    answer: "Looking at 41.",
    card: "Read",
    cardLive: true,
    writing: false,
  });

  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, { card: "Working", cardLive: true });
  expect(shown(script.container).answer).toBe("Looking at 41.");
  expect(answerNode(script.container)).toBe(first);
  styleless();
});

test("a turn as it ends: whole, then stored, then settled, and nothing moves", async () => {
  const script = scripted(threadAt("Queued", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  await firstMessageStored(script);

  script.server.pushLive(began("msg_b", 0, "Text"));
  script.server.pushLive(wrote("msg_b", 0, 0, "It is **blocked** by 40."));
  await until(script.container, {
    answer: "It is blocked by 40.",
    card: "Thought · 1 tool · 1 note",
    cardLive: false,
    writing: true,
  });

  script.server.pushLive(live({ live: "End" }));
  await until(script.container, { writing: false, standing: "Claimed" });
  const whole = answerNode(script.container);
  const markup = script.container.innerHTML;

  script.batches.push(secondMessage);
  script.draw(threadAt("Claimed", 3));
  await settled();
  expect(answerNode(script.container)).toBe(whole);
  expect(script.container.innerHTML).toBe(markup);

  expect(script.server.aborts).toHaveLength(0);
  script.draw(threadAt("Answered", 3));
  await until(script.container, { standing: "Answered" });
  expect(answerNode(script.container)).toBe(whole);
  expect(whole.outerHTML).toContain("<strong>blocked</strong>");
  expect(shown(script.container)).toMatchObject({
    answer: "It is blocked by 40.",
    card: "Thought · 1 tool · 1 note",
    cardLive: false,
    writing: false,
    engine: false,
  });
  expect(script.server.aborts).toHaveLength(1);
  expect(script.server.liveSeen).toHaveLength(1);
  styleless();
});

test("a reader who opens the thread part way through an answer starts from what is held", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    {
      status: 200,
      chunks: [
        snapshot({
          turn: "turn-2",
          message: "msg_a",
          blocks: [
            { index: 0, kind: "Text", text: "It is blo", gapped: false },
          ],
        }),
      ],
      hold: true,
    },
  ]);
  await until(script.container, { answer: "It is blo", writing: true });
  script.server.pushLive(wrote("msg_a", 0, 9, "cked."));
  await until(script.container, { answer: "It is blocked." });
});

test("a stream that is refused draws the thread as its transcript alone, and says nothing", async () => {
  const script = scripted(threadAt("Claimed", 1), []);
  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, {
    answer: "Looking at 41.",
    card: "Working",
    cardLive: true,
    writing: false,
  });
  expect(script.server.liveSeen).toHaveLength(1);
  expect(script.container.querySelector('[role="alert"]')).toBe(null);
  expect(script.container.textContent).not.toMatch(/fail|error|lost|retry/iu);
});

test("a block heard with a gap in it is never drawn as text", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "It is "));
  await until(script.container, { answer: "It is" });
  script.server.pushLive(wrote("msg_a", 0, 40, "by 40."));
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Read"));
  await until(script.container, { card: "Read" });
  expect(shown(script.container).answer).toBe("It is");
});

test("a first turn being written says nothing of the store it has not written yet", async () => {
  const streamless = (state: ThreadTurnResponse["state"]): ThreadResponse =>
    threadBody({ streamless: true, turns: [{ ...turnAt(state), ordinal: 1 }] });
  const script = scripted(streamless("Queued"), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  expect(script.container.textContent).not.toContain("No store");
  script.draw(streamless("Claimed"));
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "Looking at 41."));
  await until(script.container, { answer: "Looking at 41." });
  expect(script.container.textContent).not.toContain("No store");
  script.draw(streamless("Failed"));
  await settled();
  expect(script.container.textContent).toContain("No store");
});

test("the runner naming the thread's store mid-turn does not take the words away to say Loading", async () => {
  const streamless = (state: ThreadTurnResponse["state"]): ThreadResponse =>
    threadBody({ streamless: true, turns: [{ ...turnAt(state), ordinal: 1 }] });
  const script = scripted(streamless("Claimed"), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "Looking at 41."));
  await until(script.container, { answer: "Looking at 41." });
  const first = answerNode(script.container);
  const seen: string[] = [];
  const watching = new MutationObserver(() => {
    seen.push(script.container.textContent);
  });
  watching.observe(script.container, { childList: true, subtree: true });
  script.batches.splice(0, 1, [firstMessage[0] as StoreEntry]);
  script.draw(
    threadBody({ batches: 1, turns: [{ ...turnAt("Claimed"), ordinal: 1 }] }),
  );
  await settled();
  watching.disconnect();
  expect(seen.some((text) => text.includes("Loading"))).toBe(false);
  expect(answerNode(script.container)).toBe(first);
  expect(shown(script.container).answer).toBe("Looking at 41.");
});

test("the hub forgetting a session in the middle of a tool does not draw the turn as finished", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "Running the gates."));
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Bash"));
  await until(script.container, { card: "Bash", cardLive: true });
  script.batches.push(toolRunning);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, {
    answer: "Running the gates.",
    card: "Bash",
    cardLive: true,
  });
  script.server.pushLive(nothingHeld);
  await settled();
  await settled();
  expect(shown(script.container)).toMatchObject({
    answer: "Running the gates.",
    card: "Bash",
    cardLive: true,
    standing: "Claimed",
  });
});

test("text a failed turn never stored leaves at settle and does not return while a later page is read", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.batches.push([entry("uuid-c", "user", { content: asked })]);
  script.draw(threadAt("Claimed", 2));
  await settled();
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "Half an answ"));
  await until(script.container, { answer: "Half an answ", writing: true });

  const failed: ThreadTurnResponse = {
    ...turnAt("Failed"),
    failure: "AgentFailed",
  };
  script.draw(threadBody({ batches: 2, turns: [before, failed] }));
  await settled();
  expect(script.container.textContent).not.toContain("Half an answ");

  script.gate.held = true;
  script.batches.push([entry("uuid-x", "user", { content: "try again" })]);
  const again: ThreadTurnResponse = {
    ...turnAt("Claimed"),
    turn: "turn-3",
    ordinal: 3,
    input: "try again",
  };
  script.draw(threadBody({ batches: 3, turns: [before, failed, again] }));
  await settled();
  expect(script.server.liveSeen).toHaveLength(2);
  script.server.pushLive(
    frame("live", undefined, {
      version: 1,
      turn: "turn-3",
      event: { live: "Block", message: "msg_c", index: 0, kind: "Thinking" },
    }),
  );
  await until(script.container, { card: "Thinking", cardLive: true });
  expect(script.container.textContent).not.toContain("Half an answ");
  script.gate.release();
  await settled();
  await settled();
  expect(script.container.textContent).not.toContain("Half an answ");
  expect(script.container.textContent).toContain("try again");
});

test("a settled turn's answer stays while the page holding it is still being read", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.batches.push([entry("uuid-c", "user", { content: asked })]);
  script.draw(threadAt("Claimed", 2));
  await settled();
  script.server.pushLive(began("msg_b", 0, "Text"));
  script.server.pushLive(wrote("msg_b", 0, 0, "It is **blocked** by 40."));
  script.server.pushLive(live({ live: "End" }));
  await until(script.container, {
    answer: "It is blocked by 40.",
    writing: false,
  });
  script.gate.held = true;
  script.batches.push(secondMessage);
  script.draw(threadAt("Answered", 3));
  await settled();
  expect(shown(script.container).answer).toBe("It is blocked by 40.");
  script.gate.release();
  await settled();
  await settled();
  expect(shown(script.container).answer).toBe("It is blocked by 40.");
});

test("a turn put back to wait after its attempt ended is drawn as waiting again", async () => {
  const script = scripted(threadAt("Queued", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  await until(script.container, { engine: true, standing: "Queued" });
  script.draw(threadAt("Claimed", 1));
  script.server.pushLive(live({ live: "End" }));
  await until(script.container, { engine: false });
  script.draw(threadAt("Queued", 1));
  await until(script.container, { engine: true, standing: "Queued" });
  script.draw(threadAt("Claimed", 1));
  await settled();
  expect(shown(script.container)).toMatchObject({ engine: true });
});

/** Frames asked for and not yet painted, each run only when a case says. */
function framesHeld(): {
  readonly paint: () => void;
  readonly pending: () => number;
  readonly cancelled: number[];
} {
  const asked = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    asked.set(next, callback);
    next += 1;
    return next - 1;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    cancelled.push(handle);
    asked.delete(handle);
  });
  return {
    paint: () => {
      const due = [...asked.values()];
      asked.clear();
      for (const callback of due) callback(performance.now());
    },
    pending: () => asked.size,
    cancelled,
  };
}

test("a burst of events is drawn at the next frame and not before, and a frame still owed is given up with the page", async () => {
  const frames = framesHeld();
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  frames.paint();
  await settled();
  const owed = frames.pending();
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Read"));
  script.server.pushLive(began("msg_a", 2, "ToolUse", "Bash"));
  await settled();
  expect(shown(script.container).card).toBeUndefined();
  expect(frames.pending()).toBe(owed + 1);
  frames.paint();
  await until(script.container, { card: "Bash", cardLive: true });

  script.server.pushLive(began("msg_a", 3, "ToolUse", "Grep"));
  await settled();
  expect(frames.pending()).toBeGreaterThan(0);
  script.unmount();
  expect(frames.cancelled.length).toBeGreaterThan(0);
  expect(frames.pending()).toBe(0);
});
