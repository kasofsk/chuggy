/**
 * What one press of the composer's button does, and what the page does with
 * the press after it: a second press of Stop too close behind the first stops
 * nothing, a send the door refuses puts the member's words back, and a refusal
 * is said once, in one line, for as long as it is about something.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { conversationStopBeatMs } from "../app/browser/conversation/Conversation.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadBody } from "./threadFixture.ts";
import {
  stageAnswered,
  stageBox,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageHeardBlock,
  stageMounted,
  stageSent,
  stageStopped,
  stageTurn,
  stageFirstDrawn as opened,
  stageFirstStored as earlier,
  stageFirstTurn as before,
} from "./threadStopStage.tsx";
import type { Stage } from "./threadStopStage.tsx";

/** The clock a press is timed by, which a case moves by hand: whole
 * milliseconds, so a beat added to it is a beat exactly. */
const clock = { ms: 0 };

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  clock.ms = Math.floor(performance.now());
  vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
});

afterEach(() => {
  styleless();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const asked = "where does 41 stand";
const heard = "It is blocked by 40, and 40 is";

type Ended = Parameters<typeof stageTurn>[3];

/** The thread with its second turn as a read lists it, and a third behind it
 * where one is named. */
function threadAt(second: Ended, third?: Ended): ThreadResponse {
  return threadBody({
    turns: [
      before,
      stageTurn(2, "turn-2", asked, second),
      ...(third === undefined ? [] : [stageTurn(3, "turn-3", "and 42", third)]),
    ],
  });
}

/** An answer being written, with what `third` says of a message behind it. */
async function answering(third?: Ended): Promise<Stage> {
  const stage = stageMounted(threadAt("Claimed", third), [earlier]);
  await settled();
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "Text",
    text: heard,
  });
  await stageColumnIs(stage.container, [
    ...opened,
    `> ${asked}`,
    heard,
    ...(third === undefined ? [] : ["> and 42", ""]),
  ]);
  return stage;
}

function stopped(stage: Stage): readonly string[] {
  return stage.stops.map((stop) => stop.turn);
}

/** The button as a press finds it: saying Stop, and one a press can land on. */
function buttonTakesStop(): void {
  expect(stageButton()).toBe("Stop");
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Stop",
  });
  expect(button.disabled).toBe(false);
}

test("two presses of Stop a frame apart stop one turn, and the button is Stop throughout and one a press can land on", async () => {
  const stage = await answering("Queued");
  await stageStopped();
  buttonTakesStop();
  await stageStopped();
  buttonTakesStop();
  expect(stopped(stage)).toStrictEqual(["turn-2"]);
});

test("a press a beat after the first stops nothing more while the door has not answered the first", async () => {
  const stage = await answering("Queued");
  await stageStopped();
  clock.ms += conversationStopBeatMs;
  await stageStopped();
  expect(stopped(stage)).toStrictEqual(["turn-2"]);
  buttonTakesStop();
});

test("a press on an answered stop stops nothing more within the beat, and the turn behind after it", async () => {
  const stage = await answering("Queued");
  await stageStopped();
  await stageAnswered(stage.stops[0], { stopped: "Stopped" });
  clock.ms += conversationStopBeatMs - 1;
  await stageStopped();
  expect(stopped(stage)).toStrictEqual(["turn-2"]);

  clock.ms += 1;
  await stageStopped();
  expect(stopped(stage)).toStrictEqual(["turn-2", "turn-3"]);
});

test("a stop the door refuses is answered too: after the beat the next press is taken", async () => {
  const stage = await answering("Queued");
  await stageStopped();
  await stageAnswered(stage.stops[0], { error: { code: "NotFound" } }, 404);
  clock.ms += conversationStopBeatMs;
  await stageStopped();
  expect(stopped(stage)).toStrictEqual(["turn-2", "turn-2"]);
});

test("a press of the button that has turned to Send within the beat sends nothing and keeps the words, and Enter sends them", async () => {
  const stage = await answering();
  fireEvent.change(stageBox(), { target: { value: "and 42" } });
  await settled();
  await stageStopped();
  expect(stageButton()).toBe("Send");

  const send = (): void => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  };
  send();
  await settled();
  expect(stage.sends).toHaveLength(0);
  expect(stageBox().value).toBe("and 42");

  clock.ms += conversationStopBeatMs;
  send();
  await settled();
  expect(stage.sends.map((sent) => sent.message)).toStrictEqual(["and 42"]);
});

test("two clicks of Send a frame apart send once and stop nothing, and a click after the beat stops what was sent", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  fireEvent.change(stageBox(), { target: { value: asked } });
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await settled();
  buttonTakesStop();
  await stageStopped();
  buttonTakesStop();

  const [sent] = stage.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 2 }, 202);
  expect(stage.sends.map((post) => post.message)).toStrictEqual([asked]);
  expect(stopped(stage)).toStrictEqual([]);
  expect(stageColumn(stage.container)).toStrictEqual([
    ...opened,
    `> ${asked}`,
    "",
  ]);

  clock.ms += conversationStopBeatMs;
  await stageStopped();
  expect(stopped(stage)).toStrictEqual([sent?.turn]);
});

test("Enter sends within the beat, since a key is no second press of the button", async () => {
  const stage = await answering();
  await stageStopped();
  await stageSent("and 42");
  expect(stage.sends.map((sent) => sent.message)).toStrictEqual(["and 42"]);
});

test("a send the door refuses after more was typed puts the words back ahead of what was typed, and says so once", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  expect(stageColumn(stage.container)).toContain(`> ${asked}`);
  fireEvent.change(stageBox(), { target: { value: "something else" } });
  await settled();

  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  expect(stageBox().value).toBe(`${asked}\n\nsomething else`);
  expect(stageColumn(stage.container)).toStrictEqual(opened);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);
  expect(stage.container.textContent).not.toContain("Invalid");
});

test("a send the door refuses with nothing typed since puts the words back alone", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  expect(stageBox().value).toBe(asked);
});

test("two sends refused while both were on their way come back in the order they were sent, ahead of what was typed since", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent("one");
  await stageSent("two");
  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  expect(stageBox().value).toBe("one");
  fireEvent.change(stageBox(), { target: { value: "one\n\nand three" } });
  await settled();

  await stageAnswered(stage.sends[1], { error: { code: "Invalid" } }, 400);
  expect(stageBox().value).toBe("one\n\ntwo\n\nand three");
  expect(stageColumn(stage.container)).toStrictEqual(opened);
});

test("a message handed back that the member has written in since is words typed, and the next handed back goes ahead of it", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent("one");
  await stageSent("two");
  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  fireEvent.change(stageBox(), { target: { value: "one more" } });
  await settled();

  await stageAnswered(stage.sends[1], { error: { code: "Invalid" } }, 400);
  expect(stageBox().value).toBe("two\n\none more");
});

test("what a refusal says goes when the member edits the box", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  await stageAnswered(stage.sends[0], { error: { code: "Invalid" } }, 400);
  expect(screen.queryByText("Not sent")).not.toBeNull();
  fireEvent.change(stageBox(), { target: { value: `${asked}?` } });
  await settled();
  expect(screen.queryByText("Not sent")).toBeNull();
});

test("a refused stop is said over the box, and goes when the turn it is about ends", async () => {
  const stage = await answering();
  await stageStopped();
  await stageAnswered(stage.stops[0], { error: { code: "NotFound" } }, 404);
  const said = screen.getByText("Not stopped");
  const field = stageBox().parentElement;
  if (field === null) throw new Error("the box stands in nothing");
  expect(
    said.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the line stands before the field",
  ).not.toBe(0);

  stage.draw(threadAt({ answer: "41 is blocked." }));
  await settled();
  expect(screen.queryByText("Not stopped")).toBeNull();
});

test("a refused stop's line goes at the next press of Stop", async () => {
  const stage = await answering();
  await stageStopped();
  await stageAnswered(stage.stops[0], { error: { code: "NotFound" } }, 404);
  expect(screen.queryByText("Not stopped")).not.toBeNull();
  clock.ms += conversationStopBeatMs;
  await stageStopped();
  expect(screen.queryByText("Not stopped")).toBeNull();
  expect(stopped(stage)).toStrictEqual(["turn-2", "turn-2"]);
});
