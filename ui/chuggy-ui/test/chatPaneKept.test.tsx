/**
 * A send the door refuses after the reader has chosen another thread: the
 * pane keeps the words for the thread they were sent in, and that thread's box
 * holds them, said as not sent, when it is next drawn.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ChatPane } from "../app/browser/shell/ChatPane.tsx";
import { ChatPaneProvider } from "../app/browser/shell/chatPaneHeld.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, ScreenHarness, settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame, streamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import {
  threadBody,
  threadEntry,
  threadPartition,
  threadSessionResource,
} from "./threadFixture.ts";
import {
  stageAnswered,
  stageBox,
  stageColumn,
  stageDoor,
  stageLiveOpening,
  stageProjectOpening,
  stageSent,
} from "./threadStopStage.tsx";
import type { StageDoors } from "./threadStopStage.tsx";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const sentIn = "thread-first";
const other = "thread-second";
const words = "where does 41 stand";
const refusal = { error: { code: "Invalid" } };

interface Pane extends StageDoors {
  /** The first thread closed, as the listing and its own read then say. */
  readonly closed: () => Promise<void>;
}

/** The pane of a reader with two threads of their own, drawing the first. */
async function paneOpened(): Promise<Pane> {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const entries = [
    threadEntry({ session: sentIn, mine: true, title: "first" }),
    threadEntry({ session: other, mine: true, title: "second" }),
  ];
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url) => {
      if (url.pathname.endsWith("/threads"))
        return answer({ threads: entries });
      const read = entries.find((entry) =>
        url.pathname.endsWith(`/threads/${entry.session}`),
      );
      if (read === undefined) return undefined;
      const { session, state } = read;
      return answer(threadBody({ session, state, streamless: true }));
    }),
  );
  const server = streamServer([stageProjectOpening], "token", [
    stageLiveOpening(),
  ]);
  render(
    <ScreenHarness
      partition={threadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <ChatPaneProvider twoColumn>
        <ChatPane
          partition={threadPartition}
          chat={{ placement: "Right", presentation: "Docked" }}
        />
      </ChatPaneProvider>
    </ScreenHarness>,
  );
  await settled();
  return {
    ...doors,
    closed: async () => {
      entries[0] = threadEntry({
        ...entries[0],
        session: sentIn,
        state: "Closed",
      });
      await turned(() => {
        server.push(
          frame("Session", "1", {
            version: 1,
            resource: threadSessionResource(sentIn, "turn"),
            representation: null,
          }),
        );
      });
      await settled();
    },
  };
}

/** The thread titled `title` chosen out of the history, and drawn. */
async function chose(title: "first" | "second"): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: new RegExp(`^${title},`, "u") }),
  );
  await settled();
}

test("a send refused while another thread is drawn is in its own thread's box, said as not sent, when the reader comes back, and the other box is untouched", async () => {
  const doors = await paneOpened();
  await stageSent(words);
  expect(doors.sends.map((sent) => sent.session)).toStrictEqual([sentIn]);

  await chose("second");
  expect(stageBox().value).toBe("");
  await stageAnswered(doors.sends[0], refusal, 400);
  expect(stageBox().value).toBe("");
  expect(screen.queryByText("Not sent")).toBeNull();

  await chose("first");
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);
  expect(stageColumn(document.body)).not.toContain(`> ${words}`);

  await chose("second");
  expect(stageBox().value).toBe("");
  expect(screen.queryByText("Not sent")).toBeNull();
  await chose("first");
  expect(stageBox().value, "put back once, and held no longer").toBe("");
});

test("a send refused once the reader has come back to its thread is in the box they are looking at", async () => {
  const doors = await paneOpened();
  await stageSent(words);
  await chose("second");
  await chose("first");
  expect(stageBox().value).toBe("");

  await stageAnswered(doors.sends[0], refusal, 400);
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);
});

test("a send refused while its own thread is drawn is in the box once, and nothing is kept for it", async () => {
  const pane = await paneOpened();
  await stageSent(words);
  await stageAnswered(pane.sends[0], refusal, 400);
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);

  await chose("second");
  await chose("first");
  expect(stageBox().value).toBe("");
});

test("a send the door took while another thread was drawn leaves nothing in its thread's box", async () => {
  const pane = await paneOpened();
  await stageSent(words);
  await chose("second");
  const [sent] = pane.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 1 }, 202);

  await chose("first");
  expect(stageBox().value).toBe("");
  expect(screen.queryByText("Not sent")).toBeNull();
});

test("what is kept for a thread is kept no longer once the thread is closed", async () => {
  const pane = await paneOpened();
  await stageSent(words);
  await chose("second");
  await stageAnswered(pane.sends[0], refusal, 400);
  await pane.closed();

  await chose("first");
  expect(screen.getByText("Closed")).toBeDefined();
  expect(screen.queryByText("Not sent")).toBeNull();
});
