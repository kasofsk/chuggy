// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import {
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  ticket21Resumed,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "vteng", project: "chuggy" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "21" }),
}));
// jscpd:ignore-end

/**
 * The ticket page over the journal of ticket 21, in the two states the operator
 * read it in.
 *
 * The flat list this replaced put a stage-0 Pass from one cycle beside a
 * stage-0 Fail from another with nothing saying they judged different
 * artifacts, so what every case here asserts is the structure: which cycle a
 * row belongs to, which artifact it judged, what the machine charged for it and
 * which stages were never reached. The figures are asserted where the clock
 * cannot move them — a duration, a cost, a token count — and an instant is
 * asserted through the ISO it hovers, because the clock face is the reader's
 * own zone and a suite that pinned it would pin the machine it ran on.
 */

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

const ticketTotals = {
  turns: 212,
  durationMs: 3_960_000,
  durationApiMs: 3_490_000,
  tokensInput: 150_000,
  tokensOutput: 12_000,
  tokensCacheCreation: 16_000,
  tokensCacheRead: 20_000,
  costUsdMicros: 2_740_000,
  costBasis: "List",
  permissionDenials: 0,
  models: [
    {
      model: "claude-opus-4",
      tokensInput: 120_000,
      tokensOutput: 9_000,
      tokensCacheCreation: 12_000,
      tokensCacheRead: 15_000,
      costUsdMicros: 2_310_000,
    },
  ],
};

interface Drawn {
  readonly container: HTMLElement;
}

async function drawTicket(served: {
  readonly shapes: readonly ExecutionShape[];
  readonly ticket: Record<string, unknown>;
  readonly cursor?: string;
  readonly withDraft?: boolean;
}): Promise<Drawn> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions"))
        return answer(ledgerPage(served.shapes, served.cursor));
      if (url.includes("/configurations/"))
        return answer({
          partition: atlas,
          revision: "r1",
          canonical: "{}",
          digest: "c".repeat(64),
        });
      if (url.includes("/drafts/"))
        return served.withDraft === false
          ? answer({}, 404)
          : answer({
              partition: atlas,
              ticket: 21,
              authoringVersion: 1,
              state: "Released",
              configurationRevision: "r1",
              authoring: ticket21Authoring,
              brief: { intent: "Give the console a footer", links: [] },
            });
      return answer(served.ticket);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  return { container: view.container };
}

const parkedTicket = {
  ticket: 21,
  phase: "Escalated",
  sequence: 167,
  reason: "ReworkBudgetExhausted",
  resumeAt: "ResumeEvaluating",
  accounts: { gasLeft: 1, gasMax: 8, reworkLeft: 0 },
  runTotals: ticketTotals,
};

const resumedTicket = {
  ticket: 21,
  phase: "Evaluating",
  sequence: 169,
  accounts: { gasLeft: 0, gasMax: 8, reworkLeft: 0 },
  runTotals: ticketTotals,
};

function groups(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".ledger-group")];
}

function rowsOf(group: HTMLElement): readonly string[] {
  return [...group.querySelectorAll(".ledger-row")].map(
    (row) => row.textContent ?? "",
  );
}

test("the parked ticket names its wall, its phase and what the whole of it cost", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("heading", { name: "Ticket 21" })).toBeDefined();
  expect(screen.getAllByText("Give the console a footer").length).toBe(2);
  expect(screen.getByText("Escalated")).toBeDefined();
  expect(screen.getAllByText("Rework budget exhausted").length).toBeGreaterThan(
    0,
  );
  const head = screen
    .getByRole("heading", { name: "Ticket 21" })
    .closest(".ticket-head");
  expect(head?.textContent).toContain("167");
  expect(head?.textContent).toContain("$2.74");
  expect(head?.textContent).toContain("198k tok");
  expect(head?.textContent).toContain("7");
});

test("the wall notice says where it is, why, and which stage failed", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const notice = container.querySelector(".notice-parked");
  expect(notice?.textContent).toContain("Parked");
  expect(notice?.textContent).toContain("Rework budget exhausted");
  expect(notice?.textContent).toContain(
    "Stage 1 of 2 failed · Rework 2/2 used",
  );
});

test("the cycles are newest first, the current one open and the rest closed", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const drawn = groups(container);
  expect(drawn).toHaveLength(3);
  expect(drawn.map((group) => group.querySelector("h3")?.textContent)).toEqual([
    "Cycle 3",
    "Cycle 2",
    "Cycle 1",
  ]);
  expect(drawn.map((group) => (group as HTMLDetailsElement).open)).toEqual([
    true,
    false,
    false,
  ]);
  expect(drawn[0]?.classList.contains("ledger-group-current")).toBe(true);
  expect(drawn[1]?.classList.contains("ledger-group-superseded")).toBe(true);
});

test("the current cycle draws its work, its artifact, its stages and its rollup", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const current = groups(container)[0];
  expect(current).toBeDefined();
  if (current === undefined) throw new Error("no current cycle");
  const rows = rowsOf(current);
  expect(rows[0]).toContain("Work");
  expect(rows[0]).toContain("Passed");
  expect(rows[0]).toContain("Current artifact");
  expect(rows[0]).toContain("9m 30s");
  expect(rows[1]).toContain("Stage 1 of 2");
  expect(rows[1]).toContain("Failed");
  expect(rows[1]).toContain("Relaunched 3× by fabric");
  expect(rows[1]).toContain("$0.35");
  expect(rows[2]).toContain("Stage 2 of 2");
  expect(rows[2]).toContain("Skipped");
  expect(current.querySelector(".ledger-group-rollup")?.textContent).toContain(
    "$2.05",
  );
});

test("a superseded cycle says which cycle replaced its artifact", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const superseded = groups(container)[1];
  expect(superseded).toBeDefined();
  if (superseded === undefined) throw new Error("no superseded cycle");
  expect(rowsOf(superseded)[0]).toContain("Superseded by cycle 3");
  expect(superseded.textContent).toContain("Superseded");
});

test("the budgets draw the machine's own figures, and the rework top-up is refused", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(
    screen.getByRole("group", { name: "Rework 2/2 used · Exhausted" }),
  ).toBeDefined();
  expect(
    screen.getByRole("group", { name: "Gas 7/8 used · 1 left" }),
  ).toBeDefined();
  expect(
    screen.getByRole("group", { name: "Finalization Not budgeted" }),
  ).toBeDefined();
  const topUp = screen.getByRole("button", { name: "Add rework" });
  expect(topUp.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Not available in this release")).toBeDefined();
});

test("the gas limit on the wire replaces the console's own floor", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, accounts: undefined },
  });
  expect(
    screen.getByRole("group", { name: "Gas 3+ used · limit unknown" }),
  ).toBeDefined();
});

test("the resume states what it re-runs, what it costs and what it keeps", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(screen.getByText(/Re-runs evaluation from stage 1/u)).toBeDefined();
  expect(screen.getByText(/costs 1 gas/u)).toBeDefined();
  expect(
    screen.getByText("Keeps the current artifact · rework stays 0/2"),
  ).toBeDefined();
});

test("every section of the main body has an anchor pointing at it", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const anchors = [...container.querySelectorAll("nav.sections a")].map(
    (link) => link.getAttribute("href"),
  );
  expect(anchors).toEqual(["#cycles", "#usage", "#brief", "#provenance"]);
  for (const anchor of anchors)
    expect(container.querySelector(`section${String(anchor)}`)).not.toBeNull();
  expect(screen.getByText("3 · 7 runs")).toBeDefined();
});

test("the usage panel names the basis once and breaks the spend down twice", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const usage = container.querySelector("#usage");
  expect(usage?.textContent).toContain("list price");
  expect(usage?.textContent).toContain("$2.74");
  expect(usage?.textContent).toContain("1h 06m");
  expect(usage?.textContent).toContain("claude-opus-4");
  expect(screen.getByRole("table", { name: "Usage by stage" })).toBeDefined();
  expect(screen.getByRole("rowheader", { name: "Stage 1" })).toBeDefined();
  expect(screen.getByRole("rowheader", { name: "Work" })).toBeDefined();
});

test("every dollar the page draws carries the basis it was priced on", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const dollars = [...container.querySelectorAll(".fig")].filter((cell) =>
    (cell.textContent ?? "").includes("$"),
  );
  expect(dollars.length).toBeGreaterThan(0);
  for (const cell of dollars)
    expect(cell.querySelector(".fig-basis")?.textContent).toBe("list");
});

test("after a resume the current cycle gains a run and a running stage", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  expect(screen.getAllByText("Evaluating").length).toBe(2);
  expect(screen.queryByText("Rework budget exhausted")).toBeNull();
  const current = groups(container)[0];
  if (current === undefined) throw new Error("no current cycle");
  const eyebrows = [...current.querySelectorAll(".eyebrow")].map(
    (drawn) => drawn.textContent,
  );
  expect(eyebrows).toContain("Evaluation · run 1");
  expect(eyebrows).toContain("Evaluation · run 2 · after resume");
  const running = rowsOf(current).find((row) => row.includes("Running"));
  expect(running).toBeDefined();
  expect(running).toContain("running ");
  expect(current.querySelector(".fig-live")).not.toBeNull();
});

test("a resumed ticket says it was resumed and that a failure parks it again", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  const notice = container.querySelector(".notice-live");
  expect(notice?.textContent).toContain("Evaluating");
  expect(notice?.textContent).toContain("Resumed from stage 1 · cycle 3");
  expect(notice?.textContent).toContain("Rework 2/2 used · a failure parks it");
});

test("a short page says so, and no cycle on it claims to be whole", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked.slice(0, 4),
    ticket: parkedTicket,
    cursor: "more",
  });
  expect(screen.getByText(/Showing the first 4 executions/u)).toBeDefined();
  const partial = container.querySelectorAll(".ledger-partial");
  expect(partial.length).toBeGreaterThan(0);
  expect(partial[0]?.textContent).toContain("Cycle partly on this page");
});

test("without the draft the rows are ungrouped and say why", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    withDraft: false,
  });
  expect(screen.getByText("Ungrouped · program not loaded")).toBeDefined();
  expect(groups(container)).toHaveLength(0);
  expect(container.querySelectorAll(".ledger-row")).toHaveLength(7);
});

test("nothing the page draws is a colour of its own, in either theme", async () => {
  for (const theme of ["light", "dark"]) {
    document.documentElement.setAttribute("data-theme", theme);
    const { container } = await drawTicket({
      shapes: ticket21Parked,
      ticket: parkedTicket,
    });
    expect(container.querySelector("[style]")).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBe(theme);
    expect(container.querySelector(".pill-parked")).not.toBeNull();
    cleanup();
    vi.unstubAllGlobals();
  }
});

/** §1.1 rule 7: nothing the console composes runs past the budget. */
const copyBudgetChars = 60;

/** A value the wire minted is not copy: a digest is as long as a digest is. */
function isDrawnValue(node: Node): boolean {
  const parent = node.parentElement;
  return (
    parent !== null &&
    (parent.closest("code") !== null || parent.closest(".fig") !== null)
  );
}

test("no string the page composes but the brief runs past the copy budget", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const over: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (text.length > copyBudgetChars && !isDrawnValue(node)) over.push(text);
  }
  expect(over).toEqual([]);
});
