/** The rail's sections, derived with no renderer. */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { threadsAnsweredMax } from "../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../src/contract/responses.ts";
import { railRoutes, shellRailSections } from "../app/core/shellRail.ts";
import type { RailEntry } from "../app/core/shellRail.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

function thread(entry: Partial<ThreadEntryResponse>): ThreadEntryResponse {
  return {
    session: "s-one",
    owner: "owner-one",
    state: "Open",
    mine: false,
    turns: 1,
    ...entry,
  };
}

function conversations(
  input: Parameters<typeof shellRailSections>[0],
): readonly RailEntry[] {
  const section = shellRailSections(input).find(
    (held) => held.id === "conversations",
  );
  return section === undefined ? [] : section.entries;
}

test("a listing that has not answered draws the lead and nothing else", () => {
  expect(
    conversations({ partition: atlas, threads: undefined }).map(
      (entry) => entry.label,
    ),
  ).toEqual(["Lead"]);
});

test("an answered listing with no thread of the reader's offers a new one", () => {
  const entries = conversations({ partition: atlas, threads: [] });
  expect(entries.map((entry) => entry.id)).toEqual(["lead", "thread-new"]);
  expect(entries[1]?.action).toBe("OpenThread");
  expect(entries[1]?.to).toBeUndefined();
});

test("the reader's own thread is labelled, first, and withholds the offer", () => {
  const entries = conversations({
    partition: atlas,
    threads: [
      thread({ session: "s-two" }),
      thread({ session: "s-mine", mine: true }),
    ],
  });
  expect(entries.map((entry) => entry.label)).toEqual([
    "Lead",
    "Your thread",
    "owner-one",
  ]);
  expect(entries[1]?.mine).toBe(true);
});

test("a second thread of the reader's own is disambiguated by its session tail", () => {
  const entries = conversations({
    partition: atlas,
    threads: [
      thread({
        session: "thread-11112222-3333-4444-5555-666677778888",
        mine: true,
        turns: 3,
      }),
      thread({
        session: "thread-aaaabbbb-cccc-dddd-eeee-ffff00001234",
        mine: true,
        turns: 12,
      }),
    ],
  });
  expect(entries.map((entry) => entry.label)).toEqual([
    "Lead",
    "Your thread",
    "Your thread · 00001234",
  ]);
});

test("two threads whose session shares its first eight characters still read apart", () => {
  const entries = conversations({
    partition: atlas,
    threads: [
      thread({
        session: "thread-a1111111-2222-3333-4444-555566667777",
        mine: true,
        turns: 1,
      }),
      thread({
        session: "thread-a1111111-2222-3333-4444-555566668888",
        mine: true,
        turns: 1,
      }),
      thread({
        session: "thread-a1111111-2222-3333-4444-555566669999",
        mine: true,
        turns: 1,
      }),
    ],
  });
  const labels = entries.map((entry) => entry.label);
  expect(labels).toEqual([
    "Lead",
    "Your thread",
    "Your thread · 66668888",
    "Your thread · 66669999",
  ]);
  expect(new Set(labels).size).toBe(labels.length);
});

test("a thread whose owner is gone is labelled by its session", () => {
  const entries = conversations({
    partition: atlas,
    threads: [
      thread({ session: "s-orphan", owner: undefined, state: "Orphaned" }),
    ],
  });
  expect(entries[1]?.label).toBe("s-orphan");
  expect(entries[1]?.standing).toEqual({ word: "Orphaned", tone: "parked" });
});

test("a thread entry carries its session in the params its route needs", () => {
  const entries = conversations({
    partition: atlas,
    threads: [thread({ session: "s-two" })],
  });
  expect(entries[1]?.to).toBe(railRoutes.thread);
  expect(entries[1]?.params).toEqual({
    tenant: "acme",
    project: "atlas",
    session: "s-two",
  });
});

test("the lead carries the standing it was handed and the inbox its count", () => {
  const sections = shellRailSections({
    partition: atlas,
    threads: [],
    leadStanding: { word: "Closed", tone: "retired" },
    inboxCount: "3",
  });
  expect(sections[0]?.entries[0]?.standing).toEqual({
    word: "Closed",
    tone: "retired",
  });
  const project = sections.find((section) => section.id === "project");
  expect(project?.entries.map((entry) => entry.label)).toEqual([
    "Overview",
    "Inbox",
    "Selector",
    "New ticket",
  ]);
  expect(project?.entries[1]?.count).toBe("3");
});

test("the conversations heading links to the full listing", () => {
  const sections = shellRailSections({ partition: atlas, threads: undefined });
  expect(sections[0]?.to).toBe(railRoutes.threads);
  expect(sections[1]?.to).toBeUndefined();
});

test("the rail holds no more threads than the listing may answer", () => {
  const many = Array.from({ length: threadsAnsweredMax * 2 }, (_unused, at) =>
    thread({ session: `s-${String(at)}` }),
  );
  const entries = conversations({ partition: atlas, threads: many });
  expect(entries.filter((entry) => entry.mine === false).length).toBe(
    threadsAnsweredMax,
  );
});
