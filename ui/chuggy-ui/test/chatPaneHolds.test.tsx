/**
 * The thread the pane holds for a reader who picked none: decided by the
 * listing's first answer and held from then, so the box under it keeps what is
 * being typed while another of their threads moves or a listing read fails,
 * and moved on only once that thread closes. And the listing is read again on
 * a thread's frames, never on a lead's.
 */

import { fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ThreadEntryResponse } from "../../../src/contract/responses.ts";
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
import { stageBox, stageDoor, stagePaneMounted } from "./threadStopStage.tsx";
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

const held = "thread-held";
const moved = "thread-moved";
const typed = "where does 41 stand";

interface Pane extends StageDoors {
  readonly server: StreamServer;
  /** The listing as the next read of it answers. */
  readonly entries: ThreadEntryResponse[];
  /** Whether the next read of the listing fails. */
  readonly failing: { now: boolean };
  /** How many times the listing has been read. */
  readonly listed: () => number;
}

/** The pane of a reader with two open threads of their own, `held` having
 * moved last. */
async function paneOpened(): Promise<Pane> {
  const doors: StageDoors = { batches: [[]], sends: [], stops: [] };
  const entries = [
    threadEntry({
      session: held,
      mine: true,
      title: "held",
      lastActivityAt: "2026-09-02T11:00:00Z",
    }),
    threadEntry({ session: moved, mine: true, title: "moved" }),
  ];
  const failing = { now: false };
  let listed = 0;
  vi.stubGlobal(
    "fetch",
    stageDoor(doors, (url) => {
      if (url.pathname.endsWith("/threads")) {
        listed += 1;
        return failing.now
          ? answer({ error: { code: "InternalError" } }, 500)
          : answer({ threads: entries });
      }
      const read = entries.find((entry) =>
        url.pathname.endsWith(`/threads/${entry.session}`),
      );
      if (read === undefined) return undefined;
      const { session, state } = read;
      return answer(threadBody({ session, state, streamless: true }));
    }),
  );
  const { server } = await stagePaneMounted();
  return { ...doors, server, entries, failing, listed: () => listed };
}

let frameId = 0;

/** A `Session` frame for `session` of `kind`, and the pane left to settle. */
async function heard(
  pane: Pane,
  session: string,
  kind: string = "Thread",
): Promise<void> {
  frameId += 1;
  await turned(() => {
    pane.server.push(
      frame("Session", String(frameId), {
        version: 1,
        resource:
          kind === "Thread"
            ? threadSessionResource(session, "turn")
            : JSON.stringify({ session, kind, turn: "turn" }),
        representation: null,
      }),
    );
  });
  await settled();
}

/** The held thread drawn, and its box typed in. */
async function typedIn(): Promise<void> {
  expect(await screen.findByText("held")).toBeDefined();
  fireEvent.change(stageBox(), { target: { value: typed } });
  await waitFor(() => {
    expect(stageBox().value).toBe(typed);
  });
}

/** Enter pressed in the box, and the thread the message went to. */
async function sentTo(pane: Pane): Promise<string | undefined> {
  await turned(() => {
    fireEvent.keyDown(stageBox(), { key: "Enter" });
  });
  return pane.sends[0]?.session;
}

test("another of the reader's threads moving keeps the thread the pane holds and what is typed in it", async () => {
  const pane = await paneOpened();
  await typedIn();
  pane.entries[1] = threadEntry({
    ...pane.entries[1],
    session: moved,
    lastActivityAt: "2026-09-02T12:00:00Z",
  });
  const before = pane.listed();
  await heard(pane, moved);
  expect(pane.listed()).toBeGreaterThan(before);

  expect(screen.getByText("held")).toBeDefined();
  expect(stageBox().value).toBe(typed);
  expect(await sentTo(pane)).toBe(held);
});

test("a listing read that fails keeps the thread the pane holds and what is typed in it", async () => {
  const pane = await paneOpened();
  await typedIn();
  pane.failing.now = true;
  const before = pane.listed();
  await heard(pane, moved);
  expect(pane.listed()).toBeGreaterThan(before);

  expect(stageBox().value).toBe(typed);
  expect(await sentTo(pane)).toBe(held);
});

test("the thread the pane holds moves on to the reader's other open thread once it closes", async () => {
  const pane = await paneOpened();
  expect(await screen.findByText("held")).toBeDefined();
  pane.entries[0] = threadEntry({
    ...pane.entries[0],
    session: held,
    state: "Closed",
  });
  await heard(pane, held);

  expect(screen.getByText("moved")).toBeDefined();
  expect(screen.queryByText("held")).toBeNull();
});

test("a lead's frame does not read the listing again, and a thread's does", async () => {
  const pane = await paneOpened();
  const before = pane.listed();
  await heard(pane, "lead-atlas", "Lead");
  expect(pane.listed()).toBe(before);
  await heard(pane, moved);
  expect(pane.listed()).toBe(before + 1);
});
