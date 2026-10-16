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
  landingAwaitingMerge,
  landingCandidateCommit,
  landingClosed,
  landingConflicted,
  landingHeld,
  landingLanded,
  landingLandedCommit,
  landingMergedElsewhere,
  landingMergedHead,
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
    caveat: undefined,
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

test("a landing whose merge waits on the forge says on what, what the forge said, and when it was asked", () => {
  const landing = ticketLandingOf(
    landingAwaitingMerge(2, "2026-10-07T14:57:00Z"),
  );
  expect(landing.word).toBe("Waiting");
  expect(landing.tone).toBe("parked");
  expect(ticketLandingFragment(landing, nowMs)).toEqual({
    text: "Blocked · behind · checked 3m ago",
    link: { href: landingPullRequest, host: "forge.example.test" },
    commit: undefined,
    caveat: undefined,
  });
  expect(landing.detail.proposal?.mergeState).toBe("behind");
  expect(landing.detail.checkedAt).toBe("2026-10-07T14:57:00Z");
  expect(ticketLandingCurrent([landing])).toBe(landing);
});

test("a required check that failed reads as the forge's own word, which the fragment does not say twice", () => {
  expect(
    ticketLandingFragment(
      ticketLandingOf(
        landingAwaitingMerge(2, "2026-10-07T14:59:30Z", "Blocked", "blocked"),
      ),
      nowMs,
    ).text,
  ).toBe("Blocked · checked 30s ago");
  expect(
    ticketLandingFragment(
      ticketLandingOf(
        landingAwaitingMerge(2, "2026-10-07T14:00:00Z", "HeadMoved", "clean"),
      ),
      nowMs,
    ).text,
  ).toBe("Head moved · clean · checked 1h ago");
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
  expect(fragment.commit).toEqual({
    name: undefined,
    label: { text: "e0f3a7c", title: landingLandedCommit },
  });
  expect(fragment.caveat).toBeUndefined();
  expect(ticketLandingSummary(ticketLandingOf(landingLanded(2)))).toBe(
    "Landed",
  );
});

test("a pull request a person merged at a head it was not opened at names its merge commit as the row always does, says the head was not evaluated, and names both heads in its detail", () => {
  const landing = ticketLandingOf(landingMergedElsewhere(2));
  expect(landing.word).toBe("Landed");
  const fragment = ticketLandingFragment(landing, nowMs);
  expect(fragment.commit).toEqual({
    name: "Merged",
    label: { text: "e0f3a7c", title: landingLandedCommit },
  });
  expect(fragment.caveat).toBe("Unevaluated head");
  expect(landing.detail.proposal?.heads).toEqual({
    merged: { text: "d4e5f6a", title: landingMergedHead },
    evaluated: { text: "b51d9f0", title: landingCandidateCommit },
  });
  expect(
    landing.detail.proposal?.status,
    "a landed proposal's status is no longer read, so it is not drawn",
  ).toBeUndefined();
  expect(
    landing.detail.proposal?.mergeCommit,
    "a merge somebody else made names the commit it landed at",
  ).toEqual({ text: "e0f3a7c", title: landingLandedCommit });
  expect(
    ticketLandingOf(landingLanded(2)).detail.proposal?.heads,
    "a merge at the head opened names one commit",
  ).toBeUndefined();
});

test("a pull request held on being closed is labelled closed, and an absent one is still absent", () => {
  const closed = ticketLandingOf(landingClosed(2, "2026-10-07T14:58:00Z"));
  expect(closed.word).toBe("Held");
  expect(ticketLandingFragment(closed, nowMs).text).toBe("Held 2m · Closed");
  expect(closed.detail.proposal?.status).toBe("Closed");
  const absent = landingClosed(2, "2026-10-07T14:58:00Z");
  expect(
    ticketLandingFragment(
      ticketLandingOf({
        ...absent,
        proposal:
          absent.proposal === undefined
            ? undefined
            : { ...absent.proposal, status: "Open" },
      }),
      nowMs,
    ).text,
  ).toBe("Held 2m · Proposal absent");
});

test("the forge's word on a pull request is drawn while its landing is live, and not once a landing has settled it", () => {
  const running = landingRunning(2);
  const opened = (landing: typeof running) =>
    ticketLandingOf({
      ...landing,
      proposal:
        landing.proposal === undefined
          ? undefined
          : { ...landing.proposal, status: "Open" },
    }).detail.proposal?.status;
  expect(opened(running)).toBe("Open");
  expect(opened(landingAwaitingMerge(2, "2026-10-07T14:57:00Z"))).toBe("Open");
  expect(opened({ ...running, state: "Proposed" })).toBeUndefined();
  expect(opened(landingLanded(2))).toBeUndefined();
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
