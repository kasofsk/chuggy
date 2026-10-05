/**
 * One press of Stop on a member's own thread, a moment at a time: what the
 * button says and when, what is drawn at the press and after each thing the
 * door, the stream, the store and the mailbox then say, and what a tab that
 * did not press is shown of the same turn.
 */

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import {
  interruptionRefusal,
  interruptionResult,
  interruptionSentence,
  interruptionToolSentence,
} from "./interruptionFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { streamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import { threadConversationMounted } from "./threadConversationMount.tsx";
import {
  threadBody,
  threadMineSession,
  threadStorePage,
} from "./threadFixture.ts";
import {
  stageAlarms,
  stageAnswered,
  stageAsked,
  stageBlock,
  stageBox,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageDoor,
  stageHeard,
  stageHeardBlock,
  stageInterrupted,
  stageLine,
  stageLiveOpening,
  stageMounted,
  stageProjectOpening,
  stageSent,
  stageStopped,
  stageTurn,
  stageWrote,
  stageFirstDrawn as opened,
  stageFirstStored as earlier,
  stageFirstTurn as before,
} from "./threadStopStage.tsx";
import type { Stage, StageDoors, StageEntry } from "./threadStopStage.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const asked = "where does 41 stand";
const heard = "It is blocked by 40, and 40 is";

type Ended = Parameters<typeof stageTurn>[3];

/** The thread with its second turn as a read lists it, over a store of
 * `batches` batches. */
function threadAt(ended: Ended, batches = 1): ThreadResponse {
  return threadBody({
    batches,
    turns: [before, stageTurn(2, "turn-2", asked, ended)],
  });
}

/** A page opened on the thread while its second turn is out. */
async function turnOut(
  ended: "Queued" | "Claimed",
  liveOpenings?: Parameters<typeof stageMounted>[2],
): Promise<Stage> {
  const stage = stageMounted(threadAt(ended), [earlier], liveOpenings);
  await settled();
  return stage;
}

/** The second turn's text heard down the stream, and drawn. */
async function textHeard(stage: Stage, text = heard): Promise<void> {
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "Text",
    text,
  });
  await stageColumnIs(stage.container, [...opened, `> ${asked}`, text]);
}

/** The store flushing one more batch, and the mailbox read that follows. */
async function flushed(
  stage: Stage,
  batch: readonly StageEntry[],
  ended: Ended,
): Promise<void> {
  stage.batches.push(batch);
  stage.draw(threadAt(ended, stage.batches.length));
  await settled();
}

/** A turn stopped while it was out: what the store is left holding of it, and
 * how the mailbox then lists it. */
function stoppedWhile(
  out: "Queued" | "Claimed",
): readonly [readonly StageEntry[], Ended] {
  return out === "Queued"
    ? [[], "Waited"]
    : [[stageAsked("u-c", asked), stageInterrupted("u-e")], "Stopped"];
}

/** The ink the word under the last answer is drawn in. */
function wordInk(container: HTMLElement): string | undefined {
  const words = container.querySelectorAll(
    '.conversation-meta p [role="status"]:not(.visually-hidden)',
  );
  return words.item(words.length - 1).className;
}

test("the button is Stop from the press and for as long as the turn is out, and Send again when it ends", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  expect(stageButton()).toBe("Send");

  await stageSent(asked);
  expect(stageButton(), "the door has not answered yet").toBe("Stop");
  const [sent] = stage.sends;
  const turn = sent?.turn ?? "";
  await stageAnswered(sent, { turn, ordinal: 2 }, 202);
  expect(stageButton()).toBe("Stop");

  for (const out of ["Queued", "Claimed"] as const) {
    stage.draw(threadBody({ turns: [before, stageTurn(2, turn, asked, out)] }));
    await settled();
    expect(stageButton(), out).toBe("Stop");
  }

  stage.batches.push([
    stageAsked("u-c", asked),
    stageWrote("u-d", "msg_a", "It is blocked by 40."),
  ]);
  stage.draw(
    threadBody({
      batches: 2,
      turns: [
        before,
        stageTurn(2, turn, asked, { answer: "It is blocked by 40." }),
      ],
    }),
  );
  await stageColumnIs(stage.container, [
    ...opened,
    `> ${asked}`,
    "It is blocked by 40. (Answered)",
  ]);
  expect(stageButton()).toBe("Send");
  expect(stage.stops).toStrictEqual([]);
});

test("a stop pressed before the door has taken its message stills the column at once and follows the message to the door", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  await stageStopped();
  const stopped = [...opened, `> ${asked}`, "(Stopped)"];
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  expect(stageButton()).toBe("Send");
  expect(stage.stops, "the door knows no such turn yet").toStrictEqual([]);

  const [sent] = stage.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 2 }, 202);
  expect(stage.stops.map((stop) => stop.turn)).toStrictEqual([sent?.turn]);
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
});

test("a stop of a message the door then hands back asks the door nothing, the message is back in the box, and sent again it is not stopped", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  await stageStopped();

  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  expect(stage.stops).toStrictEqual([]);
  expect(stageColumn(stage.container)).toStrictEqual(opened);
  expect(stageBox().value).toBe(asked);
  expect(stageButton()).toBe("Send");
  expect(stageAlarms(stage.container)).toStrictEqual([]);

  await stageSent(asked);
  expect(stage.sends[1]?.turn, "the text keeps its turn").toBe(
    stage.sends[0]?.turn,
  );
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    "",
  ]);
  expect(stageButton(), "sent again, it is out and not stopped").toBe("Stop");
});

test("Enter still sends while the button is Stop, Escape stops nothing, and one press ends the turn being answered and no other", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);

  await stageSent("and 42");
  expect(stage.sends.map((sent) => sent.message)).toStrictEqual(["and 42"]);
  expect(stageBox().value).toBe("");
  fireEvent.keyDown(stageBox(), { key: "Escape" });
  await settled();
  expect(stage.stops).toStrictEqual([]);
  expect(stageButton()).toBe("Stop");

  await stageStopped();
  expect(stage.stops.map((stop) => stop.turn)).toStrictEqual(["turn-2"]);
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    `${heard} (Stopped)`,
    "> and 42",
    "",
  ]);
  expect(stageButton(), "the message sent after it is still out").toBe("Stop");
});

test("a press while the answer is being written stops the drawing at once, and what was heard stays through every read after it", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  expect(stageAlarms(stage.container)).toStrictEqual(["mark"]);

  await stageStopped();
  const stopped = [...opened, `> ${asked}`, `${heard} (Stopped)`];
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  expect(wordInk(stage.container)).toBe("text-ink-3");
  expect(stageButton()).toBe("Send");
  expect(
    stage.stops.map((stop) => [stop.session, stop.turn, stop.body]),
  ).toStrictEqual([[threadMineSession, "turn-2", {}]]);

  stageHeard(stage, "turn-2", {
    live: "Text",
    message: "msg_a",
    index: 0,
    offset: heard.length,
    text: " waiting on a review.",
  });
  stageHeard(stage, "turn-2", { live: "End" });
  await settled();
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  await flushed(
    stage,
    [
      stageAsked("u-c", asked),
      stageWrote("u-d", "msg_a", heard),
      stageInterrupted("u-e"),
    ],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  expect(wordInk(stage.container)).toBe("text-ink-3");
  expect(stage.container.textContent).not.toContain(interruptionSentence);
  expect(stage.container.textContent).not.toContain("TurnStopped");
});

test("what was heard of a stopped answer stays where the store holds less of it", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  const stopped = [...opened, `> ${asked}`, `${heard} (Stopped)`];

  await flushed(
    stage,
    [stageAsked("u-c", asked), stageInterrupted("u-e")],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  stage.draw(threadAt("Stopped", stage.batches.length));
  await settled();
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
});

const longer = `${heard} waiting on a review.`;

/** What the store is left holding of the second turn where its text there is
 * `stored`. */
function storedAs(stored: string): readonly StageEntry[] {
  return [
    stageAsked("u-c", asked),
    stageWrote("u-d", "msg_a", stored),
    stageInterrupted("u-e"),
  ];
}

test.each([
  { said: "less of the text heard", stored: "It is blocked" },
  { said: "more of it", stored: longer },
  { said: "another text there", stored: "Stopped by" },
])(
  "a stopped answer's text stays as it stood at the press, where the store comes to hold $said",
  async ({ stored }) => {
    const stage = await turnOut("Claimed");
    await textHeard(stage);
    await stageStopped();
    await stageAnswered(stage.stops[0], { stopped: "Stopped" });

    for (const listed of ["Claimed", "Stopped"] as const) {
      stage.batches.splice(1);
      await flushed(stage, storedAs(stored), listed);
      expect(
        stageColumn(stage.container).at(-1),
        `the mailbox lists the turn ${listed}`,
      ).toBe(`${heard} (Stopped)`);
    }
    expect(stageAlarms(stage.container)).toStrictEqual([]);
  },
);

test("a tab that did not press keeps what it drew when the mailbox said Stopped: nothing heard afterwards and nothing the store then holds is added", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  stage.draw(threadAt("Stopped"));
  await settled();
  const stopped = [...opened, `> ${asked}`, `${heard} (Stopped)`];
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  stageHeard(stage, "turn-2", {
    live: "Text",
    message: "msg_a",
    index: 0,
    offset: heard.length,
    text: " waiting on a review.",
  });
  await settled();
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  await flushed(stage, storedAs(longer), "Stopped");
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
});

test.each(["pressed", "watched"] as const)(
  "a turn stopped before a word of it was drawn stays without one where the store comes to hold some, on the tab that %s",
  async (tab) => {
    const stage = await turnOut("Claimed");
    if (tab === "pressed") await stageStopped();
    else stage.draw(threadAt("Stopped"));
    await settled();
    const stopped = [...opened, `> ${asked}`, "(Stopped)"];
    expect(stageColumn(stage.container)).toStrictEqual(stopped);

    await flushed(stage, storedAs(heard), "Stopped");
    expect(stageColumn(stage.container)).toStrictEqual(stopped);
  },
);

test("a text stopped part way that the store then holds whole, with a call after it, is drawn once and as it stood", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });

  await flushed(
    stage,
    [
      stageAsked("u-c", asked),
      stageWrote("u-d", "msg_a", longer),
      callStored("u-e", "msg_a", "toolu_1", "sleep 60"),
      stageLine("u-f", "user", interruptionResult("toolu_1")),
      stageInterrupted("u-g", interruptionToolSentence),
    ],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    `${heard} (Stopped)`,
  ]);
});

test("a page nobody is looking at when the mailbox says Stopped holds nothing of the turn, and draws what its store comes to hold", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  try {
    stage.draw(threadAt("Stopped"));
    await settled();
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
  expect(document.visibilityState).toBe("visible");
  expect(stageColumn(stage.container).at(-1)).toBe(`${heard} (Stopped)`);

  await flushed(stage, storedAs(longer), "Stopped");
  expect(stageColumn(stage.container).at(-1)).toBe(`${longer} (Stopped)`);
});

/** A call of Bash as the store holds its beginning. */
function callStored(
  entry: string,
  message: string,
  call: string,
  command: string,
): StageEntry {
  return stageBlock(entry, message, {
    type: "tool_use",
    id: call,
    name: "Bash",
    input: { command },
  });
}

test("a call heard by name alone on a page that joined its turn part way stays bare, which cannot say which of the turn's calls it is", async () => {
  const stage = await turnOut("Claimed", [
    stageLiveOpening({
      turn: "turn-2",
      message: "msg_b",
      blocks: [
        { index: 0, kind: "ToolUse", name: "Bash", text: "", gapped: false },
      ],
    }),
  ]);
  const stopped = [...opened, `> ${asked}`, "[1 tool] (Stopped)"];
  await stageColumnIs(stage.container, stopped.with(-1, "[Bash]"));
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });

  await flushed(
    stage,
    [
      stageAsked("u-c", asked),
      callStored("u-d", "msg_a", "toolu_0", "gh issue view 39"),
      stageLine("u-e", "user", interruptionResult("toolu_0", "39 CLOSED")),
      callStored("u-f", "msg_b", "toolu_1", "sleep 60"),
      stageLine("u-g", "user", interruptionResult("toolu_1")),
      stageInterrupted("u-h", interruptionToolSentence),
    ],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(callsOpened(stage.container)).toHaveLength(1);
  const said = stage.container.textContent;
  expect(said).not.toContain("gh issue view 39");
  expect(said).not.toContain("sleep 60");
});

/** A page opened on the thread while its second turn is out, whose read of
 * the store is answered only once `read` is called. */
function turnOutReading(store: readonly (readonly StageEntry[])[]): {
  readonly stage: Stage;
  readonly read: () => void;
} {
  const doors: StageDoors = { batches: [...store], sends: [], stops: [] };
  let read = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    read = resolve;
  });
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url) =>
      url.pathname.endsWith("/transcript")
        ? gate.then(() =>
            answer(
              threadStorePage(
                doors.batches,
                Number(url.searchParams.get("after")),
              ),
            ),
          )
        : undefined,
    ),
  );
  const server = streamServer([stageProjectOpening], "token", [
    stageLiveOpening(),
  ]);
  const mounted = threadConversationMounted(
    threadAt("Claimed", doors.batches.length),
    server,
  );
  return { stage: { ...doors, server, ...mounted }, read };
}

test("a page still reading the thread when the turn stops holds nothing of it, and draws what a page opened afterwards draws", async () => {
  const first = [
    stageAsked("u-c", asked),
    stageWrote("u-d", "msg_a", "First,"),
  ];
  const rest = [
    stageWrote("u-e", "msg_b", "second, 41 waits."),
    stageInterrupted("u-f"),
  ];
  const afresh = stageMounted(threadAt("Stopped", 3), [earlier, first, rest]);
  await settled();
  const stored = stageColumn(afresh.container);
  expect(stored.at(-1)).toContain("First,");
  cleanup();

  const { stage, read } = turnOutReading([earlier, first]);
  await settled();
  stageHeardBlock(stage, "turn-2", {
    message: "msg_b",
    index: 0,
    kind: "Text",
    text: "second,",
  });
  await settled();
  stage.draw(threadAt("Stopped", 2));
  await settled();
  stage.batches.push(rest);
  read();
  await settled();
  stage.draw(threadAt("Stopped", 3));
  await stageColumnIs(stage.container, stored);
});

test("a call that stood takes what the store holds of it, its command and its output, and no word the page had not drawn", async () => {
  const stage = await turnOut("Claimed");
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "ToolUse",
    name: "Bash",
  });
  await stageColumnIs(stage.container, [...opened, `> ${asked}`, "[Bash]"]);
  stageHeardBlock(stage, "turn-2", {
    message: "msg_b",
    index: 0,
    kind: "Text",
    text: heard,
  });
  const stopped = [...opened, `> ${asked}`, `[1 tool] ${heard} (Stopped)`];
  await stageColumnIs(stage.container, stopped.with(-1, `[1 tool] ${heard}`));
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  await flushed(
    stage,
    [
      ...cutOffCall("40 OPEN review-pending"),
      stageWrote("u-f", "msg_b", longer),
      stageInterrupted("u-g"),
    ],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(callsOpened(stage.container)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /^Bash/u }));
  const said = stage.container.textContent;
  expect(said).toContain("sleep 60");
  expect(said).toContain("40 OPEN review-pending");
  expect(said).not.toContain("waiting on a review.");
});

test("a page opened after the stop draws what was stored of the turn, which the page that pressed did not", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();
  await flushed(stage, storedAs(longer), "Stopped");
  expect(stageColumn(stage.container).at(-1)).toBe(`${heard} (Stopped)`);

  cleanup();
  const afresh = stageMounted(threadAt("Stopped", 2), [
    earlier,
    storedAs(longer),
  ]);
  await settled();
  expect(stageColumn(afresh.container).at(-1)).toBe(`${longer} (Stopped)`);
});

test.each(["Queued", "Claimed"] as const)(
  "a press before anything is written of a %s turn leaves its message and Stopped, and the mailbox's read changes nothing",
  async (out) => {
    const stage = await turnOut(out);
    expect(stageColumn(stage.container)).toStrictEqual([
      ...opened,
      `> ${asked}`,
      "",
    ]);
    expect(stageAlarms(stage.container)).toStrictEqual(["engine"]);

    await stageStopped();
    const stopped = [...opened, `> ${asked}`, "(Stopped)"];
    expect(stageColumn(stage.container)).toStrictEqual(stopped);
    expect(stageAlarms(stage.container)).toStrictEqual([]);
    expect(wordInk(stage.container)).toBe("text-ink-3");
    expect(stageButton()).toBe("Send");

    await stageAnswered(stage.stops[0], { stopped: "Stopped" });
    await flushed(stage, ...stoppedWhile(out));
    expect(stageColumn(stage.container)).toStrictEqual(stopped);
    expect(stageAlarms(stage.container)).toStrictEqual([]);
    expect(stageButton()).toBe("Send");
  },
);

test.each([
  { refusal: "NotYourThread", status: 403 },
  { refusal: "NotFound", status: 404 },
])(
  "a stop the door refuses as $refusal is taken back: the turn is out again, heard afresh, and the composer says so in one line with no code",
  async ({ refusal, status }) => {
    const more = `${heard} waiting on a review.`;
    const stage = await turnOut("Claimed", [
      stageLiveOpening(),
      stageLiveOpening({
        turn: "turn-2",
        message: "msg_a",
        blocks: [{ index: 0, kind: "Text", text: more, gapped: false }],
      }),
    ]);
    await textHeard(stage);
    await stageStopped();
    expect(stage.server.liveSeen).toHaveLength(1);

    await stageAnswered(stage.stops[0], { error: { code: refusal } }, status);
    await stageColumnIs(stage.container, [...opened, `> ${asked}`, more]);
    expect(stage.server.liveSeen).toHaveLength(2);
    expect(stageButton()).toBe("Stop");
    expect(screen.getByText("Not stopped").className).toContain("notice");
    expect(stage.container.textContent).not.toContain(refusal);
    expect(stageAlarms(stage.container)).not.toContain("notice");
  },
);

test("a thread closed under the turn has nothing left to stop, which is no refusal and no error on the answer", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();

  await stageAnswered(stage.stops[0], { error: { code: "ThreadClosed" } }, 409);
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    `${heard} (Stopped)`,
  ]);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  expect(screen.queryByText(/^Not stopped/u)).toBeNull();
  expect(stage.server.liveSeen).toHaveLength(1);
});

test("a stop that raced the answer's own end is taken back at once: nothing reads Stopped, nothing is said, and the answer is as the mailbox has it", async () => {
  const whole = `${heard} waiting on a review.`;
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();
  expect(stageColumn(stage.container).at(-1)).toBe(`${heard} (Stopped)`);

  await stageAnswered(stage.stops[0], { stopped: "AlreadyEnded" });
  expect(stageColumn(stage.container).at(-1)).toBe(heard);
  expect(screen.queryByText(/^Not stopped/u)).toBeNull();
  expect(stage.server.liveSeen, "the stream is opened again").toHaveLength(2);

  await flushed(
    stage,
    [stageAsked("u-c", asked), stageWrote("u-d", "msg_a", whole)],
    { answer: whole },
  );
  await stageColumnIs(stage.container, [
    ...opened,
    `> ${asked}`,
    `${whole} (Answered)`,
  ]);
  expect(stageButton()).toBe("Send");
});

/** What a stop in the middle of a call leaves in the store: the call, the
 * runtime's refusal of it, and its note. */
function cutOffCall(result: string = interruptionRefusal): StageEntry[] {
  return [
    stageAsked("u-c", asked),
    stageBlock("u-d", "msg_a", {
      type: "tool_use",
      id: "toolu_1",
      name: "Bash",
      input: { command: "sleep 60" },
    }),
    stageLine("u-e", "user", interruptionResult("toolu_1", result)),
  ];
}

/** The calls named behind the last line of work, once it is opened, each
 * with the ink its name is drawn in. */
function callsOpened(container: HTMLElement): readonly string[] {
  const lines = container.querySelectorAll("button.conversation-work-line");
  act(() => {
    fireEvent.click(lines.item(lines.length - 1));
  });
  return Array.from(
    container.querySelectorAll(".conversation-answer code"),
    (name) => `${name.textContent} ${name.className}`,
  );
}

test("a press in the middle of a call leaves the call as a still line of the work, in no error ink, and neither of the runtime's own lines", async () => {
  const stage = await turnOut("Claimed");
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "ToolUse",
    name: "Bash",
  });
  await stageColumnIs(stage.container, [...opened, `> ${asked}`, "[Bash]"]);
  expect(stageAlarms(stage.container)).toStrictEqual(["card"]);

  await stageStopped();
  const stopped = [...opened, `> ${asked}`, "[1 tool] (Stopped)"];
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(stageAlarms(stage.container)).toStrictEqual([]);

  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  await flushed(
    stage,
    [...cutOffCall(), stageInterrupted("u-f", interruptionToolSentence)],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual(stopped);
  expect(callsOpened(stage.container)).toStrictEqual(["Bash text-ink-1"]);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  const said = stage.container.textContent;
  expect(said).not.toContain(interruptionRefusal);
  expect(said).not.toContain(interruptionToolSentence);
});

test.each([
  { failed: "a call that failed", result: "Exit code 1" },
  {
    failed: "a call the permission rules refused",
    result:
      "Permission to use Bash has been denied because of a deny rule in the settings.",
  },
])("$failed is still drawn in error ink", async ({ result }) => {
  const done = "It did not run.";
  const stage = stageMounted(threadAt({ answer: done }, 1), [
    [...earlier, ...cutOffCall(result), stageWrote("u-f", "msg_b", done)],
  ]);
  await stageColumnIs(stage.container, [
    ...opened,
    `> ${asked}`,
    `[1 tool] ${done} (Answered)`,
  ]);
  expect(callsOpened(stage.container)).toStrictEqual(["Bash text-tone-fail"]);
  fireEvent.click(screen.getByRole("button", { name: /^Bash/u }));
  expect(stage.container.querySelector("pre.text-tone-fail")?.textContent).toBe(
    result,
  );
});

test("a tab that did not press is shown the end the stream says, and Stopped once the mailbox does", async () => {
  const stage = await turnOut("Claimed");
  await textHeard(stage);

  stageHeard(stage, "turn-2", { live: "End" });
  await waitFor(() => {
    expect(stageAlarms(stage.container)).toStrictEqual([]);
  });
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    heard,
  ]);

  await flushed(
    stage,
    [
      stageAsked("u-c", asked),
      stageWrote("u-d", "msg_a", heard),
      stageInterrupted("u-e"),
    ],
    "Stopped",
  );
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    `${heard} (Stopped)`,
  ]);
  expect(stageAlarms(stage.container)).toStrictEqual([]);
  expect(stageButton()).toBe("Send");
  expect(stage.stops).toStrictEqual([]);
});

test.each(["Queued", "Claimed"] as const)(
  "a tab that did not press and heard no end is shown Stopped by the mailbox alone, for a turn stopped while %s",
  async (out) => {
    const stage = await turnOut(out);
    expect(stageAlarms(stage.container)).toStrictEqual(["engine"]);

    await flushed(stage, ...stoppedWhile(out));
    expect(stageColumn(stage.container)).toStrictEqual([
      ...opened,
      `> ${asked}`,
      "(Stopped)",
    ]);
    expect(stageAlarms(stage.container)).toStrictEqual([]);
    expect(wordInk(stage.container)).toBe("text-ink-3");
    expect(stageButton()).toBe("Send");
  },
);

test("the same words sent again and stopped while they waited take no answer: each stays under its own message, on the page that watched and on one opened afterwards", async () => {
  const words = "continue";
  const store = [
    stageAsked("u-1", words),
    stageWrote("a-1", "msg_1", "Half of the first ans"),
    stageInterrupted("i-1"),
    stageAsked("u-2", words),
    stageWrote("a-2", "msg_2", "The whole second answer."),
  ];
  const thread = (...more: readonly ReturnType<typeof stageTurn>[]) =>
    threadBody({
      turns: [
        stageTurn(1, "turn-1", words, "Stopped"),
        stageTurn(2, "turn-2", words, { answer: "The whole second answer." }),
        ...more,
      ],
    });
  const read = [
    `> ${words}`,
    "Half of the first ans (Stopped)",
    `> ${words}`,
    "The whole second answer. (Answered)",
  ];
  const stage = stageMounted(thread(), [store]);
  await settled();
  expect(stageColumn(stage.container)).toStrictEqual(read);

  await stageSent(words);
  const sent = stage.sends[0];
  if (sent === undefined) throw new Error("nothing was sent");
  await stageAnswered(sent, { turn: sent.turn, ordinal: 3 }, 202);
  stage.draw(thread(stageTurn(3, sent.turn, words, "Queued")));
  await settled();
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  const ended = thread(stageTurn(3, sent.turn, words, "Waited"));
  stage.draw(ended);
  await settled();
  const stopped = [...read, `> ${words}`, "(Stopped)"];
  expect(stageColumn(stage.container)).toStrictEqual(stopped);

  cleanup();
  const afresh = stageMounted(ended, [store]);
  await settled();
  expect(stageColumn(afresh.container)).toStrictEqual(stopped);
});
