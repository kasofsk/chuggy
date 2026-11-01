/**
 * The pane's first composer across a project switch: a thread one project's
 * press opened, and the text that press kept, stay in that project, so a press
 * in the next one opens a thread of its own, a first message still waited
 * on there keeps no thread of the next one off the screen, and one answered
 * after the switch draws nothing of its thread in the next.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ChatPane } from "../app/browser/shell/ChatPane.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { Routed } from "./routed.tsx";
import { answer, ScreenHarness, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import { threadBody, threadEntry, threadPartition } from "./threadFixture.ts";
import {
  stageAnswered,
  stageBox,
  stageDoor,
  stageProjectOpening,
  stageSent,
} from "./threadStopStage.tsx";
import type { StageDoors } from "./threadStopStage.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const other: PartitionIdentity = { tenant: "acme", project: "borealis" };

const otherHeld = "thread-borealis";

/** Each project's open answers a thread named for that project, and the
 * listing of the first holds none, and of the other `listed`. Every path
 * anything but a send asked for is kept in `asked`. */
function doorsStubbed(listed: readonly string[] = []): StageDoors & {
  readonly opens: string[];
  readonly asked: string[];
} {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const opens: string[] = [];
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url, method) => {
      asked.push(url.pathname);
      if (url.pathname.endsWith(`/threads/${otherHeld}`))
        return answer(
          threadBody({ session: otherHeld, streamless: true, turns: [] }),
        );
      if (!url.pathname.endsWith("/threads")) return undefined;
      const borealis = url.pathname.includes("/borealis/");
      if (method !== "POST")
        return answer({
          threads: (borealis ? listed : []).map((session) =>
            threadEntry({ session, mine: true }),
          ),
        });
      opens.push(url.pathname);
      const project = borealis ? "b" : "a";
      return answer(
        threadEntry({ session: `thread-${project}`, mine: true }),
        201,
      );
    }),
  );
  return { ...doors, opens, asked };
}

function pane(server: StreamServer, partition: PartitionIdentity) {
  return (
    <ScreenHarness
      partition={partition}
      client={client}
      transport={server.ports.fetch}
    >
      <Routed>
        <ChatPane
          partition={partition}
          chat={{ placement: "Right", presentation: "Docked" }}
        />
      </Routed>
    </ScreenHarness>
  );
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

test("a press after a project switch sends nothing to the thread the last project opened", async () => {
  const doors = doorsStubbed();
  const server = streamServer([stageProjectOpening, stageProjectOpening]);
  const view = render(pane(server, threadPartition));
  await settled();

  await stageSent("for atlas");
  await stageAnswered(doors.sends[0], { error: { code: "Invalid" } }, 400);
  expect(doors.sends.map((sent) => sent.session)).toStrictEqual(["thread-a"]);
  expect(stageBox().value, "the refused text was not kept").toBe("for atlas");

  view.rerender(pane(server, other));
  await settled();
  expect(stageBox().value, "the text crossed projects").toBe("");

  await stageSent("for borealis");
  expect(doors.sends.map((sent) => sent.session)).toStrictEqual([
    "thread-a",
    "thread-b",
  ]);
  expect(doors.opens).toHaveLength(2);
  expect(doors.opens[1]).toContain("/borealis/");
  expect(screen.queryByText("for atlas")).toBeNull();
});

test("a first message refused in one project keeps no thread of the next off the screen", async () => {
  const doors = doorsStubbed([otherHeld]);
  const server = streamServer([stageProjectOpening, stageProjectOpening]);
  const view = render(pane(server, threadPartition));
  await settled();
  await stageSent("for atlas");
  await stageAnswered(doors.sends[0], { error: { code: "Invalid" } }, 400);

  view.rerender(pane(server, other));
  await settled();
  expect(
    view.container.querySelector("[role=region][data-fills-page]"),
    "the thread the next project holds was not drawn",
  ).not.toBeNull();
});

test("a first message answered after a project switch reads nothing of its thread in the next", async () => {
  const doors = doorsStubbed();
  const server = streamServer([stageProjectOpening, stageProjectOpening]);
  const view = render(pane(server, threadPartition));
  await settled();
  await stageSent("for atlas");
  expect(doors.sends.map((sent) => sent.session)).toStrictEqual(["thread-a"]);

  view.rerender(pane(server, other));
  await settled();
  const sent = doors.sends[0];
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 1 }, 202);

  expect(
    doors.asked.filter(
      (path) => path.includes("/borealis/") && path.includes("thread-a"),
    ),
  ).toStrictEqual([]);
  expect(screen.queryByText("for atlas")).toBeNull();
  expect(stageBox().value).toBe("");
});

/** Two threads of the reader's own in each project, the first having moved
 * last, each read as idle. */
function picksStubbed(): void {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const sessions = (borealis: boolean): readonly string[] =>
    borealis ? ["b-first", "b-second"] : ["a-first", "a-second"];
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url) => {
      const borealis = url.pathname.includes("/borealis/");
      if (url.pathname.endsWith("/threads"))
        return answer({
          threads: sessions(borealis).map((session, at) =>
            threadEntry({
              session,
              mine: true,
              title: session,
              ...(at === 0 ? { lastActivityAt: "2026-09-02T11:00:00Z" } : {}),
            }),
          ),
        });
      const read = sessions(borealis).find((session) =>
        url.pathname.endsWith(`/threads/${session}`),
      );
      if (read === undefined) return undefined;
      return answer(threadBody({ session: read, streamless: true }));
    }),
  );
}

/** The thread titled `title` picked out of the history. */
async function pickedOutOfHistory(title: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  const row = await screen.findByRole("menuitemradio", {
    name: new RegExp(`^${title},`, "u"),
  });
  fireEvent.click(row);
  await settled();
}

test("a pick in one project is held through a pick in another and a return to the first", async () => {
  picksStubbed();
  const server = streamServer([
    stageProjectOpening,
    stageProjectOpening,
    stageProjectOpening,
  ]);
  const view = render(pane(server, threadPartition));
  await settled();
  await pickedOutOfHistory("a-second");
  expect(screen.getByRole("heading", { name: "a-second" })).toBeDefined();

  view.rerender(pane(server, other));
  await settled();
  await pickedOutOfHistory("b-second");
  expect(screen.getByRole("heading", { name: "b-second" })).toBeDefined();

  view.rerender(pane(server, threadPartition));
  await settled();
  expect(
    screen.queryByRole("heading", { name: "a-second" }),
    "the pick in the other project took the first project's",
  ).not.toBeNull();
});
