/**
 * The brief panel, on the one decision it makes: whether the draft carries a
 * brief at all.
 *
 * A ticket released before briefs were kept has none, and the panel that drew
 * an empty intent for it would read as a person who wrote nothing down. The
 * links are the other half — they are somebody else's URLs, so what they open
 * must not reach back into this document.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { DraftResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { TicketBrief } from "../app/browser/TicketProvenance.tsx";

/** The runner has no globals, so the tree one case rendered is torn down here
 * rather than by the library's own hook. */
afterEach(cleanup);

const authoring: DraftResponse["authoring"] = {
  dependencies: [],
  program: [],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryFree",
  finalizer: "NoFinalizer",
};

function draft(brief?: DraftResponse["brief"]): PanelState<DraftResponse> {
  return {
    state: "Ready",
    observedAtMs: 0,
    value: {
      partition: { tenant: "acme", project: "atlas" },
      ticket: 7,
      authoringVersion: 1,
      state: "Released",
      configurationRevision: "r1",
      authoring,
      ...(brief === undefined ? {} : { brief }),
    },
  };
}

test("a brief is drawn as its intent, its links and its branch", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "make the console show a ticket",
        links: ["https://example.test/one", "https://example.test/two"],
        branch: "refs/heads/rt/console-ticket-page",
      })}
    />,
  );
  expect(screen.getByText("make the console show a ticket")).toBeDefined();
  expect(screen.getByText("refs/heads/rt/console-ticket-page")).toBeDefined();
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://example.test/one",
    "https://example.test/two",
  ]);
});

test("a link this console did not write cannot reach back through what it opens", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: ["https://example.test/one"],
      })}
    />,
  );
  for (const link of screen.getAllByRole("link"))
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

test("the check lines a brief appends are drawn one per line, in order", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: [],
        checks: ["npm run lint", "npm test"],
      })}
    />,
  );
  const lines = screen.getByText("checks").nextElementSibling;
  expect(
    [...(lines?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
  ).toEqual(["npm run lint", "npm test"]);
});

test("a brief appending no check lines says so rather than drawing an empty list", () => {
  render(<TicketBrief state={draft({ intent: "an intent", links: [] })} />);
  expect(screen.getByText("checks").nextElementSibling?.textContent).toBe(
    "none",
  );
});

test("a brief with no branch says so rather than drawing an empty field", () => {
  render(<TicketBrief state={draft({ intent: "an intent", links: [] })} />);
  expect(screen.queryAllByRole("link")).toEqual([]);
  expect(screen.getByText("branch").nextElementSibling?.textContent).toBe(
    "none",
  );
});

test("a brief that names where its work lands draws that reference too", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "Push", target: "refs/heads/release/next" },
      })}
    />,
  );
  expect(screen.getByText("lands on").nextElementSibling?.textContent).toBe(
    "refs/heads/release/next",
  );
});

/** A proposal into a reference and a push onto it name the same reference, so
 * the field's name is the only thing that tells the two apart. */
test("a brief proposing its work into a reference does not say it lands there", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "PullRequest", target: "refs/heads/main" },
      })}
    />,
  );
  expect(
    screen.getByText("proposed into").nextElementSibling?.textContent,
  ).toBe("refs/heads/main");
  expect(screen.queryByText("lands on")).toBeNull();
});

/** The branch is where a brief naming no target lands, so a second field
 * saying "none" would read as a landing nobody chose. */
test("a brief naming no target draws no field for one", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
      })}
    />,
  );
  expect(screen.queryByText("lands on")).toBeNull();
});

/** The contract lets a finalization name a mode and no reference, which is the
 * work landing where it happened; the field would draw empty. */
test("a finalization naming no reference draws no field either", () => {
  render(
    <TicketBrief
      state={draft({
        intent: "an intent",
        links: [],
        branch: "refs/heads/rt/console-ticket-page",
        finalization: { mode: "Push" },
      })}
    />,
  );
  expect(screen.queryByText("lands on")).toBeNull();
});

test("a ticket with no brief says why, and draws no empty intent", () => {
  render(<TicketBrief state={draft()} />);
  expect(screen.getByText(/released before a brief was kept/u)).toBeDefined();
  expect(screen.queryByText("intent")).toBeNull();
  expect(screen.queryAllByRole("link")).toEqual([]);
});
