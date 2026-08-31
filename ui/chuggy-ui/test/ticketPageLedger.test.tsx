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
import { ticketInstants } from "./ticketInstants.ts";
import type { TicketAuthoring } from "../app/core/ticketLedger.ts";
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
  readonly authoring?: TicketAuthoring;
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
              authoring: served.authoring ?? ticket21Authoring,
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
  ...ticketInstants,
  reason: "ReworkBudgetExhausted",
  resumeAt: "ResumeReworking",
  accounts: { gasLeft: 1, gasMax: 8, reworkLeft: 0 },
  runTotals: ticketTotals,
};

const resumedTicket = {
  ticket: 21,
  phase: "Evaluating",
  sequence: 169,
  ...ticketInstants,
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
    screen.getByRole("group", { name: "Rework 2 of 2 used, exhausted" }),
  ).toBeDefined();
  expect(
    screen.getByRole("group", { name: "Gas 7 of 8 used, 1 left" }),
  ).toBeDefined();
  expect(
    screen.getByRole("group", { name: "Finalization not budgeted" }),
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
    screen.getByRole("group", { name: "Gas 3 or more used, limit unknown" }),
  ).toBeDefined();
});

test("the resume states what it re-runs, what it costs and what it keeps", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact, rework refilled/u),
  ).toBeDefined();
  expect(screen.getByText(/costs 1 gas/u)).toBeDefined();
  expect(screen.getByText("Rework returns to 0/2")).toBeDefined();
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
  const short = screen.getByText(/Showing first 4 executions/u);
  expect(short.classList.contains("notice-inline")).toBe(true);
  expect(short.classList.contains("notice-parked")).toBe(true);
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

/** Every string the page composed that a reader would have to parse whole. */
function drawnStringsOver(container: HTMLElement): readonly string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const over: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (text.length > copyBudgetChars && !isDrawnValue(node)) over.push(text);
  }
  return over;
}

test("no string the page composes but the brief runs past the copy budget", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(drawnStringsOver(container)).toEqual([]);
});

/** A wall the model stamps no resume point on, whose only modelled exit is revoke. */
const revokedTicket = {
  ticket: 21,
  phase: "Escalated",
  sequence: 171,
  ...ticketInstants,
  reason: "DependencyRevoked",
  accounts: { gasLeft: 4, gasMax: 8, reworkLeft: 0 },
  runTotals: ticketTotals,
};

test("a wall whose only exit is revoke offers no resume to press", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: revokedTicket });
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(
    screen.getByText("Nothing to resume · only Revoke exits this wall"),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined();
});

/**
 * The rework wall's resume buys a work cycle with the account refilled, so the
 * page must not still offer it as a re-run of the evaluation.
 */
test("a rework-wall resume says it reworks rather than re-evaluates", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact, rework refilled/u),
  ).toBeDefined();
  expect(screen.getByText("Rework returns to 0/2")).toBeDefined();
  expect(screen.queryByText(/Re-runs evaluation from stage 1/u)).toBeNull();
});

/**
 * A ticket that authored no rework budget declined the rework economy, so its
 * rework wall is revoke-only. The wire carries no resume point on this read, so
 * the page must reach that answer from the authoring it holds.
 */
test("a rework wall on a ticket that bought no budget offers no resume", async () => {
  const { resumeAt, ...withoutPoint } = parkedTicket;
  expect(resumeAt).toBe("ResumeReworking");
  await drawTicket({
    shapes: ticket21Parked,
    ticket: withoutPoint,
    authoring: {
      ...ticket21Authoring,
      reworkPolicy: { type: "BudgetedRework", value: 0 },
    },
  });
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(
    screen.getByText("Nothing to resume · only Revoke exits this wall"),
  ).toBeDefined();
});

/**
 * `retryableIn` wants gas enough to pay the point's charge as well as a stamped
 * point. The gas wall escalates with `gasLeft` at zero by construction, so the
 * page must not draw a control that submits into it.
 */
test("a gas wall offers no resume, and says it is the gas that is gone", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      reason: "GasExhausted",
      resumeAt: "ResumeEvaluating",
      accounts: { gasLeft: 0, gasMax: 8, reworkLeft: 1 },
    },
  });
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(
    screen.getByText("No gas left · only Revoke exits this wall"),
  ).toBeDefined();
  expect(screen.queryByText(/costs 1 gas/u)).toBeNull();
});

/**
 * The rework wall's own decider: a ticket out of gas there is parked for good
 * under both pricings, and revoke is its only exit.
 */
test("a rework wall with no gas is parked for good, whatever the pricing", async () => {
  for (const resumePricing of ["RetryCharged", "RetryFree"] as const) {
    await drawTicket({
      shapes: ticket21Parked,
      ticket: {
        ...parkedTicket,
        accounts: { gasLeft: 0, gasMax: 8, reworkLeft: 0 },
      },
      authoring: { ...ticket21Authoring, resumePricing },
    });
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(
      screen.getByText("No gas left · only Revoke exits this wall"),
    ).toBeDefined();
    cleanup();
    vi.unstubAllGlobals();
  }
});

test("a wall the ticket can still pay for keeps its resume", async () => {
  for (const gasLeft of [1, 2]) {
    await drawTicket({
      shapes: ticket21Parked,
      ticket: {
        ...parkedTicket,
        accounts: { gasLeft, gasMax: 8, reworkLeft: 0 },
      },
    });
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.queryByText(/No gas left/u)).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
  }
});

test("a ticket read carrying no accounts keeps its resume, absence being no claim", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, accounts: undefined },
  });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(screen.queryByText(/No gas left/u)).toBeNull();
});

/**
 * The three reads land independently, so the ticket's own answer must not wait
 * on the draft: a stamped point is the machine's, and "nothing to resume" is a
 * claim only a page that has read enough may make.
 */
test("a work resume out of gas is refused before the draft arrives", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      accounts: { gasLeft: 0, gasMax: 8, reworkLeft: 0 },
    },
    withDraft: false,
  });
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  expect(
    screen.getByText("No gas left · only Revoke exits this wall"),
  ).toBeDefined();
});

test("a resume the wire stamped is offered before the draft arrives", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    withDraft: false,
  });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact, rework refilled/u),
  ).toBeDefined();
  expect(screen.getByText(/costs 1 gas/u)).toBeDefined();
  expect(screen.queryByText(/only Revoke exits this wall/u)).toBeNull();
  expect(screen.queryByText(/Rework returns to/u)).toBeNull();
});

test("a page that has read nothing of the wall refuses the resume rather than denying it", async () => {
  const { resumeAt, reason, ...unstamped } = parkedTicket;
  expect(resumeAt).toBe("ResumeReworking");
  expect(reason).toBe("ReworkBudgetExhausted");
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...unstamped, phase: "Escalated" },
    withDraft: false,
  });
  const resume = screen.getByRole("button", { name: "Resume" });
  expect(resume.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Not read yet")).toBeDefined();
  expect(screen.queryByText(/only Revoke exits this wall/u)).toBeNull();
});

/**
 * Truncation is the executions read's own fact and does not wait on the draft,
 * which is what the head's own header claims of it.
 */
test("a short page marks the head's own counts, draft or no draft", async () => {
  for (const withDraft of [true, false]) {
    const { container } = await drawTicket({
      shapes: ticket21Parked.slice(0, 4),
      ticket: parkedTicket,
      cursor: "more",
      withDraft,
    });
    const head = container.querySelector(".ticket-figures");
    expect(head?.textContent).toContain("on this page");
    cleanup();
    vi.unstubAllGlobals();
  }
});

/**
 * The wall is dated by when the ticket entered it, which is the journal's own
 * instant and not the failing row's end — those differ whenever anything ran
 * after the wall, and the fixture makes them differ.
 */
test("the wall says when the ticket entered it, from the journal's own instant", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const when = container.querySelector(".notice-parked .notice-when .fig");
  expect(when?.getAttribute("title")).toBe(
    new Date(ticketInstants.changedAt).toISOString(),
  );
  expect(when?.textContent).not.toBe("");
});

test("a live phase is dated the same way", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  expect(
    container
      .querySelector(".notice-live .notice-when .fig")
      ?.getAttribute("title"),
  ).toBe(new Date(ticketInstants.changedAt).toISOString());
});

/**
 * The ticket's span begins at the release the journal dates, not at whatever
 * ran first — the fixture releases well before its first execution, so the two
 * give different lengths.
 */
test("the head's span begins at the release and not at the first run", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const span = container.querySelector(".ticket-figures .fig[title*='→']");
  expect(span?.getAttribute("title")).toContain(
    new Date(ticketInstants.releasedAt).toISOString(),
  );
});

/**
 * §5.2's waiting reading: a row whose first attempt the wire dates says how
 * much of its window was the queue, and one it does not reads as before.
 */
test("a row separates its wait from its run where the wire dates the start", async () => {
  const started: readonly ExecutionShape[] = ticket21Parked.map((shape) =>
    shape.task === 1 ? { ...shape, startedAt: "2026-08-26T00:11:00Z" } : shape,
  );
  const { container } = await drawTicket({
    shapes: started,
    ticket: parkedTicket,
  });
  const rows = [...container.querySelectorAll(".ledger-row")].map(
    (row) => row.querySelector(".ledger-when")?.textContent ?? "",
  );
  expect(rows.some((row) => row.includes("waited 1m · ran"))).toBe(true);
  expect(rows.some((row) => row.includes("waited") === false)).toBe(true);
});

test("every action the page draws describes itself by an id that resolves", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const described = [...container.querySelectorAll("button[aria-describedby]")];
  expect(described.length).toBeGreaterThan(0);
  for (const button of described) {
    const reference = button.getAttribute("aria-describedby") ?? "";
    expect(reference).not.toContain(" ");
    expect(container.querySelector(`[id="${reference}"]`)).not.toBeNull();
  }
});

test("the rework top-up draws its effect where a reader can see it", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  const effect = screen.getByText(/Adds one rework cycle/u);
  expect(effect.classList.contains("visually-hidden")).toBe(false);
});

test("the usage panel counts the runs, and says which are still going", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(container.querySelector("#usage")?.textContent).toContain("Runs7");
  cleanup();
  vi.unstubAllGlobals();
  const resumed = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  expect(resumed.container.querySelector("#usage")?.textContent).toContain(
    "Runs8 · 1 running · 1 unmeasured",
  );
});

test("the by-stage table is work first and then the program's own order", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const table = screen.getByRole("table", { name: "Usage by stage" });
  expect(
    [...table.querySelectorAll("tbody th")].map((cell) => cell.textContent),
  ).toEqual(["Work", "Stage 1", "Stage 2"]);
  expect(container.querySelector("#usage")).not.toBeNull();
});

/** Three tasks authored, two on the page, one of them relaunched, all superseded. */
const fanoutAuthoring = {
  ...ticket21Authoring,
  workFanout: 3,
};

const fanoutShapes: readonly ExecutionShape[] = [
  {
    execution: "execution-aaaa-1",
    task: 1,
    taskKind: "Work",
    request: "spawn-one",
    outcome: "Passed",
    retriesSpent: 1,
    totals: { turns: 10, durationMs: 120_000, costUsdMicros: 400_000 },
  },
  {
    execution: "execution-aaaa-2",
    task: 2,
    taskKind: "Work",
    request: "spawn-one",
    outcome: "Passed",
    retriesSpent: 2,
    totals: { turns: 20, durationMs: 300_000, costUsdMicros: 600_000 },
  },
  {
    execution: "execution-bbbb-3",
    task: 3,
    taskKind: "Evaluation",
    stage: 0,
    request: "spawn-two",
    outcome: "Failed",
    totals: { turns: 5, durationMs: 60_000, costUsdMicros: 100_000 },
  },
  {
    execution: "execution-cccc-4",
    task: 4,
    taskKind: "Work",
    request: "spawn-three",
    outcome: "Passed",
    totals: { turns: 8, durationMs: 90_000, costUsdMicros: 200_000 },
  },
];

async function drawFanout(): Promise<Drawn> {
  return drawTicket({
    shapes: fanoutShapes,
    ticket: parkedTicket,
    authoring: fanoutAuthoring,
  });
}

/**
 * A queue time over part of a fan-out would be a figure about no whole thing,
 * so a set the wire dates only some of reads as one it dates none of.
 */
test("a fan-out set the wire half-dates draws no wait at all", async () => {
  const half = fanoutShapes.map((shape) =>
    shape.task === 1 ? { ...shape, startedAt: "2026-08-26T00:11:00Z" } : shape,
  );
  const { container } = await drawTicket({
    shapes: half,
    ticket: parkedTicket,
    authoring: fanoutAuthoring,
  });
  const work = groups(container).at(-1)?.querySelector(".ledger-row");
  const when = work?.querySelector(".ledger-when")?.textContent ?? "";
  expect(when).toContain("15m");
  expect(when).not.toContain("waited");
});

test("a fan-out row is priced and timed over the whole set, not its first task", async () => {
  const { container } = await drawFanout();
  const work = groups(container).at(-1)?.querySelector(".ledger-row");
  expect(work).toBeDefined();
  expect(work?.querySelector(".ledger-spent")?.textContent).toContain("$1.00");
  const when = work?.querySelector(".ledger-when")?.textContent ?? "";
  expect(when).toContain("15m");
  expect(when).not.toContain("2m");
  expect(work?.textContent).toContain("Relaunched 3× by fabric");
  expect(work?.textContent).toContain("2 of 3 tasks on this page");
});

/**
 * The state no other fixture reaches: one row that is superseded, relaunched
 * and short of its fan-out at once, which is where three joined fragments would
 * run past the copy budget.
 */
test("a row that is superseded, relaunched and short still fits the copy budget", async () => {
  const { container } = await drawFanout();
  const superseded = groups(container).at(-1);
  expect(superseded?.classList.contains("ledger-group-superseded")).toBe(true);
  const over = drawnStringsOver(container);
  expect(over).toEqual([]);
});
