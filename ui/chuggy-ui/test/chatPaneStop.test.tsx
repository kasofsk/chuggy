/**
 * The first message of a thread, stopped: the pane's composer opens the
 * thread with that press, so its Stop is there from the press and not from
 * the read of the thread it opened, and a turn stopped there is never drawn
 * as out by the thread that takes the composer's place. Until that read, a
 * press in the composer after its message was taken reaches the same thread.
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
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { frame } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import {
  threadBody,
  threadEntry,
  threadSessionResource,
} from "./threadFixture.ts";
import {
  stageAlarms,
  stageAnswered,
  stageBox,
  stageButton,
  stageColumn,
  stageColumnIs,
  stageDoor,
  stagePaneMounted,
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
  /** The thread each open answered, in order. */
  readonly opens: string[];
  /** Each image upload, held until the case answers it. */
  readonly uploads: ((response: Response) => void)[];
  /** What the read of the thread a press opened answers, once a case says;
   * a read asked before then waits for it. */
  readonly read: (thread: ThreadResponse) => Promise<void>;
}

/** The pane of a reader with no thread, whose first press opens one, and
 * each open after it a thread of its own. */
async function paneOpened(): Promise<Pane> {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const opens: string[] = [];
  const uploads: ((response: Response) => void)[] = [];
  const listed = new Map<string, ThreadResponse>();
  const waiting = new Map<string, ((response: Response) => void)[]>();
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url, method) => {
      if (url.pathname.endsWith("/artifacts"))
        return new Promise<Response>((answered) => uploads.push(answered));
      const read = /\/threads\/([^/]+)$/u.exec(url.pathname)?.[1];
      if (read !== undefined) {
        const thread = listed.get(read);
        if (thread !== undefined) return answer(thread);
        return new Promise<Response>((resolve) => {
          waiting.set(read, [...(waiting.get(read) ?? []), resolve]);
        });
      }
      if (!url.pathname.endsWith("/threads")) return undefined;
      if (method !== "POST") return answer({ threads: [] });
      const opened =
        opens.length === 0 ? session : `${session}-${String(opens.length + 1)}`;
      opens.push(opened);
      return answer(threadEntry({ session: opened, mine: true }), 201);
    }),
  );
  const { server, container } = await stagePaneMounted();
  return {
    ...doors,
    server,
    container,
    opens,
    uploads,
    read: async (thread) => {
      listed.set(thread.session, thread);
      for (const answered of waiting.get(thread.session) ?? [])
        answered(answer(thread));
      waiting.delete(thread.session);
      await turned(() => {
        server.push(
          frame("Session", "1", {
            version: 1,
            resource: threadSessionResource(thread.session, "turn"),
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

/** The message `at` sent, answered as taken. */
async function taken(pane: Pane, at: number): Promise<void> {
  const sent = pane.sends[at];
  await stageAnswered(sent, { turn: sent?.turn, ordinal: at + 1 }, 202);
}

test("a press in the first box after its message was taken, before the thread it opened is read, sends to that thread", async () => {
  const pane = await paneOpened();
  await stageSent(asked);
  await taken(pane, 0);
  expect(threadDrawn(pane.container), "the thread is not read yet").toBe(false);

  await stageSent("and 42");
  await settled();
  expect(pane.opens, "the press opened a thread of its own").toStrictEqual([
    session,
  ]);
  expect(pane.sends.map((sent) => sent.session)).toStrictEqual([
    session,
    session,
  ]);
});

test("a correction pressed while the stop of a taken first message lands goes to its thread, and the first box gives way once that thread reads the stopped turn ended", async () => {
  const pane = await paneOpened();
  await stageSent(asked);
  await taken(pane, 0);
  await stageStopped();
  expect(pane.stops.map((stop) => stop.session)).toStrictEqual([session]);

  await stageSent("where does 42 stand");
  await stageAnswered(pane.stops[0], { stopped: "Stopped" });
  await taken(pane, 1);
  const [first, second] = pane.sends.map((sent) => sent.turn);
  await pane.read(
    threadBody({
      session,
      streamless: true,
      turns: [
        stageTurn(1, first ?? "", asked, "Stopped"),
        stageTurn(2, second ?? "", "where does 42 stand", "Queued"),
      ],
    }),
  );
  await waitFor(() => {
    expect(threadDrawn(pane.container), "the first box stuck").toBe(true);
  });
  expect(pane.opens).toStrictEqual([session]);
  expect(pane.sends.map((sent) => sent.session)).toStrictEqual([
    session,
    session,
  ]);
});

test("a press with an image whose upload answers after the first message was taken sends to the thread that message opened", async () => {
  const pane = await paneOpened();
  await stageSent(asked);
  fireEvent.paste(stageBox(), {
    clipboardData: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "shot", { type: "image/png" }),
      ],
      types: ["Files"],
    },
  });
  await waitFor(() => {
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
  });
  await stageSent("and this one");
  expect(pane.uploads).toHaveLength(1);

  await taken(pane, 0);
  await act(async () => {
    pane.uploads[0]?.(answer({ artifact: "artifact-1", digest: "d" }, 201));
    await Promise.resolve();
  });
  await settled();
  expect(
    pane.opens,
    "the press after its upload opened a thread of its own",
  ).toStrictEqual([session]);
  expect(pane.sends.map((sent) => [sent.session, sent.body])).toStrictEqual([
    [session, { turn: pane.sends[0]?.turn, message: asked }],
    [
      session,
      {
        turn: pane.sends[1]?.turn,
        message: "and this one",
        images: ["artifact-1"],
      },
    ],
  ]);
});
