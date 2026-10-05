/**
 * What a member's thread draws for turns nothing is drawn of yet: one engine,
 * on a line every such turn keeps from its first draw, and the same engine
 * from the press until the answer begins. And what it says of a step it found
 * under way, which is its name and no time.
 */

import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";
import { threadBody } from "./threadFixture.ts";
import {
  stageAnswered,
  stageAsked,
  stageColumnIs,
  stageHeardBlock,
  stageLiveOpening,
  stageMounted,
  stageSent,
  stageStopped,
  stageTurn,
  stageFirstStored as earlier,
  stageFirstTurn as before,
} from "./threadStopStage.tsx";
import type { Stage } from "./threadStopStage.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const asked = "where does 41 stand";

/** Each answer the page draws as the lines it is made of, top to bottom. */
function answers(stage: Stage): readonly (readonly string[])[] {
  return Array.from(
    stage.container.querySelectorAll(".conversation-answer"),
    (answer) =>
      Array.from(answer.children, (line) => line.classList.item(0) ?? ""),
  );
}

const lineKept = ["conversation-waiting-kept", "conversation-meta"];
const lineEngine = ["conversation-waiting", "conversation-meta"];

test("two messages waiting draw one engine, for the first, and the second keeps the engine's line", async () => {
  const stage = stageMounted(
    threadBody({
      turns: [
        stageTurn(1, "turn-1", "one", "Claimed"),
        stageTurn(2, "turn-2", "two", "Queued"),
      ],
    }),
    [[]],
  );
  await settled();
  expect(
    stage.container.querySelectorAll(".conversation-waiting-engine"),
  ).toHaveLength(1);
  expect(answers(stage)).toStrictEqual([lineEngine, lineKept]);
});

test("the engine reaches a waiting turn on the line the turn kept, so stopping the turn ahead changes no line of the one behind", async () => {
  const thread = threadBody({
    turns: [
      before,
      stageTurn(2, "turn-2", asked, "Claimed"),
      stageTurn(3, "turn-3", "and 42", "Queued"),
    ],
  });
  const stage = stageMounted(thread, [earlier]);
  await settled();
  const heard = "It is blocked by 40, and 40 is";
  stageHeardBlock(stage, "turn-2", {
    message: "msg_a",
    index: 0,
    kind: "Text",
    text: heard,
  });
  await stageColumnIs(stage.container, [
    "> is 40 open",
    "40 is open. (Answered)",
    `> ${asked}`,
    heard,
    "> and 42",
    "",
  ]);
  expect(answers(stage).at(-1)).toStrictEqual(lineKept);
  const word = stage.container.querySelectorAll(".conversation-meta").item(2);

  await stageStopped();
  expect(answers(stage).at(-1)).toStrictEqual(lineEngine);
  expect(
    stage.container.querySelectorAll(".conversation-meta").item(2),
    "the line under the waiting turn is the one that was there",
  ).toBe(word);
});

test("the engine is one element from the press until the answer begins, through the store coming to hold the message", async () => {
  const stage = stageMounted(threadBody({ turns: [before] }), [earlier]);
  await settled();
  await stageSent(asked);
  const engine = (): Element | null =>
    stage.container.querySelector(".conversation-waiting-engine");
  const pressed = engine();
  expect(pressed).not.toBeNull();
  const [sent] = stage.sends;
  if (sent === undefined) throw new Error("nothing was sent");
  const listed = (state: "Queued" | "Claimed", batches = 1): ThreadResponse =>
    threadBody({
      batches,
      turns: [before, stageTurn(2, sent.turn, asked, state)],
    });

  await stageAnswered(sent, { turn: sent.turn, ordinal: 2 }, 202);
  expect(engine(), "the door took it").toBe(pressed);
  for (const state of ["Queued", "Claimed"] as const) {
    stage.draw(listed(state));
    await settled();
    expect(engine(), `the mailbox lists it ${state}`).toBe(pressed);
  }
  stage.batches.push([stageAsked("u-c", asked)]);
  stage.draw(listed("Claimed", 2));
  await settled();
  expect(engine(), "the store holds the message").toBe(pressed);
});

/** The line of the work under way, a while after the page drew it. */
async function workLineLater(stage: Stage): Promise<string> {
  await act(() => vi.advanceTimersByTimeAsync(5000));
  return (
    stage.container.querySelector(".conversation-work-line")?.textContent ?? ""
  );
}

test("a step the page found under way is named and not timed, and one it heard begin is timed", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const thread = threadBody({
    turns: [before, stageTurn(2, "turn-2", asked, "Claimed")],
  });
  const call = { index: 0, kind: "ToolUse", name: "Bash" };
  const found = stageMounted(
    thread,
    [earlier],
    [
      stageLiveOpening({
        turn: "turn-2",
        message: "msg_a",
        blocks: [{ ...call, text: "", gapped: false }],
      }),
    ],
  );
  await settled();
  expect(await workLineLater(found)).toBe("Bash");
  stageHeardBlock(found, "turn-2", { ...call, message: "msg_a", index: 1 });
  await settled();
  expect(await workLineLater(found)).toBe("Bash5s");
  cleanup();

  const watched = stageMounted(thread, [earlier]);
  await settled();
  stageHeardBlock(watched, "turn-2", { ...call, message: "msg_a" });
  await settled();
  expect(await workLineLater(watched)).toBe("Bash5s");
});
