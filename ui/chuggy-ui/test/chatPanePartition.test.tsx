/**
 * The pane's first composer across a project switch: a thread one project's
 * press opened, and the text that press kept, stay in that project, so a press
 * in the next one opens a thread of its own, and a first message still waited
 * on there keeps no thread of the next one off the screen.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ChatPane } from "../app/browser/shell/ChatPane.tsx";
import { ChatPaneProvider } from "../app/browser/shell/chatPaneHeld.tsx";
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

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const other: PartitionIdentity = { tenant: "acme", project: "borealis" };

const otherHeld = "thread-borealis";

/** Each project's open answers a thread named for that project, and the
 * listing of the first holds none, and of the other `listed`. */
function doorsStubbed(
  listed: readonly string[] = [],
): StageDoors & { readonly opens: string[] } {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const opens: string[] = [];
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url, method) => {
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
  return { ...doors, opens };
}

function pane(server: StreamServer, partition: PartitionIdentity) {
  return (
    <ScreenHarness
      partition={partition}
      client={client}
      transport={server.ports.fetch}
    >
      <Routed>
        <ChatPaneProvider twoColumn>
          <ChatPane
            partition={partition}
            chat={{ placement: "Right", presentation: "Docked" }}
          />
        </ChatPaneProvider>
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
