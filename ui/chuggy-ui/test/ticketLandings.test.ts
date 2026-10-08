/**
 * What the page derives from a ticket's landings, without a browser: the
 * fragment each state carries, the link a pull request is offered under, the
 * join to the ledger's cycles, the cycle a failed landing opened, and the
 * landing the status bar names.
 */

import { expect, test } from "vitest";

import { apiTimeoutMsDefault } from "../app/core/apiRequest.ts";
import { freshnessStaleAfterMs } from "../app/core/freshness.ts";
import {
  ticketLandingCurrent,
  ticketLandingFragment,
  ticketLandingLink,
  ticketLandingOf,
  ticketLandingOpened,
  ticketLandingsHeld,
  ticketLandingsJoined,
  ticketLandingsPolledMs,
  ticketLandingsRead,
  ticketLandingSummary,
} from "../app/core/ticketLandings.ts";
import {
  landingConflicted,
  landingHeld,
  landingLanded,
  landingPullRequest,
  landingRunning,
  landingsRead,
} from "./ticketLandingsFixture.ts";

const nowMs = Date.parse("2026-10-07T15:00:00Z");

test("a landing that failed on a conflict says so and how many files it names", () => {
  const landing = ticketLandingOf(landingConflicted(2));
  expect(landing.word).toBe("Failed");
  expect(landing.tone).toBe("fail");
  expect(ticketLandingFragment(landing, nowMs)).toEqual({
    text: "Merge conflict · 1 file",
    link: undefined,
    commit: undefined,
  });
  expect(ticketLandingSummary(landing)).toBe("Landing failed");
});

test("a held landing says how long it has been held and on what", () => {
  const landing = ticketLandingOf(landingHeld(2, "2026-10-07T14:48:00Z"));
  expect(landing.word).toBe("Held");
  expect(ticketLandingFragment(landing, nowMs).text).toBe(
    "Held 12m · Target unreadable",
  );
});

test("a landed landing offers its pull request under its host and its commit short", () => {
  const fragment = ticketLandingFragment(
    ticketLandingOf(landingLanded(2)),
    nowMs,
  );
  expect(fragment.link).toEqual({
    href: landingPullRequest,
    host: "forge.example.test",
  });
  expect(fragment.commit?.text).toBe("e0f3a7c");
  expect(ticketLandingSummary(ticketLandingOf(landingLanded(2)))).toBe(
    "Landed",
  );
});

test("an address that does not parse, or is not https, is no link and no throw", () => {
  expect(ticketLandingLink("not a url")).toBeUndefined();
  expect(ticketLandingLink("http://forge.example.test/pull/1")).toBeUndefined();
  expect(ticketLandingLink("javascript:alert(1)")).toBeUndefined();
  expect(ticketLandingLink(undefined)).toBeUndefined();
  expect(
    ticketLandingOf(landingLanded(2, "http://forge.example.test/pull/1")).link,
  ).toBeUndefined();
});

test("landings join the cycles the ledger holds in the read's order, and the rest stand apart", () => {
  const landings = [
    landingConflicted(2),
    landingLanded(2),
    landingRunning(4),
  ].map(ticketLandingOf);
  const joined = ticketLandingsJoined(landings, [1, 2, 3]);
  expect(joined.byCycle.get(2)?.map((landing) => landing.state)).toEqual([
    "Failed",
    "Landed",
  ]);
  expect(joined.byCycle.has(1)).toBe(false);
  expect(joined.unheld.map((landing) => landing.cycle)).toEqual([4]);
  expect(ticketLandingsJoined(landings, []).unheld).toHaveLength(3);
});

test("the cycle after a failed landing names why it exists, and no other cycle does", () => {
  const joined = ticketLandingsJoined(
    [landingConflicted(2)].map(ticketLandingOf),
    [1, 2, 3],
  );
  expect(ticketLandingOpened(joined, 3)).toBe("After merge conflict");
  expect(ticketLandingOpened(joined, 2)).toBeUndefined();
  expect(
    ticketLandingOpened(
      ticketLandingsJoined([landingLanded(2)].map(ticketLandingOf), [2, 3]),
      3,
    ),
  ).toBeUndefined();
});

test("the status bar names the newest landing only while it is live", () => {
  const running = ticketLandingOf(landingRunning(3));
  expect(
    ticketLandingCurrent([ticketLandingOf(landingConflicted(2)), running]),
  ).toBe(running);
  expect(
    ticketLandingCurrent([running, ticketLandingOf(landingConflicted(3))]),
  ).toBeUndefined();
  expect(ticketLandingCurrent([])).toBeUndefined();
});

test("a read that never answered holds no landings, and one that did holds them all", () => {
  expect(ticketLandingsHeld({ state: "Pending" })).toEqual([]);
  expect(
    ticketLandingsHeld({ state: "Failed", reason: "the read failed" }),
  ).toEqual([]);
  const read = ticketLandingsRead({
    state: "Ready",
    value: landingsRead([landingConflicted(2)]),
    observedAtMs: nowMs,
  });
  expect(ticketLandingsHeld(read).map((landing) => landing.key)).toEqual([
    "2/1",
  ]);
});

test("a poll and the slowest answer one request can take stay inside the staleness rule", () => {
  expect(ticketLandingsPolledMs + apiTimeoutMsDefault).toBeLessThan(
    freshnessStaleAfterMs,
  );
});
