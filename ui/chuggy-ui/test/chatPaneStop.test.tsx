/**
 * The first message of a thread, stopped: the pane's composer opens the
 * thread with that press, so its Stop is there from the press and not from
 * the read of the thread it opened, and a turn stopped there is never drawn
 * as out by the thread that takes the composer's place.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { ChatPane } from "../app/browser/shell/ChatPane.tsx";
import { ChatPaneProvider } from "../app/browser/shell/chatPaneHeld.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, ScreenHarness, settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import {
  threadBody,
  threadEntry,
  threadPartition,
  threadSessionResource,
} from "./threadFixture.ts";
import {
  stageAlarms,
  stageAnswered,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageDoor,
  stageLiveOpening,
  stageProjectOpening,
  stageSent,
  stageStopped,
  stageTurn,
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

const session = "thread-new";
const asked = "where does 41 stand";

interface Pane extends StageDoors {
  readonly container: HTMLElement;
  readonly server: StreamServer;
  /** What the read of the thread the press opened answers, once a case says;
   * a read asked before then waits for it. */
  readonly read: (thread: ThreadResponse) => Promise<void>;
}

/** The pane of a reader with no thread, whose first press opens one. */
async function paneOpened(): Promise<Pane> {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  let listed: ThreadResponse | undefined;
  const waiting: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url, method) => {
      if (url.pathname.endsWith(`/threads/${session}`))
        return listed === undefined
          ? new Promise<Response>((resolve) => waiting.push(resolve))
          : answer(listed);
      if (!url.pathname.endsWith("/threads")) return undefined;
      return method === "POST"
        ? answer(threadEntry({ session, mine: true }), 201)
        : answer({ threads: [] });
    }),
  );
  const server = streamServer([stageProjectOpening], "token", [
    stageLiveOpening(),
  ]);
  const view = render(
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
    server,
    container: view.container,
    read: async (thread) => {
      listed = thread;
      for (const answered of waiting.splice(0)) answered(answer(thread));
      await turned(() => {
        server.push(
          frame("Session", "1", {
            version: 1,
            resource: threadSessionResource(session, "turn"),
            representation: null,
          }),
        );
      });
      await settled();
    },
  };
}

type Ended = Parameters<typeof stageTurn>[3];

/** The thread the press opened, its one turn as a read lists it. */
function threadAt(turn: string, ended: Ended): ThreadResponse {
  return threadBody({
    session,
    streamless: true,
    turns: [stageTurn(1, turn, asked, ended)],
  });
}

const stopped = [`> ${asked}`, "(Stopped)"];

/** Whether the thread the press opened has taken the first composer's place,
 * which is the one of the two that fills its page. */
function threadDrawn(container: HTMLElement): boolean {
  return container.querySelector("[role=region][data-fills-page]") !== null;
}

test("a first message can be stopped before the door has taken it, and the stop follows it to the thread it opened", async () => {
  const pane = await paneOpened();
  expect(stageButton()).toBe("Send");

  await stageSent(asked);
  expect(stageColumn(pane.container)).toStrictEqual([`> ${asked}`, ""]);
  expect(stageButton(), "the door has not taken the message").toBe("Stop");

  await stageStopped();
  expect(stageColumn(pane.container)).toStrictEqual(stopped);
  expect(stageAlarms(pane.container)).toStrictEqual([]);
  expect(stageButton()).toBe("Send");
  expect(pane.stops, "the door knows no such turn yet").toStrictEqual([]);

  const [sent] = pane.sends;
  const turn = sent?.turn ?? "";
  await stageAnswered(sent, { turn, ordinal: 1 }, 202);
  expect(
    pane.stops.map((stop) => [stop.session, stop.turn, stop.body]),
  ).toStrictEqual([[session, turn, {}]]);
  expect(stageColumn(pane.container)).toStrictEqual(stopped);

  await pane.read(threadAt(turn, "Queued"));
  expect(
    stageColumn(pane.container),
    "the thread was drawn saying a turn drawn stopped is out",
  ).toStrictEqual(stopped);
  expect(stageAlarms(pane.container)).toStrictEqual([]);
  expect(stageButton()).toBe("Send");
  expect(threadDrawn(pane.container)).toBe(false);

  await stageAnswered(pane.stops[0], { stopped: "Stopped" });
  await pane.read(threadAt(turn, "Stopped"));
  await stageColumnIs(pane.container, stopped);
  expect(stageAlarms(pane.container)).toStrictEqual([]);
  expect(stageButton()).toBe("Send");
  expect(threadDrawn(pane.container)).toBe(true);
});

test("a first message the door has taken can be stopped before the thread it opened is read", async () => {
  const pane = await paneOpened();
  await stageSent(asked);
  const [sent] = pane.sends;
  const turn = sent?.turn ?? "";
  await stageAnswered(sent, { turn, ordinal: 1 }, 202);
  expect(stageColumn(pane.container)).toStrictEqual([`> ${asked}`, ""]);
  expect(stageButton(), "the thread has not been read").toBe("Stop");

  await stageStopped();
  expect(stageColumn(pane.container)).toStrictEqual(stopped);
  expect(pane.stops.map((stop) => [stop.session, stop.turn])).toStrictEqual([
    [session, turn],
  ]);

  await stageAnswered(pane.stops[0], { stopped: "Stopped" });
  await pane.read(threadAt(turn, "Stopped"));
  await stageColumnIs(pane.container, stopped);
  expect(stageButton()).toBe("Send");
  expect(threadDrawn(pane.container)).toBe(true);
  expect(pane.container.textContent).not.toContain("No store");
});

test("a first message nobody stopped is Stop until its thread is read, and Stop after", async () => {
  const pane = await paneOpened();
  await stageSent(asked);
  const [sent] = pane.sends;
  const turn = sent?.turn ?? "";
  await stageAnswered(sent, { turn, ordinal: 1 }, 202);
  expect(stageButton()).toBe("Stop");

  await pane.read(threadAt(turn, "Queued"));
  await stageColumnIs(pane.container, [`> ${asked}`, ""]);
  expect(stageButton()).toBe("Stop");
  expect(threadDrawn(pane.container)).toBe(true);
  expect(pane.stops).toStrictEqual([]);
});
