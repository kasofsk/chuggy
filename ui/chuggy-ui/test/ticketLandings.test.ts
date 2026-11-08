/**
 * What the page derives from a ticket's landings, without a browser: the
 * fragment each state carries, the link a pull request is offered under, the
 * join to the ledger's cycles, and the cycle a failed landing opened.
 */

import { expect, test } from "vitest";

import { apiTimeoutMsDefault } from "../app/core/apiRequest.ts";
import { freshnessStaleAfterMs } from "../app/core/freshness.ts";
import {
  ticketLandingFragment,
  ticketLandingFragmentSays,
  ticketLandingLink,
  ticketLandingOf,
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
  landingEscalated,
  landingHeld,
  landingLanded,
  landingLandedCommit,
  landingMergedElsewhere,
  landingMergedHead,
  landingPullRequest,
  landingRunning,
  landingsRead,
} from "./ticketLandingsFixture.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

const nowMs = Date.parse("2026-10-07T15:00:00Z");

test("a landing that failed on a conflict says so and how many files it names", () => {
  const landing = ticketLandingOf(landingConflicted(2), copyTextEn);
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
  const landing = ticketLandingOf(
    landingHeld(2, "2026-10-07T14:48:00Z"),
    copyTextEn,
  );
  expect(landing.word).toBe("Held");
  expect(ticketLandingFragment(landing, nowMs).text).toBe(
    "Held 12m · Target unreadable",
  );
});

test("an escalated landing names the hold it escalated from, with who removed its pull request from the merge queue and why where that hold says", () => {
  const since = "2026-10-07T14:48:00Z";
  const said = (read: Parameters<typeof ticketLandingOf>[0]) =>
    ticketLandingFragment(ticketLandingOf(read, copyTextEn), nowMs);
  expect(
    said(
      landingEscalated(2, since, "ProposalDequeued", {
        reason: "manual",
        actor: "gdoteof",
      }),
    ),
  ).toEqual({
    text: "Removed from merge queue: manual by gdoteof",
    link: undefined,
    commit: undefined,
    caveat: undefined,
  });
  expect(
    said(
      landingEscalated(2, since, "ProposalQueueTimedOut", {
        reason: "checks_timed_out",
      }),
    ).text,
  ).toBe("Merge queue checks timed out again: checks_timed_out");
  expect(
    said(
      landingEscalated(2, since, "ProposalMergesExhausted", {
        reason: "failed_checks",
        actor: "github-merge-queue",
      }),
    ).text,
  ).toBe("Pull request merges exhausted: failed_checks by github-merge-queue");
  expect(said(landingEscalated(2, since, "ProposalMergesExhausted")).text).toBe(
    "Pull request merges exhausted",
  );
  expect(
    said(
      landingEscalated(2, since, "ProposalQueueChecksFailed", {
        reason: "failed_checks",
        actor: "github-merge-queue",
      }),
    ).text,
  ).toBe(
    "Merge queue checks failed again: failed_checks by github-merge-queue",
  );
  const bare = ticketLandingOf(
    {
      cycle: 2,
      generation: 1,
      attempts: 1,
      state: "Unavailable",
    },
    copyTextEn,
  );
  expect(bare.word).toBe("Escalated");
  expect(bare.hold).toBeUndefined();
  expect(ticketLandingFragmentSays(ticketLandingFragment(bare, nowMs))).toBe(
    false,
  );
});

test("a landing whose merge waits on the forge says on what, what the forge said, and when it was asked", () => {
  const landing = ticketLandingOf(
    landingAwaitingMerge(2, "2026-10-07T14:57:00Z"),
    copyTextEn,
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
});

test("a required check that failed reads as the forge's own word, which the fragment does not say twice", () => {
  expect(
    ticketLandingFragment(
      ticketLandingOf(
        landingAwaitingMerge(2, "2026-10-07T14:59:30Z", "Blocked", "blocked"),
        copyTextEn,
      ),
      nowMs,
    ).text,
  ).toBe("Blocked · checked 30s ago");
  expect(
    ticketLandingFragment(
      ticketLandingOf(
        landingAwaitingMerge(2, "2026-10-07T14:00:00Z", "HeadMoved", "clean"),
        copyTextEn,
      ),
      nowMs,
    ).text,
  ).toBe("Head moved · clean · checked 1h ago");
});

test("a landed landing offers its pull request under its host and its commit short", () => {
  const fragment = ticketLandingFragment(
    ticketLandingOf(landingLanded(2), copyTextEn),
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
  expect(
    ticketLandingSummary(ticketLandingOf(landingLanded(2), copyTextEn)),
  ).toBe("Landed");
});

test("a pull request a person merged at a head it was not opened at names its merge commit as the row always does, says the head was not evaluated, and names both heads in its detail", () => {
  const landing = ticketLandingOf(landingMergedElsewhere(2), copyTextEn);
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
    ticketLandingOf(landingLanded(2), copyTextEn).detail.proposal?.heads,
    "a merge at the head opened names one commit",
  ).toBeUndefined();
});

test("a pull request held on being closed is labelled closed, and an absent one is still absent", () => {
  const closed = ticketLandingOf(
    landingClosed(2, "2026-10-07T14:58:00Z"),
    copyTextEn,
  );
  expect(closed.word).toBe("Held");
  expect(ticketLandingFragment(closed, nowMs).text).toBe("Held 2m · Closed");
  expect(closed.detail.proposal?.status).toBe("Closed");
  const absent = landingClosed(2, "2026-10-07T14:58:00Z");
  expect(
    ticketLandingFragment(
      ticketLandingOf(
        {
          ...absent,
          proposal:
            absent.proposal === undefined
              ? undefined
              : { ...absent.proposal, status: "Open" },
        },
        copyTextEn,
      ),
      nowMs,
    ).text,
  ).toBe("Held 2m · Pull request absent");
});

test("the forge's word on a pull request is drawn while its landing is live, and not once a landing has settled it", () => {
  const running = landingRunning(2);
  const opened = (landing: typeof running) =>
    ticketLandingOf(
      {
        ...landing,
        proposal:
          landing.proposal === undefined
            ? undefined
            : { ...landing.proposal, status: "Open" },
      },
      copyTextEn,
    ).detail.proposal?.status;
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
    ticketLandingOf(
      landingLanded(2, "http://forge.example.test/pull/1"),
      copyTextEn,
    ).link,
  ).toBeUndefined();
});

test("landings join the cycles the ledger holds in the read's order, and the rest stand apart", () => {
  const landings = [
    landingConflicted(2),
    landingLanded(2),
    landingRunning(4),
  ].map((read) => ticketLandingOf(read, copyTextEn));
  const joined = ticketLandingsJoined(landings, [1, 2, 3]);
  expect(joined.byCycle.get(2)?.map((landing) => landing.state)).toEqual([
    "Failed",
    "Landed",
  ]);
  expect(joined.byCycle.has(1)).toBe(false);
  expect(joined.unheld.map((landing) => landing.cycle)).toEqual([4]);
  expect(ticketLandingsJoined(landings, []).unheld).toHaveLength(3);
});

test("a read that never answered holds no landings, and one that did holds them all", () => {
  expect(ticketLandingsHeld({ state: "Pending" })).toEqual([]);
  expect(
    ticketLandingsHeld({
      state: "Failed",
      failure: { outcome: "Unreachable", reason: "the read failed" },
    }),
  ).toEqual([]);
  const read = ticketLandingsRead(
    {
      state: "Ready",
      value: landingsRead([landingConflicted(2)]),
      observedAtMs: nowMs,
    },
    copyTextEn,
  );
  expect(ticketLandingsHeld(read).map((landing) => landing.key)).toEqual([
    "2/1",
  ]);
});

test("a poll and the slowest answer one request can take stay inside the staleness rule", () => {
  expect(ticketLandingsPolledMs + apiTimeoutMsDefault).toBeLessThan(
    freshnessStaleAfterMs,
  );
});
