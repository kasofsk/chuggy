/**
 * The decision log: one group per decision, newest first, the current one open.
 *
 * What each case pins is the structure a flat list cannot draw — which tickets
 * one decision dispatched and which another refused — and the figures where the
 * clock cannot move them.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { LeadDecisions } from "../app/browser/lead/LeadDecisions.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import {
  leadDecisionDispatching,
  leadDecisionIdle,
  leadDecisionLanding,
  leadDecisionRefusedEvery,
  leadDecisionRefusing,
  leadDecisionSettledOn,
  leadDecisionUnsaid,
  leadPartition,
  leadRefusals,
  leadRouteAnswer,
} from "./leadFixture.ts";
import { pillTones } from "../app/core/tones.ts";
import { operationRefusalCodes } from "../../../src/contract/rosters.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function drawDecisions(history?: unknown): Promise<readonly string[]> {
  const asked: string[] = [];
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/selector-history")) {
        asked.push(url);
        if (history !== undefined) return answer(history);
      }
      const found = leadRouteAnswer(url, {
        batches: 2,
        turns: 1,
        refusals: leadRefusals(false),
      });
      return answer(found.body, found.status);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <LeadDecisions
        partition={leadPartition}
        nowMs={Date.parse("2026-09-01T12:00:00Z")}
      />
    </ScreenHarness>,
  );
  await settled();
  return asked;
}

function groups(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ledger-group")];
}

/** One row of a group as a reader takes it: its label, its pill's tone and
 * word, and the tickets the row names. */
interface DrawnRow {
  readonly label: string;
  readonly tone: string | undefined;
  readonly word: string;
  readonly note: string;
}

/** The rows of one group, read off the pills rather than off the text, because
 * the tone is half of what a landing says and text alone cannot see it. The
 * tone is found from the roster the pill draws from, so a hue the console gains
 * is one this reader gains too. */
function rows(group: HTMLElement | undefined): readonly DrawnRow[] {
  return [...(group?.querySelectorAll<HTMLElement>("li.ledger-row") ?? [])].map(
    (row) => {
      const pill = row.querySelector<HTMLElement>(".ledger-pill .pill");
      return {
        label: row.querySelector(".ledger-label")?.textContent ?? "",
        tone: pillTones.find((tone) =>
          pill?.classList.contains(`pill-${tone}`),
        ),
        word: pill?.textContent ?? "",
        note: row.querySelector(".ledger-note")?.textContent ?? "",
      };
    },
  );
}

test("the decisions are newest first and the newest one is the open group", async () => {
  await drawDecisions();
  const drawn = groups();
  expect(drawn.length).toBe(2);
  expect(drawn[0]?.textContent).toContain("Decision 1202");
  expect(drawn[0]?.hasAttribute("open")).toBe(true);
  expect(drawn[1]?.textContent).toContain("Decision 1201");
  expect(drawn[1]?.hasAttribute("open")).toBe(false);
});

/** The group summary is what a reader scans the log down, so it names the
 * attention the decision left and what it did about the tickets it saw. */
test("each decision says what it dispatched, refused and lifted", async () => {
  await drawDecisions();
  const newest = groups()[0];
  expect(newest?.textContent).toContain(
    "Monitoring · 0 of 1 dispatched · 1 lifted",
  );
  expect(newest?.textContent).toContain("Dispatch");
  expect(newest?.textContent).toContain("Lifted");
  expect(groups()[1]?.textContent).toContain("Attention · 1 refused");
});

test("what a decision cost is drawn where the clock cannot move it", async () => {
  await drawDecisions();
  const newest = groups()[0];
  expect(newest?.textContent).toContain("$0.18");
  expect(newest?.textContent).toContain("41k");
  expect(newest?.textContent).toContain("1m 14s");
});

test("a project that has decided nothing says so rather than drawing a table", async () => {
  await drawDecisions({ decisions: [] });
  expect(screen.getByText("No decisions")).toBeDefined();
});

/**
 * THE PANEL DEPENDS ON A ROUTE ARM, AND THAT DEPENDENCY IS PINNED HERE. The
 * read asks the log's newest end and never pages, so a route that ignored
 * `order` — or refused it — would answer the wrong slice of the log; a case
 * asserting only what is drawn would pass against both.
 */
test("the read names the newest arm and carries no cursor at all", async () => {
  const asked = await drawDecisions();
  expect(asked.length).toBeGreaterThan(0);
  for (const url of asked) {
    const query = new URL(url, "https://console").searchParams;
    expect(query.get("order")).toBe("newest");
    expect(query.get("after"), "the panel paged a bounded read").toBeNull();
    expect(Number(query.get("limit"))).toBeGreaterThan(0);
  }
});

/**
 * WHICH ROW IS CURRENT IS READ OFF THE ORDINALS AND NOT OFF THE PAGE'S
 * ARRANGEMENT: a route that ignored the newest arm would answer an ascending
 * page, and a panel trusting position would draw a months-old decision at the
 * top labelled `Current`. The same page is served both ways up here, and the
 * panel has to lead with the newest either way.
 */
test("the newest decision leads the panel whichever way the page arrived", async () => {
  await drawDecisions({
    decisions: [leadDecisionDispatching, leadDecisionRefusing],
  });
  expect(groups()[0]?.textContent).toContain("Decision 1202");
  cleanup();
  await drawDecisions({
    decisions: [leadDecisionRefusing, leadDecisionDispatching],
  });
  const drawn = groups();
  expect(
    drawn[0]?.textContent,
    "an ascending page put the oldest decision at the top of the panel",
  ).toContain("Decision 1202");
  expect(drawn[0]?.hasAttribute("open")).toBe(true);
  expect(drawn[1]?.textContent).toContain("Decision 1201");
});

/**
 * THE STATES ARE NOT COLLAPSED TO THE FIRST ONE'S. Each of a decision's
 * dispatches is delivered and settled on its own, so a panel drawing them as
 * one arm has to pick one state to draw all of them in — and the one it would
 * pick is whichever the relation keys first.
 */
test("a decision's three dispatches are three rows, each with its own landing", async () => {
  await drawDecisions({ decisions: [leadDecisionLanding] });
  expect(rows(groups()[0])).toStrictEqual([
    { label: "Dispatch", tone: "pass", word: "Queued", note: "51" },
    { label: "Dispatch", tone: "pass", word: "Dispatched", note: "52" },
    {
      label: "Dispatch",
      tone: "fail",
      word: "SelectionChanged",
      note: "53",
    },
    { label: "Refused", tone: "fail", word: "Refused", note: "42" },
  ]);
});

/** A group with a landing hue anywhere in it says something landed. A decision
 * the writer refused every dispatch of landed nothing, and the summary counts
 * the same way the pills do. */
test("a decision whose every dispatch was refused draws no landing", async () => {
  await drawDecisions({ decisions: [leadDecisionRefusedEvery] });
  const group = groups()[0];
  expect(group?.querySelectorAll(".pill-pass").length).toBe(0);
  expect(rows(group).map((row) => row.word)).toStrictEqual([
    "SelectionChanged",
    "TicketChanged",
    "Refused",
  ]);
  expect(group?.textContent).toContain("Attention · 0 of 2 dispatched");
});

/** A decision that dispatched, refused and lifted nothing still has a row, so
 * the group is not an empty box a reader has to guess the meaning of. */
test("a decision that did nothing keeps its ghost row", async () => {
  await drawDecisions({ decisions: [leadDecisionIdle] });
  const group = groups()[0];
  expect(rows(group)).toStrictEqual([
    { label: "Tickets", tone: "retired", word: "None", note: "" },
  ]);
  expect(
    group
      ?.querySelector("li.ledger-row")
      ?.classList.contains("ledger-row-ghost"),
  ).toBe(true);
  expect(group?.textContent).toContain("None");
});

/** A decision from before the delivery relation was keyed per ticket has one
 * row after the backfill, and the panel draws it as the one dispatch it is. */
test("a decision with one dispatch draws one row", async () => {
  await drawDecisions({ decisions: [leadDecisionDispatching] });
  expect(rows(groups()[0])).toStrictEqual([
    { label: "Dispatch", tone: "pass", word: "Sent", note: "41" },
    { label: "Lifted", tone: "retired", word: "Lifted", note: "40" },
  ]);
});

/**
 * A settled dispatch the record cannot say the outcome of is not a dispatch
 * that did nothing: the delivery is over and the reader is owed the fact that
 * how it ended is unreadable, rather than a pill with no word in it.
 */
test("a dispatch settled with no readable outcome says so", async () => {
  await drawDecisions({ decisions: [leadDecisionUnsaid] });
  expect(rows(groups()[0])).toStrictEqual([
    { label: "Dispatch", tone: "neutral", word: "Unknown", note: "71" },
    { label: "Dispatch", tone: "parked", word: "Approval", note: "72" },
    { label: "Refused", tone: "fail", word: "Refused", note: "42" },
  ]);
});

/**
 * A LANDING IS A CLOSED SET AND NOT "SETTLED ON NOTHING I RECOGNISE". The
 * wire's `outcome` is a free string, and the words a settled dispatch reaches
 * this reader on include an operation state (`Cancelled`, `Answered`) and the
 * word the door accepted the command as (`IdempotencyConflict`,
 * `InvalidCommand`) — so a predicate reading "not a refusal code" as a landing
 * draws each of these `Dispatched` in the landing hue and counts it in the
 * line.
 */
test.each(["Cancelled", "Answered", "IdempotencyConflict", "InvalidCommand"])(
  "a dispatch settled on %s is not a landing",
  async (outcome) => {
    await drawDecisions({ decisions: [leadDecisionSettledOn(outcome)] });
    const group = groups()[0];
    expect(rows(group)).toStrictEqual([
      { label: "Dispatch", tone: "fail", word: outcome, note: "81" },
    ]);
    expect(group?.querySelectorAll(".pill-pass").length).toBe(0);
    expect(group?.textContent).toContain("Monitoring · 0 of 1 dispatched");
  },
);

/**
 * The other words a settled dispatch reaches this reader on, driven from the
 * wire's roster rather than listed here: a landing widened by any one of them
 * goes red, and a code the contract gains arrives with its own case instead of
 * waiting for somebody to add it to a list.
 */
test.each(operationRefusalCodes)(
  "a dispatch refused with %s is not a landing",
  async (code) => {
    await drawDecisions({ decisions: [leadDecisionSettledOn(code)] });
    const group = groups()[0];
    expect(rows(group)).toStrictEqual([
      { label: "Dispatch", tone: "fail", word: code, note: "81" },
    ]);
    expect(group?.querySelectorAll(".pill-pass").length).toBe(0);
  },
);

/** The ghost row stands where a decision did none of the three, so a decision
 * that dispatched and neither refused nor lifted draws its dispatch. */
test("a decision that only dispatched draws no ghost row", async () => {
  await drawDecisions({ decisions: [leadDecisionSettledOn("Succeeded")] });
  expect(rows(groups()[0])).toStrictEqual([
    { label: "Dispatch", tone: "pass", word: "Dispatched", note: "81" },
  ]);
});

/** The other half of the same condition: a decision that refused and
 * dispatched nothing draws its refusal, and the ghost is not what stands in. */
test("a decision that only refused draws no ghost row", async () => {
  await drawDecisions({ decisions: [leadDecisionRefusing] });
  expect(rows(groups()[0])).toStrictEqual([
    { label: "Refused", tone: "fail", word: "Refused", note: "42" },
  ]);
});
