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

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type {
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadTurnResponse,
} from "../../../src/contract/responses.ts";
import type { ThreadLiveBlock } from "../../../src/contract/threadLive.ts";
import { streamReopenDelayMsMin } from "../app/core/streamConnection.ts";
import { moving } from "./conversationMoving.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamOpening, StreamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import { threadConversationMounted } from "./threadConversationMount.tsx";
import { threadBody, threadStream, threadTurn } from "./threadFixture.ts";

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
  first: readonly StoreEntry[] = earlier,
): Script {
  const server = streamServer([held], "token", liveOpenings);
  const batches: (readonly StoreEntry[])[] = [first];
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
  return {
    server,
    batches,
    gate,
    ...threadConversationMounted(thread, server),
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

/** The parts of an answer in the order they are drawn: a text as its words,
 * and a line of the work as its words between brackets. */
function partsDrawn(answer: Element): readonly string[] {
  return Array.from(
    answer.querySelectorAll(".run-report-bare, .conversation-work-line"),
    (part) =>
      part.classList.contains("conversation-work-line")
        ? `[${part.textContent}]`
        : part.textContent,
  );
}

/** What a reader is shown of the turn being answered: the last text of its
 * answer and the last line of its work, every part of it in order, what moves,
 * and the word under it where one is shown. */
function shown(container: HTMLElement): {
  readonly answer: string | undefined;
  readonly card: string | undefined;
  readonly drawn: readonly string[];
  readonly moving: readonly string[];
  readonly writing: boolean;
  readonly engine: boolean;
  readonly standing: string | undefined;
} {
  const messages = container.querySelectorAll("[data-message-id]");
  const last = messages.item(messages.length - 1);
  return {
    answer:
      Array.from(last.querySelectorAll(".run-report-bare")).at(-1)
        ?.textContent ?? undefined,
    card:
      Array.from(last.querySelectorAll(".conversation-work-line")).at(-1)
        ?.textContent ?? undefined,
    drawn: partsDrawn(last),
    moving: moving(container),
    writing: last.querySelector(".conversation-writing") !== null,
    engine: container.querySelector(".conversation-waiting-engine") !== null,
    standing:
      last.querySelector(
        '.conversation-meta p [role="status"]:not(.visually-hidden)',
      )?.textContent ?? undefined,
  };
}

/** Every text of the newest answer under a root, read each time anything
 * drawn under it changes. */
function textsWatched(root: HTMLElement): {
  readonly seen: readonly (readonly string[])[];
  readonly stop: () => void;
} {
  const seen: (readonly string[])[] = [];
  const read = (): void => {
    const last = Array.from(root.querySelectorAll(".conversation-answer")).at(
      -1,
    );
    seen.push(
      Array.from(
        last?.querySelectorAll(".run-report-bare") ?? [],
        (text) => text.textContent,
      ),
    );
  };
  const watching = new MutationObserver(read);
  watching.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return {
    seen,
    stop: () => {
      read();
      watching.disconnect();
    },
  };
}

/** Every text once drawn is still drawn at each later reading, in its place,
 * beginning as it did and no shorter. */
function onlyGrew(seen: readonly (readonly string[])[]): void {
  seen.forEach((now, at) => {
    const before = seen[at - 1] ?? [];
    expect(now.length).toBeGreaterThanOrEqual(before.length);
    before.forEach((text, place) => {
      expect(now[place]?.startsWith(text)).toBe(true);
    });
  });
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
    drawn: [],
    moving: ["engine"],
    standing: undefined,
  });
  expect(script.server.liveSeen).toHaveLength(1);

  script.draw(threadAt("Claimed", 1));
  await settled();
  expect(shown(script.container)).toMatchObject({
    drawn: [],
    moving: ["engine"],
    standing: undefined,
  });
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  await until(script.container, {
    drawn: ["[Thinking]"],
    moving: ["card"],
    engine: false,
    standing: undefined,
  });

  script.server.pushLive(began("msg_a", 1, "Text"));
  script.server.pushLive(wrote("msg_a", 1, 0, "Looking "));
  script.server.pushLive(wrote("msg_a", 1, 8, "at 41."));
  await until(script.container, {
    drawn: ["[Thought]", "Looking at 41."],
    moving: ["mark"],
    writing: true,
    standing: undefined,
  });
  const first = answerNode(script.container);

  script.server.pushLive(began("msg_a", 2, "ToolUse", "Read"));
  await until(script.container, {
    drawn: ["[Thought]", "Looking at 41.", "[Read]"],
    moving: ["card"],
    writing: false,
    standing: undefined,
  });
  expect(answerNode(script.container)).toBe(first);

  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, {
    drawn: ["[Thought]", "Looking at 41.", "[Working]"],
    moving: ["card"],
    standing: undefined,
  });
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
  const drawnWhole = [
    "[Thought]",
    "Looking at 41.",
    "[1 tool]",
    "It is blocked by 40.",
  ];
  await until(script.container, {
    drawn: drawnWhole,
    moving: ["mark"],
    writing: true,
  });

  script.server.pushLive(live({ live: "End" }));
  await until(script.container, {
    writing: false,
    moving: [],
    standing: undefined,
  });
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
    drawn: drawnWhole,
    moving: [],
    writing: false,
    standing: "Answered",
  });
  expect(script.server.aborts).toHaveLength(1);
  expect(script.server.liveSeen).toHaveLength(1);
  styleless();
});

const plainSecond: readonly StoreEntry[] = [
  entry("uuid-h", "assistant", {
    id: "msg_b",
    content: [{ type: "text", text: "It is blocked by 40." }],
  }),
];

/** Says a text a few characters at a time, as a runner posts it. */
function wroteByThrees(
  script: Script,
  message: string,
  index: number,
  text: string,
): void {
  for (let offset = 0; offset < text.length; offset += 3)
    script.server.pushLive(
      wrote(message, index, offset, text.slice(offset, offset + 3)),
    );
}

test("an answer heard a few characters at a time around a tool, then stored, settled and read afresh: every text drawn only ever grows, and reads the same afresh", async () => {
  const script = scripted(threadAt("Queued", 1), oneOpening);
  await settled();
  const watched = textsWatched(script.container);
  const drawnWhole = [
    "[Thought]",
    "Looking at 41.",
    "[1 tool]",
    "It is blocked by 40.",
  ];

  script.draw(threadAt("Claimed", 1));
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  script.server.pushLive(began("msg_a", 1, "Text"));
  wroteByThrees(script, "msg_a", 1, "Looking at 41.");
  await until(script.container, { drawn: ["[Thought]", "Looking at 41."] });
  const first = script.container.querySelectorAll(".run-report-bare").item(1);

  script.server.pushLive(began("msg_a", 2, "ToolUse", "Read"));
  await until(script.container, { card: "Read" });
  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, { card: "Working" });

  script.server.pushLive(began("msg_b", 0, "Text"));
  wroteByThrees(script, "msg_b", 0, "It is blocked by 40.");
  await until(script.container, { drawn: drawnWhole, moving: ["mark"] });
  script.server.pushLive(live({ live: "End" }));
  await until(script.container, { moving: [] });
  script.batches.push(plainSecond);
  script.draw(threadAt("Claimed", 3));
  await settled();
  script.draw(threadAt("Answered", 3));
  await until(script.container, { standing: "Answered" });
  await settled();
  watched.stop();

  expect(watched.seen.length).toBeGreaterThan(drawnWhole.length);
  onlyGrew(watched.seen);
  expect(script.container.querySelectorAll(".run-report-bare").item(1)).toBe(
    first,
  );
  expect(shown(script.container).drawn).toEqual(drawnWhole);

  script.unmount();
  const afresh = scripted(threadAt("Answered", 1), oneOpening, [
    ...earlier,
    ...firstMessage,
    ...plainSecond,
  ]);
  await until(afresh.container, { drawn: drawnWhole, standing: "Answered" });
  styleless();
});

test("a reader who opens the thread part way through an answer is shown what is held whole, and only what follows at a pace", async () => {
  const watched = textsWatched(document.body);
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
  watched.stop();
  const texts = watched.seen.flatMap((seen) => seen.slice(0, 1));
  expect(texts[0]).toBe("It is blo");
  expect(new Set(texts).size).toBeGreaterThan(2);
  onlyGrew(watched.seen);
});

test("a stream cut in the middle of an answer goes on from the snapshot of its next opening, and nothing is said of it", async () => {
  const failures: unknown[] = [];
  const failed = (event: PromiseRejectionEvent | ErrorEvent): void => {
    failures.push(event);
  };
  window.addEventListener("unhandledrejection", failed);
  window.addEventListener("error", failed);
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
    {
      status: 200,
      chunks: [
        snapshot({
          turn: "turn-2",
          message: "msg_a",
          blocks: [
            { index: 0, kind: "Text", text: "It is blocked", gapped: false },
          ],
        }),
      ],
      hold: true,
    },
  ]);
  await settled();
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "It is blo"));
  await until(script.container, { answer: "It is blo", writing: true });
  const words = script.container.textContent;
  script.server.cutLive();
  await settled();
  expect(script.container.textContent).toBe(words);
  expect(shown(script.container)).toMatchObject({
    answer: "It is blo",
    moving: ["mark"],
    standing: undefined,
  });
  await waitFor(
    () => {
      expect(shown(script.container).answer).toBe("It is blocked");
    },
    { timeout: streamReopenDelayMsMin * 3 },
  );
  expect(script.server.liveSeen).toHaveLength(2);
  script.server.pushLive(wrote("msg_a", 0, 13, " by 40."));
  await until(script.container, {
    answer: "It is blocked by 40.",
    writing: true,
    moving: ["mark"],
  });
  expect(script.container.querySelector('[role="alert"]')).toBeNull();
  expect(failures).toEqual([]);
  window.removeEventListener("unhandledrejection", failed);
  window.removeEventListener("error", failed);
});

test("a stream that is refused draws the thread as its transcript alone, and says nothing", async () => {
  const script = scripted(threadAt("Claimed", 1), []);
  script.batches.push(firstMessage);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, {
    drawn: ["[Thought]", "Looking at 41.", "[Working]"],
    moving: ["card"],
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
  await until(script.container, { answer: "It is", moving: ["mark"] });
  script.server.pushLive(wrote("msg_a", 0, 40, "by 40."));
  await settled();
  expect(shown(script.container)).toMatchObject({
    drawn: ["It is"],
    moving: ["mark"],
  });
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Read"));
  await until(script.container, { card: "Read" });
  expect(shown(script.container)).toMatchObject({
    drawn: ["It is", "[Read]"],
    moving: ["card"],
  });
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
  await until(script.container, { card: "Bash", moving: ["card"] });
  script.batches.push(toolRunning);
  script.draw(threadAt("Claimed", 2));
  await until(script.container, {
    drawn: ["Running the gates.", "[Bash]"],
    moving: ["card"],
  });
  script.server.pushLive(nothingHeld);
  await settled();
  await settled();
  expect(shown(script.container)).toMatchObject({
    drawn: ["Running the gates.", "[Bash]"],
    moving: ["card"],
    standing: undefined,
  });
});

function liveOf(turn: string, event: unknown): string {
  return frame("live", undefined, { version: 1, turn, event });
}

/** A turn that failed part way through its text, then the next one sent and
 * taken while the page of the store holding its ask is still being read. */
async function failedThenSentAgain(script: Script): Promise<void> {
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
}

/** The page of the store that was held is read, and nothing of the failed
 * turn's text has come back with it. */
async function readWithoutTheFailedText(script: Script): Promise<void> {
  expect(script.container.textContent).not.toContain("Half an answ");
  script.gate.release();
  await settled();
  await settled();
  expect(script.container.textContent).not.toContain("Half an answ");
  expect(script.container.textContent).toContain("try again");
}

test("text a failed turn never stored leaves at settle and does not return while a later page is read", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await failedThenSentAgain(script);
  script.server.pushLive(
    liveOf("turn-3", {
      live: "Block",
      message: "msg_c",
      index: 0,
      kind: "Thinking",
    }),
  );
  await until(script.container, { card: "Thinking", moving: ["card"] });
  await readWithoutTheFailedText(script);
});

test("a snapshot still naming a failed turn while the next is out brings none of its text back", async () => {
  const stillHeld = snapshot({
    turn: "turn-2",
    message: "msg_a",
    blocks: [{ index: 0, kind: "Text", text: "Half an answer", gapped: false }],
  });
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
    { status: 200, chunks: [stillHeld], hold: true },
  ]);
  await failedThenSentAgain(script);
  await settled();
  expect(shown(script.container)).toMatchObject({
    answer: undefined,
    moving: ["engine"],
    standing: undefined,
  });
  await readWithoutTheFailedText(script);
});

test("a failed turn's last words and its end, heard while the next is written, are drawn nowhere and end nothing", async () => {
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await failedThenSentAgain(script);
  const next = { message: "msg_c", index: 0 };
  script.server.pushLive(
    liveOf("turn-3", { live: "Block", ...next, kind: "Text" }),
  );
  script.server.pushLive(
    liveOf("turn-3", { live: "Text", ...next, offset: 0, text: "Trying" }),
  );
  await until(script.container, { answer: "Trying", moving: ["mark"] });
  script.server.pushLive(
    liveOf("turn-2", {
      live: "Text",
      message: "msg_a",
      index: 0,
      offset: 12,
      text: "er",
    }),
  );
  script.server.pushLive(liveOf("turn-2", { live: "End" }));
  script.server.pushLive(
    liveOf("turn-3", { live: "Text", ...next, offset: 6, text: " again" }),
  );
  await until(script.container, {
    answer: "Trying again",
    writing: true,
    moving: ["mark"],
    standing: undefined,
  });
  await readWithoutTheFailedText(script);
  expect(shown(script.container)).toMatchObject({
    answer: "Trying again",
    moving: ["mark"],
  });
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
  await until(script.container, { engine: true, moving: ["engine"] });
  script.draw(threadAt("Claimed", 1));
  script.server.pushLive(live({ live: "End" }));
  await until(script.container, { engine: false, moving: [] });
  script.draw(threadAt("Queued", 1));
  await until(script.container, { engine: true, moving: ["engine"] });
  script.draw(threadAt("Claimed", 1));
  await settled();
  expect(shown(script.container)).toMatchObject({ engine: true });
});

const oneOpening: readonly StreamOpening[] = [
  { status: 200, chunks: [nothingHeld], hold: true },
];

const twoOpenings: readonly StreamOpening[] = [...oneOpening, ...oneOpening];

/** The turn taken and its ask stored, with nothing written yet. */
async function askStored(script: Script): Promise<void> {
  await settled();
  script.batches.push([entry("uuid-c", "user", { content: asked })]);
  script.draw(threadAt("Claimed", 2));
  await settled();
}

/** Every answer on the page: its text, and the word under it. */
function halves(
  container: HTMLElement,
): readonly (readonly [string | undefined, string | undefined])[] {
  return Array.from(
    container.querySelectorAll(".conversation-answer"),
    (half) =>
      [
        half.querySelector(".run-report-bare")?.textContent ?? undefined,
        half.querySelector(
          '.conversation-meta p [role="status"]:not(.visually-hidden)',
        )?.textContent ?? undefined,
      ] as const,
  );
}

/** What the store comes to hold of a message that went by while the stream
 * was down: the thought heard before the cut, and a tool called and answered. */
const missed: readonly StoreEntry[] = [
  entry("uuid-d", "assistant", {
    id: "msg_a",
    content: [{ type: "thinking", thinking: "", signature: "sig" }],
  }),
  entry("uuid-f", "assistant", {
    id: "msg_b",
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

/** Every answer the newest exchange is drawn with from here on, in order. */
function answersWatched(container: HTMLElement): {
  readonly seen: readonly string[];
  readonly stop: () => void;
} {
  const seen: string[] = [];
  const watching = new MutationObserver(() => {
    const now = shown(container).answer ?? "<none>";
    if (seen.at(-1) !== now) seen.push(now);
  });
  watching.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return {
    seen,
    stop: () => {
      watching.disconnect();
    },
  };
}

test("a stream cut while a message went by unheard: the answer being written stays when the store catches up with what was missed", async () => {
  const script = scripted(threadAt("Claimed", 1), twoOpenings);
  await askStored(script);
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  await until(script.container, { card: "Thinking" });
  script.server.cutLive();
  await waitFor(
    () => {
      expect(script.server.liveSeen).toHaveLength(2);
    },
    { timeout: streamReopenDelayMsMin * 3 },
  );
  await settled();
  script.server.pushLive(began("msg_c", 0, "Text"));
  script.server.pushLive(wrote("msg_c", 0, 0, "It is blo"));
  await until(script.container, { answer: "It is blo", writing: true });
  const watched = answersWatched(script.container);
  script.batches.push(missed);
  script.draw(threadAt("Claimed", 3));
  await until(script.container, { card: "Thought · 1 tool" });
  script.server.pushLive(wrote("msg_c", 0, 9, "cked by 40."));
  await until(script.container, { answer: "It is blocked by 40." });
  script.batches.push([
    entry("uuid-h", "assistant", {
      id: "msg_c",
      content: [{ type: "text", text: "It is blocked by 40." }],
    }),
  ]);
  script.draw(threadAt("Claimed", 4));
  await settled();
  await settled();
  watched.stop();
  expect(watched.seen).not.toContain("<none>");
  expect(shown(script.container).answer).toBe("It is blocked by 40.");
});

test("a message abandoned part way leaves once the transcript holds its replacement, which was never heard", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await askStored(script);
  script.server.pushLive(began("msg_x", 0, "Text"));
  script.server.pushLive(wrote("msg_x", 0, 0, "Hello, I will"));
  await until(script.container, { answer: "Hello, I will" });
  script.batches.push([
    entry("uuid-y", "assistant", {
      id: "msg_y",
      content: [{ type: "text", text: "Hello, I will do it." }],
    }),
  ]);
  script.draw(threadAt("Claimed", 3));
  await until(script.container, { answer: "Hello, I will do it." });
});

test("a message first heard while its ask's page was being read leaves for its replacement all the same", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await settled();
  script.gate.held = true;
  script.batches.push([entry("uuid-c", "user", { content: asked })]);
  script.draw(threadAt("Claimed", 2));
  await settled();
  script.server.pushLive(began("msg_x", 0, "Text"));
  script.server.pushLive(wrote("msg_x", 0, 0, "Hello, I will"));
  await until(script.container, { answer: "Hello, I will" });
  script.gate.release();
  await settled();
  await settled();
  script.batches.push([
    entry("uuid-y", "assistant", {
      id: "msg_y",
      content: [{ type: "text", text: "Hello, I will do it." }],
    }),
  ]);
  script.draw(threadAt("Claimed", 3));
  await until(script.container, { answer: "Hello, I will do it." });
  script.server.pushLive(began("msg_z", 0, "Thinking"));
  await until(script.container, { card: "Thinking", writing: false });
  expect(shown(script.container).answer).toBe("Hello, I will do it.");
});

test("a message heard while a page is being read stays when that page lands holding messages stored before it", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await settled();
  script.gate.held = true;
  script.batches.push([entry("uuid-c", "user", { content: asked }), ...missed]);
  script.draw(threadAt("Claimed", 2));
  await settled();
  script.server.pushLive(began("msg_c", 0, "Text"));
  script.server.pushLive(wrote("msg_c", 0, 0, "It is blo"));
  await until(script.container, { answer: "It is blo" });
  const watched = answersWatched(script.container);
  script.gate.release();
  await until(script.container, { card: "Thought · 1 tool" });
  await settled();
  watched.stop();
  expect(watched.seen).not.toContain("<none>");
  expect(shown(script.container).answer).toBe("It is blo");
});

test("a turn put back to wait part way through its text, then taken again, is drawn with the next attempt's text alone", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await askStored(script);
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "It is blo"));
  await until(script.container, { answer: "It is blo" });
  script.server.pushLive(live({ live: "End" }));
  script.draw(threadAt("Queued", 2));
  await until(script.container, { answer: undefined, engine: true });
  script.draw(threadAt("Claimed", 2));
  await settled();
  script.server.pushLive(began("msg_b", 0, "Text"));
  script.server.pushLive(wrote("msg_b", 0, 0, "It is blocked by 40."));
  await until(script.container, { answer: "It is blocked by 40." });
});

const exhausted: ThreadTurnResponse = {
  ...turnAt("Failed"),
  failure: "AgentTurnsExhausted",
};

function sentAgain(state: ThreadTurnResponse["state"]): ThreadTurnResponse {
  return { ...turnAt(state), turn: "turn-3", ordinal: 3 };
}

test("a turn that ran and failed keeps its stored words while the same thing is sent again, taken, written and stored", async () => {
  const script = scripted(threadAt("Claimed", 1), twoOpenings);
  await settled();
  script.batches.push([
    entry("uuid-c", "user", { content: asked }),
    entry("uuid-e", "assistant", {
      id: "msg_a",
      content: [{ type: "text", text: "Half an answer" }],
    }),
  ]);
  const failed = ["Half an answer", "Failed"];
  const of = (batches: number, state: ThreadTurnResponse["state"]) =>
    threadBody({ batches, turns: [before, exhausted, sentAgain(state)] });
  script.draw(of(2, "Queued"));
  await waitFor(() => {
    expect(halves(script.container).slice(1)).toEqual([
      failed,
      [undefined, undefined],
    ]);
  });
  script.draw(of(2, "Claimed"));
  await settled();
  expect(halves(script.container).slice(1)).toEqual([
    failed,
    [undefined, undefined],
  ]);
  const retry = { message: "msg_c", index: 0 };
  script.server.pushLive(
    liveOf("turn-3", { live: "Block", ...retry, kind: "Text" }),
  );
  script.server.pushLive(
    liveOf("turn-3", { live: "Text", ...retry, offset: 0, text: "Again." }),
  );
  const written = [failed, ["Again.", undefined]];
  await waitFor(() => {
    expect(halves(script.container).slice(1)).toEqual(written);
  });
  script.batches.push([entry("uuid-x", "user", { content: asked })]);
  script.draw(of(3, "Claimed"));
  await settled();
  await settled();
  expect(halves(script.container).slice(1)).toEqual(written);
});

test("a turn its session reported failed keeps the words a page saw it store while the same thing is sent again and taken", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await settled();
  script.batches.push([
    entry("uuid-c", "user", { content: asked }),
    entry("uuid-e", "assistant", {
      id: "msg_a",
      content: [{ type: "text", text: "Half an answer" }],
    }),
  ]);
  script.draw(threadAt("Claimed", 2));
  await waitFor(() => {
    expect(halves(script.container).slice(1)).toEqual([
      ["Half an answer", undefined],
    ]);
  });
  const reported = { ...turnAt("Failed"), failure: "AgentFailed" as const };
  const failed = ["Half an answer", "Failed"];
  for (const state of ["Queued", "Claimed"] as const) {
    script.draw(
      threadBody({ batches: 2, turns: [before, reported, sentAgain(state)] }),
    );
    await waitFor(() => {
      expect(halves(script.container).slice(1)).toEqual([
        failed,
        [undefined, undefined],
      ]);
    });
    expect(shown(script.container).moving).toEqual(["engine"]);
  }
});

test("the turn being answered keeps its own stored work when an older answered turn asked the same and its exchange is not on the page", async () => {
  const old = threadTurn({
    turn: "turn-1",
    ordinal: 1,
    input: asked,
    result: "Old answer.",
  });
  const of = (batches: number): ThreadResponse =>
    threadBody({ batches, turns: [old, turnAt("Claimed")] });
  const script = scripted(of(1), oneOpening, []);
  await settled();
  script.batches.push(toolRunning);
  script.draw(of(2));
  await waitFor(() => {
    expect(shown(script.container)).toMatchObject({
      drawn: ["Running the gates.", "[Bash]"],
      moving: ["card"],
    });
  });
  script.server.pushLive(began("msg_b", 0, "Text"));
  script.server.pushLive(wrote("msg_b", 0, 0, "It is blocked by 40."));
  const written = ["Running the gates.", "[1 tool]", "It is blocked by 40."];
  await waitFor(() => {
    expect(shown(script.container).drawn).toEqual(written);
  });
  expect(
    script.container.querySelectorAll(".conversation-answer"),
  ).toHaveLength(1);
  script.batches.push([
    entry("uuid-h", "assistant", {
      id: "msg_b",
      content: [{ type: "text", text: "It is blocked by 40." }],
    }),
  ]);
  script.draw(of(3));
  await settled();
  await settled();
  expect(shown(script.container).drawn).toEqual(written);
});

/** The line under the newest answer: the box itself, its lead and its word. */
function lineUnder(container: HTMLElement): readonly (Element | null)[] {
  const answers = container.querySelectorAll(".conversation-answer");
  const last = answers.item(answers.length - 1);
  return [
    last.querySelector(".conversation-meta"),
    last.querySelector(".conversation-meta-lead"),
    last.querySelector('.conversation-meta p [role="status"]'),
  ];
}

/** What a reader is shown of a turn heard to end that the mailbox still says a
 * runner has. */
const quiet = {
  writing: false,
  moving: [],
  engine: false,
  standing: undefined,
};

const lastWords = "It is blocked by 40.";

/** The turn written to its last word and heard to end, the mailbox still
 * saying a runner has it. It answers with the line as it stood while written. */
async function heardToEnd(
  script: Script,
): Promise<readonly (Element | null)[]> {
  await askStored(script);
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, lastWords));
  await until(script.container, {
    answer: lastWords,
    moving: ["mark"],
    standing: undefined,
  });
  const working = lineUnder(script.container);
  script.server.pushLive(live({ live: "End" }));
  await until(script.container, quiet);
  return working;
}

function sameLine(script: Script, line: readonly (Element | null)[]): void {
  lineUnder(script.container).forEach((node, at) => {
    expect(node).not.toBeNull();
    expect(node).toBe(line[at]);
  });
}

test("from a turn's last word until the mailbox settles it, the line under it says nothing and keeps its place", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  const working = await heardToEnd(script);
  sameLine(script, working);
  expect(working[0]?.textContent).toBe("");
  expect(working[1]?.classList.contains("invisible")).toBe(true);
  script.batches.push([
    entry("uuid-h", "assistant", {
      id: "msg_a",
      content: [{ type: "text", text: lastWords }],
    }),
  ]);
  script.draw(threadAt("Claimed", 3));
  await settled();
  await settled();
  expect(shown(script.container)).toMatchObject({
    ...quiet,
    answer: lastWords,
  });
  script.draw(threadAt("Answered", 3));
  await until(script.container, { standing: "Answered", moving: [] });
  sameLine(script, working);
  expect(working[1]?.classList.contains("invisible")).toBe(false);
  expect(working[2]?.textContent).toBe("Answered");
  expect(working[2]?.parentElement?.childElementCount).toBeGreaterThan(1);
  styleless();
});

test("a turn heard to end that the mailbox settles failed shows its failure where the line said nothing", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  const working = await heardToEnd(script);
  const refusedStore: ThreadTurnResponse = {
    ...turnAt("Failed"),
    failure: "StoreRefused",
  };
  script.draw(threadBody({ batches: 2, turns: [before, refusedStore] }));
  await until(script.container, { standing: "Failed", moving: [] });
  sameLine(script, working);
  const answers = script.container.querySelectorAll(".conversation-answer");
  expect(
    answers.item(answers.length - 1).querySelector(".notice-detail")
      ?.textContent,
  ).toBe("StoreRefused");
});

test("more heard of a turn after its end brings the motion back, on the line of the work it is now at", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  const working = await heardToEnd(script);
  script.server.pushLive(began("msg_b", 0, "ToolUse", "Read"));
  await until(script.container, {
    drawn: [lastWords, "[Read]"],
    moving: ["card"],
    standing: undefined,
  });
  sameLine(script, working);
  expect(working[2]?.textContent).toBe("Working");
});

test("a turn heard to end that the mailbox says is waiting, then taken again, is drawn as a turn that is out", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await heardToEnd(script);
  script.draw(threadAt("Queued", 2));
  await until(script.container, {
    answer: undefined,
    moving: ["engine"],
    standing: undefined,
  });
  script.draw(threadAt("Claimed", 2));
  await settled();
  expect(shown(script.container)).toMatchObject({
    answer: undefined,
    moving: ["engine"],
  });
});

test("an end heard of another turn, or heard twice, changes nothing drawn", async () => {
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  await askStored(script);
  script.server.pushLive(began("msg_a", 0, "Text"));
  script.server.pushLive(wrote("msg_a", 0, 0, "It is blo"));
  await until(script.container, {
    answer: "It is blo",
    moving: ["mark"],
    standing: undefined,
  });
  const written = script.container.innerHTML;
  script.server.pushLive(liveOf("turn-1", { live: "End" }));
  script.server.pushLive(liveOf("turn-9", { live: "End" }));
  await settled();
  await settled();
  expect(script.container.innerHTML).toBe(written);

  script.server.pushLive(live({ live: "End" }));
  await until(script.container, quiet);
  const ended = script.container.innerHTML;
  script.server.pushLive(live({ live: "End" }));
  script.server.pushLive(liveOf("turn-9", { live: "End" }));
  script.server.pushLive(liveOf("turn-1", { live: "End" }));
  await settled();
  await settled();
  expect(script.container.innerHTML).toBe(ended);
});

test("a reader who asked for less motion is shown the same line: nothing from the last word, and the settling in its place", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const script = scripted(threadAt("Claimed", 1), oneOpening);
  const working = await heardToEnd(script);
  sameLine(script, working);
  script.draw(threadAt("Answered", 2));
  await until(script.container, { standing: "Answered", moving: [] });
  sameLine(script, working);
});

const hello = "hello";

/** A turn its runner took and failed without running, which the mailbox says
 * only that its session reported. */
const refused: ThreadTurnResponse = {
  turn: "turn-1",
  ordinal: 1,
  inputKind: "UserMessage",
  input: hello,
  state: "Failed",
  failure: "AgentFailed",
  tools: [],
};

function retried(state: ThreadTurnResponse["state"]): ThreadTurnResponse {
  if (state === "Answered")
    return threadTurn({
      turn: "turn-2",
      ordinal: 2,
      input: hello,
      result: "Hi, I am here.",
    });
  return {
    turn: "turn-2",
    ordinal: 2,
    inputKind: "UserMessage",
    input: hello,
    state,
    tools: [],
  };
}

/** Every answer on the page: its text, the word under it and the failure it
 * is drawn with. */
function halvesNoticed(
  container: HTMLElement,
): readonly (readonly (string | undefined)[])[] {
  const answers = container.querySelectorAll(".conversation-answer");
  return halves(container).map((half, at) => [
    ...half,
    answers.item(at).querySelector(".notice-detail")?.textContent ?? undefined,
  ]);
}

const refusedDrawn = [undefined, "Failed", "AgentFailed"];

test("a turn its session refused without running, sent again: the answer is the retry's as it is written, stored and settled", async () => {
  const of = (
    batches: number,
    turns: readonly ThreadTurnResponse[],
  ): ThreadResponse => threadBody({ batches, turns });
  const script = scripted(of(1, [refused]), oneOpening, []);
  await settled();
  expect(halvesNoticed(script.container)).toEqual([refusedDrawn]);
  script.draw(of(1, [refused, retried("Queued")]));
  await waitFor(() => {
    expect(halvesNoticed(script.container)).toEqual([
      refusedDrawn,
      [undefined, undefined, undefined],
    ]);
  });
  script.draw(of(1, [refused, retried("Claimed")]));
  await settled();
  script.batches.push([entry("uuid-c", "user", { content: hello })]);
  script.draw(of(2, [refused, retried("Claimed")]));
  await settled();
  script.server.pushLive(
    liveOf("turn-2", {
      live: "Block",
      message: "msg_a",
      index: 0,
      kind: "Text",
    }),
  );
  script.server.pushLive(
    liveOf("turn-2", {
      live: "Text",
      message: "msg_a",
      index: 0,
      offset: 0,
      text: "Hi, I am here.",
    }),
  );
  const written = [["Hi, I am here.", undefined, undefined], refusedDrawn];
  await waitFor(() => {
    expect(halvesNoticed(script.container)).toEqual(written);
  });
  script.batches.push([
    entry("uuid-d", "assistant", {
      id: "msg_a",
      content: [{ type: "text", text: "Hi, I am here." }],
    }),
  ]);
  script.draw(of(3, [refused, retried("Claimed")]));
  await settled();
  await settled();
  expect(halvesNoticed(script.container)).toEqual(written);
  script.draw(of(3, [refused, retried("Answered")]));
  await waitFor(() => {
    expect(halvesNoticed(script.container)).toEqual([
      ["Hi, I am here.", "Answered", undefined],
      refusedDrawn,
    ]);
  });
});

test("a refused turn and its answered retry, on a page opened afterwards: the answer stands under Answered and no failure", async () => {
  const script = scripted(
    threadBody({ batches: 1, turns: [refused, retried("Answered")] }),
    oneOpening,
    [
      entry("uuid-c", "user", { content: hello }),
      entry("uuid-d", "assistant", {
        id: "msg_a",
        content: [{ type: "text", text: "Hi, I am here." }],
      }),
    ],
  );
  await waitFor(() => {
    expect(halvesNoticed(script.container)).toEqual([
      ["Hi, I am here.", "Answered", undefined],
      refusedDrawn,
    ]);
  });
});

test("a thread whose stream was replaced: the new turn's stored words, none of them heard, are its own", async () => {
  const old = threadTurn({
    turn: "turn-1",
    ordinal: 1,
    input: asked,
    result: "Old answer.",
  });
  const body = threadBody({ batches: 1, turns: [old, turnAt("Claimed")] });
  const stored = [
    entry("uuid-c", "user", { content: asked }),
    entry("uuid-e", "assistant", {
      id: "msg_a",
      content: [{ type: "text", text: "New answer so far" }],
    }),
  ];
  const whole = scripted(body, oneOpening, stored);
  await waitFor(() => {
    expect(halves(whole.container)).toEqual([
      ["New answer so far", "Answered"],
      [undefined, undefined],
    ]);
  });
  whole.unmount();
  const replaced = scripted(
    { ...body, streams: [{ stream: "1a2b3c", batches: 4 }, ...body.streams] },
    oneOpening,
    stored,
  );
  await waitFor(() => {
    expect(halves(replaced.container)).toEqual([
      ["New answer so far", undefined],
    ]);
  });
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

test("a post heard again, having changed nothing, owes no frame", async () => {
  const frames = framesHeld();
  const script = scripted(threadAt("Claimed", 1), [
    { status: 200, chunks: [nothingHeld], hold: true },
  ]);
  await settled();
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Read"));
  await settled();
  frames.paint();
  await until(script.container, { card: "Read" });
  const owed = frames.pending();
  script.server.pushLive(began("msg_a", 0, "Thinking"));
  script.server.pushLive(began("msg_a", 1, "ToolUse", "Read"));
  await settled();
  expect(frames.pending()).toBe(owed);
  expect(shown(script.container).card).toBe("Read");
  script.server.pushLive(began("msg_a", 2, "ToolUse", "Bash"));
  await settled();
  expect(frames.pending()).toBe(owed + 1);
});

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
  await until(script.container, { card: "Bash", moving: ["card"] });

  script.server.pushLive(began("msg_a", 3, "ToolUse", "Grep"));
  await settled();
  expect(frames.pending()).toBeGreaterThan(0);
  script.unmount();
  expect(frames.cancelled.length).toBeGreaterThan(0);
  expect(frames.pending()).toBe(0);
});
