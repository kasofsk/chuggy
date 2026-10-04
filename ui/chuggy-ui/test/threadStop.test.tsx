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
import { settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadBody, threadMineSession } from "./threadFixture.ts";
import {
  stageAlarms,
  stageAnswered,
  stageAsked,
  stageBlock,
  stageBox,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageHeard,
  stageHeardBlock,
  stageInterrupted,
  stageLine,
  stageLiveOpening,
  stageMounted,
  stageSent,
  stageStopped,
  stageTurn,
  stageWrote,
} from "./threadStopStage.tsx";
import type { Stage, StageEntry } from "./threadStopStage.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const before = stageTurn(1, "turn-1", "is 40 open", { answer: "40 is open." });
const earlier: readonly StageEntry[] = [
  stageAsked("u-a", "is 40 open"),
  stageWrote("u-b", "msg_before", "40 is open."),
];
const opened = ["> is 40 open", "40 is open. (Answered)"];

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
    const left =
      out === "Queued"
        ? []
        : [stageAsked("u-c", asked), stageInterrupted("u-e")];
    await flushed(stage, left, "Stopped");
    expect(stageColumn(stage.container)).toStrictEqual(stopped);
    expect(stageAlarms(stage.container)).toStrictEqual([]);
    expect(stageButton()).toBe("Send");
  },
);

test.each([
  { refusal: "NotYourThread", status: 403 },
  { refusal: "NotFound", status: 404 },
])(
  "a stop the door refuses as $refusal is taken back: the turn is out again, heard afresh, and the composer says why",
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
    expect(screen.getByText(/^Refused · /u).className).toContain("notice");
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
  expect(screen.queryByText(/Refused/u)).toBeNull();
  expect(stage.server.liveSeen).toHaveLength(1);
});

test("a stop that raced the answer's own end leaves the answer as the mailbox has it", async () => {
  const whole = `${heard} waiting on a review.`;
  const stage = await turnOut("Claimed");
  await textHeard(stage);
  await stageStopped();

  await stageAnswered(stage.stops[0], { stopped: "AlreadyEnded" });
  expect(stageColumn(stage.container).at(-1)).toBe(`${heard} (Stopped)`);
  expect(screen.queryByText(/Refused/u)).toBeNull();

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

    const left =
      out === "Queued"
        ? []
        : [stageAsked("u-c", asked), stageInterrupted("u-e")];
    await flushed(stage, left, "Stopped");
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
