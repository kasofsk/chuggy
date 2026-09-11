/** The rail's own derivation, with no renderer. */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../src/contract/responses.ts";
import {
  railRoutes,
  railThreadsShown,
  shellRail,
} from "../app/core/shellRail.ts";
import type { ShellRailInput } from "../app/core/shellRail.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const nowMs = Date.parse("2026-09-07T12:00:00Z");

function thread(entry: Partial<ThreadEntryResponse>): ThreadEntryResponse {
  return {
    session: "s-one",
    owner: "owner-one",
    state: "Open",
    mine: true,
    turns: 1,
    openedAt: "2026-09-07T09:00:00Z",
    lastActivityAt: "2026-09-07T10:00:00Z",
    hidden: false,
    ...entry,
  };
}

function rail(input: Partial<ShellRailInput>) {
  return shellRail({ partition: atlas, threads: undefined, nowMs, ...input });
}

test("a listing that has not answered draws the lead and offers no new thread", () => {
  const result = rail({ threads: undefined });
  expect(result.conversations.lead.label).toBe("Lead");
  expect(result.conversations.newThread).toBeUndefined();
  expect(result.conversations.groups).toEqual([]);
});

test("the fixed entries are the project's, in order, and carry the inbox count", () => {
  const result = rail({ threads: [], inboxCount: "3" });
  expect(result.fixed.map((entry) => entry.label)).toEqual([
    "Ticket overview",
    "Inbox",
    "Selector",
    "Repositories",
    "New ticket",
  ]);
  expect(result.fixed[1]?.count).toBe("3");
});

test("all threads links to the full listing", () => {
  const result = rail({ threads: [] });
  expect(result.allThreads.to).toBe(railRoutes.threads);
  expect(result.allThreads.params).toEqual({
    tenant: "acme",
    project: "atlas",
  });
});

test("with no thread of the reader's own, New thread opens rather than closes one", () => {
  const result = rail({ threads: [] });
  expect(result.conversations.newThread).toEqual({
    id: "thread-new",
    label: "New thread",
    action: "NewThread",
  });
});

test("with an open thread of the reader's own, New thread closes it first", () => {
  const result = rail({
    threads: [thread({ session: "s-mine", mine: true, state: "Open" })],
  });
  expect(result.conversations.newThread?.closes).toBe("s-mine");
  expect(result.conversations.newThread?.disabled).toBeUndefined();
});

test("while the open thread is answering, New thread is disabled and says so", () => {
  const result = rail({
    threads: [thread({ session: "s-mine", mine: true, state: "Open" })],
    answering: true,
  });
  expect(result.conversations.newThread).toEqual({
    id: "thread-new",
    label: "Answering",
    action: "NewThread",
    disabled: true,
  });
});

test("only the reader's own threads are grouped, and a hidden one is left out", () => {
  const result = rail({
    threads: [
      thread({ session: "s-mine", mine: true }),
      thread({ session: "s-other", mine: false }),
      thread({ session: "s-hidden", mine: true, hidden: true }),
    ],
  });
  const sessions = result.conversations.groups.flatMap((group) =>
    group.entries.map((entry) => entry.id),
  );
  expect(sessions).toEqual(["s-mine"]);
});

test("a thread with no title is labelled New thread, and a closed one is marked", () => {
  const result = rail({
    threads: [
      thread({ session: "s-untitled", mine: true, title: undefined }),
      thread({ session: "s-closed", mine: true, state: "Closed" }),
    ],
  });
  const entries = result.conversations.groups.flatMap((group) => group.entries);
  const untitled = entries.find((entry) => entry.id === "s-untitled");
  const closed = entries.find((entry) => entry.id === "s-closed");
  expect(untitled?.label).toBe("New thread");
  expect(untitled?.standing).toBeUndefined();
  expect(closed?.closed).toBe(true);
  expect(untitled?.closed).toBe(false);
});

/** Chosen well clear of a UTC day boundary either side of `nowMs` (noon UTC)
 * so the case does not depend on the runner's own time zone to land in the
 * calendar day it names. */
test("threads group under the heading their activity falls in, newest first within it", () => {
  const result = rail({
    threads: [
      thread({
        session: "s-early-today",
        mine: true,
        lastActivityAt: "2026-09-07T08:00:00Z",
      }),
      thread({
        session: "s-late-today",
        mine: true,
        lastActivityAt: "2026-09-07T16:00:00Z",
      }),
      thread({
        session: "s-yesterday",
        mine: true,
        lastActivityAt: "2026-09-06T20:00:00Z",
      }),
    ],
  });
  expect(result.conversations.groups.map((group) => group.heading)).toEqual([
    "Today",
    "Yesterday",
  ]);
  expect(
    result.conversations.groups[0]?.entries.map((entry) => entry.id),
  ).toEqual(["s-late-today", "s-early-today"]);
});

test("the rail holds no more of the reader's threads than its own cap", () => {
  const many = Array.from({ length: railThreadsShown * 2 }, (_unused, at) =>
    thread({
      session: `s-${String(at)}`,
      mine: true,
      lastActivityAt: new Date(nowMs - at * 60_000).toISOString(),
    }),
  );
  const result = rail({ threads: many });
  const drawn = result.conversations.groups.flatMap((group) => group.entries);
  expect(drawn.length).toBe(railThreadsShown);
  expect(drawn[0]?.id).toBe("s-0");
});

test("the lead carries the standing it was handed", () => {
  const result = rail({
    threads: [],
    leadStanding: { word: "Closed", tone: "retired" },
  });
  expect(result.conversations.lead.standing).toEqual({
    word: "Closed",
    tone: "retired",
  });
});
