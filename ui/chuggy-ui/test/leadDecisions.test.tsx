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
  leadDecisionRefusing,
  leadPartition,
  leadRefusals,
  leadRouteAnswer,
} from "./leadFixture.ts";
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
  expect(newest?.textContent).toContain("Monitoring · 1 dispatched · 1 lifted");
  expect(newest?.textContent).toContain("Dispatched");
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
