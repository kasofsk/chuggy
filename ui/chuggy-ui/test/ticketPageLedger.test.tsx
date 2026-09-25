// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  DetailsPane,
  DetailsToggle,
} from "../app/browser/shell/DetailsPane.tsx";
import { ShellSlots, useShellSlotHolder } from "../app/browser/shell/slots.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import {
  evalIdentity,
  ledgerPage,
  ticket21Program,
  ticket21Parked,
  ticket21Resumed,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { instantExactText } from "../app/core/figures.ts";
import type { TicketProgram } from "../app/core/ticketLedger.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm } from "./viewport.ts";

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

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
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

/** The shell's own top-bar node, stood up here because the page portals its
 * `TicketTopBar` into whatever the shell hands it. */
function TopBarTarget(): ReactNode {
  const hold = useShellSlotHolder("topBar");
  return <div ref={hold} />;
}

/** The shell slots `TicketPage` portals into: the top bar and, behind its
 * toggle, the details pane holding `TicketPageDetails`. */
function ShellAroundPage(): ReactNode {
  return (
    <ShellSlots>
      <TopBarTarget />
      <DetailsToggle />
      <DetailsPane>
        <TicketPage />
      </DetailsPane>
    </ShellSlots>
  );
}

/** What ticket 21 was released with, which its draft holds too unless a case
 * has revised the draft past it. */
const released = {
  brief: { intent: "Give the console a footer", links: [] },
  configurationRevision: "r1",
};

/** What the page is served: the ticket's read, its runs and its draft. */
interface Served {
  readonly shapes: readonly ExecutionShape[];
  readonly ticket: Record<string, unknown>;
  readonly cursor?: string;
  readonly withDraft?: boolean;
  /** The program the ticket was released with, which its draft holds too;
   * ticket 21's where a case names none. */
  readonly program?: TicketProgram;
  /** The draft's versions where a case is about them: the current one, and
   * the one the ticket's live revision was released from. */
  readonly versions?: {
    readonly authoringVersion: number;
    readonly releasedAuthoringVersion: number;
  };
  /** What the draft holds where a case has it differ from what was released. */
  readonly draft?: {
    readonly brief?: { readonly intent: string; readonly links: [] };
    readonly configurationRevision?: string;
    readonly authoring?: {
      readonly dependencies: [];
      readonly program: TicketProgram;
    };
  };
}

/** Every route the last drawn page asked for, in order. */
let routed: string[] = [];

async function drawTicket(
  served: Served,
  options: { readonly shell?: boolean } = {},
): Promise<Drawn> {
  routed = [];
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      routed.push(url);
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
              ...released,
              authoring: {
                dependencies: [],
                program: served.program ?? ticket21Program,
              },
              ...served.draft,
              ...served.versions,
            });
      return answer({
        program: ticket21Program,
        ...served.ticket,
        ...(served.program === undefined ? {} : { program: served.program }),
      });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const view = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      {options.shell === true ? <ShellAroundPage /> : <TicketPage />}
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
  ...released,
  escalation: { kind: "EvaluationFailureEscalated", resumeAt: "ResumeRework" },
  runTotals: ticketTotals,
};

const resumedTicket = {
  ticket: 21,
  phase: "Evaluation",
  sequence: 169,
  ...ticketInstants,
  ...released,
  runTotals: ticketTotals,
};

function groups(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".ledger-group")];
}

/** Opens every cycle, since a closed one draws no rows until it is opened. */
async function cyclesOpened(container: HTMLElement): Promise<void> {
  await turned(() => {
    for (const group of groups(container)) {
      (group as HTMLDetailsElement).open = true;
      group.dispatchEvent(new Event("toggle"));
    }
  });
  await settled();
}

/** Every row an evaluated stage drew, picked out from the work row that
 * always draws first in its cycle. */
function stageRows(group: HTMLElement | undefined): readonly HTMLElement[] {
  return [
    ...(group?.querySelectorAll<HTMLElement>(".ledger-row") ?? []),
  ].filter((row) =>
    row.querySelector(".ledger-label")?.textContent?.startsWith("Stage"),
  );
}

function rowsOf(group: HTMLElement): readonly string[] {
  return [...group.querySelectorAll(".ledger-row")].map(
    (row) => row.textContent ?? "",
  );
}

/** The status bar, which is where the page says where the ticket stands. */
function statusBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>(".ticket-status");
  if (bar === null) throw new Error("no status bar drawn");
  return bar;
}

/** Opens one of the rows under the ledger, which the page draws closed. */
async function sectionOpened(label: string): Promise<void> {
  const trigger = screen.getByRole("button", {
    name: new RegExp(`^${label}`, "u"),
  });
  await turned(() => {
    trigger.click();
  });
  await settled();
}

test("the parked ticket names its wall, its phase and what the whole of it cost", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const bar = statusBar(container);
  expect(bar.getAttribute("data-tone")).toBe("parked");
  expect(bar.textContent).toContain("Escalated");
  expect(bar.textContent).toContain("$2.74");
  expect(bar.textContent).toContain("198k tok");
  expect(bar.textContent).toContain("Runs7");
  expect(screen.getAllByText("Rework budget exhausted").length).toBeGreaterThan(
    0,
  );
});

test("the page is one column: no aside, no intent line and no sequence", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(container.querySelector("aside")).toBeNull();
  expect(screen.queryByText("Give the console a footer")).toBeNull();
  expect(statusBar(container).textContent).not.toContain("167");
  expect(screen.queryByText("Sequence")).toBeNull();
});

test("the wall is a card that needs you: why, which stage failed, and the resume", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const card = screen.getByRole("status", { name: "Needs you" });
  expect(card.textContent).toContain("Rework budget exhausted");
  expect(card.textContent).toContain("Stage 1 of 2 failed");
  expect(within(card).getByRole("button", { name: "Resume" })).toBeDefined();
  expect(within(card).queryByRole("button", { name: "Revoke" })).toBeNull();
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
  await cyclesOpened(container);
  const superseded = groups(container)[1];
  expect(superseded).toBeDefined();
  if (superseded === undefined) throw new Error("no superseded cycle");
  expect(rowsOf(superseded)[0]).toContain("Superseded by cycle 3");
  expect(superseded.textContent).toContain("Superseded");
});

test("a page that does not start at cycle 1 names the cycle that superseded one", async () => {
  const workedIn = (cycle: number): ExecutionShape => ({
    execution: `execution-aa-${String(cycle)}`,
    task: cycle,
    identity: workIdentity(cycle),
    outcome: "Passed",
  });
  const { container } = await drawTicket({
    shapes: [workedIn(2), workedIn(3)],
    ticket: parkedTicket,
  });
  await cyclesOpened(container);
  const superseded = groups(container)[1];
  if (superseded === undefined) throw new Error("no superseded cycle");
  expect(superseded.querySelector("h3")?.textContent).toBe("Cycle 2");
  expect(rowsOf(superseded)[0]).toContain("Superseded by cycle 3");
});

test("the resume states what it re-runs", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact/u).closest(".act"),
  ).not.toBeNull();
});

test("every section of the page has an anchor pointing at it", async () => {
  const { container } = await drawTicket(
    { shapes: ticket21Parked, ticket: parkedTicket },
    { shell: true },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Details", pressed: false }),
  );
  const anchors = [...container.querySelectorAll("nav.sections a")].map(
    (link) => link.getAttribute("href"),
  );
  expect(anchors).toEqual(["#cycles", "#brief", "#usage", "#provenance"]);
  for (const anchor of anchors)
    expect(container.querySelector(`section${String(anchor)}`)).not.toBeNull();
  expect(screen.getByText("3 · 7 runs")).toBeDefined();
});

test("the rows under the ledger are closed, and following an anchor opens its row", async () => {
  const { container } = await drawTicket(
    { shapes: ticket21Parked, ticket: parkedTicket },
    { shell: true },
  );
  expect(screen.queryByText("Dependencies")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Details", pressed: false }),
  );
  const anchor = container.querySelector('nav.sections a[href="#provenance"]');
  if (!(anchor instanceof HTMLElement)) throw new Error("no provenance anchor");
  await turned(() => {
    anchor.click();
  });
  await settled();
  expect(screen.getByText("Dependencies")).toBeDefined();
  expect(
    screen
      .getByRole("button", { name: /^Provenance/u })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /^Brief/u })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

test("each closed row says what it holds on the right", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: /^Brief/u }).textContent).toContain(
    "Intent only",
  );
  expect(screen.getByRole("button", { name: /^Usage/u }).textContent).toContain(
    "$2.74",
  );
  expect(
    screen.getByRole("button", { name: /^Provenance/u }).textContent,
  ).toContain("Revision 1");
});

test("the Brief row counts what the brief holds beside its intent", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      brief: {
        intent: "Give the console a footer",
        links: ["https://example.test/one"],
        checks: ["npm run lint", "npm test"],
      },
    },
  });
  expect(screen.getByRole("button", { name: /^Brief/u }).textContent).toContain(
    "1 link · 2 checks",
  );
});

test("the shell's top bar draws the ticket's own number and phase", async () => {
  await drawTicket(
    { shapes: ticket21Parked, ticket: parkedTicket },
    { shell: true },
  );
  const top = screen.getByRole("heading", { name: "Ticket" }).parentElement;
  expect(top?.textContent).toContain("21");
  expect(top?.textContent).toContain("Escalated");
});

test("the shell's top bar is headed by the ticket's own title where it has one", async () => {
  await drawTicket(
    {
      shapes: ticket21Parked,
      ticket: { ...parkedTicket, title: "Serve the reason" },
    },
    { shell: true },
  );
  expect(
    screen.getByRole("heading", { name: "Serve the reason" }),
  ).toBeDefined();
});

test("the top bar's breadcrumb returns to the project's overview", async () => {
  await drawTicket(
    { shapes: ticket21Parked, ticket: parkedTicket },
    { shell: true },
  );
  const crumb = screen.getByText("Overview");
  expect(crumb.tagName).toBe("A");
});

test("the canonical JSON is closed until asked for, and its trigger controls it", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  await sectionOpened("Provenance");
  const trigger = screen.getByRole("button", { name: "Canonical JSON" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("{}")).toBeNull();
  await turned(() => {
    trigger.click();
  });
  const body = screen.getByText("{}");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(trigger.getAttribute("aria-controls")).toBe(body.id);
  await turned(() => {
    trigger.click();
  });
  expect(screen.queryByText("{}")).toBeNull();
});

test("the usage row names the basis and breaks the spend down twice", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  await sectionOpened("Usage");
  const usage = container.querySelector("#usage");
  expect(usage?.querySelector(".fig-basis")?.textContent).toBe("list");
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

test("after a resume the current cycle draws its resumed evaluator running, again", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  expect(statusBar(container).textContent).toContain("Evaluating");
  expect(screen.queryByText("Rework budget exhausted")).toBeNull();
  const current = groups(container)[0];
  if (current === undefined) throw new Error("no current cycle");
  const running = rowsOf(current).find((row) => row.includes("Running"));
  expect(running).toBeDefined();
  expect(running).toMatch(/started \S+( \S+)? ago/u);
  expect(running).toContain("generation 2");
  expect(current.querySelector(".fig-live")).not.toBeNull();
  const blocked = rowsOf(current).find((row) => row.includes("Blocked"));
  expect(blocked).toContain("Superseded");
  const blockedRow = [...current.querySelectorAll(".ledger-row")].find(
    (row) => row.textContent?.includes("Blocked") === true,
  );
  expect(blockedRow?.classList.contains("ledger-row-superseded")).toBe(true);
});

test("a resumed ticket says it was resumed", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  const bar = statusBar(container);
  expect(bar.getAttribute("data-tone")).toBe("live");
  expect(bar.textContent).toContain("Evaluating");
  expect(bar.textContent).toContain("Resumed at stage 1 · cycle 3");
});

test("a running ticket's slot is the run going now, and nothing needs you", async () => {
  await drawTicket({ shapes: ticket21Resumed, ticket: resumedTicket });
  const now = screen.getByRole("region", { name: "Now" });
  expect(now.textContent).toContain("Stage 1 of 2 · run 8");
  expect(screen.queryByRole("status", { name: "Needs you" })).toBeNull();
});

test("a ticket that is neither running nor waiting on anyone draws no card", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...resumedTicket, phase: "Done" },
  });
  expect(screen.queryByRole("region", { name: "Now" })).toBeNull();
  expect(screen.queryByRole("status", { name: "Needs you" })).toBeNull();
});

test("a short page says so, and no cycle on it claims to be whole", async () => {
  await drawTicket({
    shapes: ticket21Parked.slice(0, 4),
    ticket: parkedTicket,
    cursor: "more",
  });
  const short = screen.getByText(/Showing first 4 executions/u);
  expect(short.classList.contains("notice-inline")).toBe(true);
  expect(short.classList.contains("notice-parked")).toBe(true);
  expect(
    screen.getAllByText("Cycle partly on this page").length,
  ).toBeGreaterThan(0);
});

test("without the draft the rows still group by the program the ticket was released with", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    withDraft: false,
  });
  expect(groups(container)).toHaveLength(3);
});

test("a ticket read carrying no program leaves the rows ungrouped and says why", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, program: undefined },
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
    const styled = [...container.querySelectorAll("[style]")].filter(
      (node) =>
        !(node.getAttribute("style") ?? "")
          .split(";")
          .every(
            (declaration) =>
              declaration.trim() === "" ||
              declaration.trim().startsWith("--radix-"),
          ),
    );
    expect(styled).toEqual([]);
    expect(document.documentElement.getAttribute("data-theme")).toBe(theme);
    expect(container.querySelector(".ticket-status")).not.toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    viewportAtEm(viewportDeskEm);
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
  await cyclesOpened(container);
  expect(drawnStringsOver(container)).toEqual([]);
});

/**
 * The rework wall's resume buys a fresh cycle, so the page must not still
 * offer it as a re-run of the evaluation.
 */
test("a rework-wall resume says it reworks rather than re-evaluates", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(screen.getByText(/Reworks · new artifact/u)).toBeDefined();
  expect(screen.queryByText(/Re-runs evaluation from stage 1/u)).toBeNull();
});

/**
 * The three reads land independently, so the ticket's own answer must not wait
 * on the draft: a stamped point is the machine's, and "nothing to resume" is a
 * claim only a page that has read enough may make.
 */
test("a resume the wire stamped is offered before the draft arrives", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    withDraft: false,
  });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact/u).closest(".act"),
  ).not.toBeNull();
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
    expect(statusBar(container).textContent).toContain("on this page");
    cleanup();
    vi.unstubAllGlobals();
    viewportAtEm(viewportDeskEm);
  }
});

/**
 * A settled ticket is dated by when it last moved, which is the journal's own
 * instant and not the failing row's end — those differ whenever anything ran
 * after the wall, and the fixture makes them differ.
 */
test("the status says when the ticket last moved, hovering the journal's own instant", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const when = statusBar(container).querySelector(".fig");
  if (when === null) throw new Error("no status figure drawn");
  expect(when.textContent).toMatch(/ ago·ran /u);
  fireEvent.focus(when);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    instantExactText(new Date(ticketInstants.changedAt)),
  );
});

/**
 * A running ticket is dated from the release the journal dates, not from
 * whatever ran first — the fixture releases well before its first execution.
 */
test("a running ticket says when it started, from its release", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  const when = statusBar(container).querySelector(".fig");
  if (when === null) throw new Error("no status figure drawn");
  expect(when.textContent).toMatch(/^started .+ ago$/u);
  fireEvent.focus(when);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    instantExactText(new Date(ticketInstants.releasedAt)),
  );
});

/**
 * §5.2's waiting reading: a row whose first attempt the wire dates says how
 * much of its window was the queue, and one it does not reads as before.
 */
/** A row reads its run to learn whether it has a conversation, so a cycle
 * the page draws closed reads its runs only once a reader opens it. */
test("a closed cycle reads none of its runs until it is opened", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const runReads = (): number =>
    routed.filter((url) => /\/executions\/[^/?]+$/u.test(url)).length;
  const onLoad = runReads();
  expect(onLoad).toBeGreaterThan(0);
  await cyclesOpened(container);
  expect(runReads()).toBeGreaterThan(onLoad);
});

test("a row separates its wait from its run where the wire dates the start", async () => {
  const started: readonly ExecutionShape[] = ticket21Parked.map((shape) =>
    shape.task === 1 ? { ...shape, startedAt: "2026-08-26T00:11:00Z" } : shape,
  );
  const { container } = await drawTicket({
    shapes: started,
    ticket: parkedTicket,
  });
  await cyclesOpened(container);
  const rows = [...container.querySelectorAll(".ledger-row")].map(
    (row) => row.querySelector(".ledger-when")?.textContent ?? "",
  );
  expect(rows.some((row) => row.includes("waited 1m·ran"))).toBe(true);
  expect(rows.some((row) => row.includes("waited") === false)).toBe(true);
});

/**
 * Only a running ticket has no end. A settled one whose runs this page has not
 * read is over, and drawing it as still going contradicts its own phase pill.
 */
test("a settled ticket is not drawn as still running when its runs are unread", async () => {
  for (const phase of ["Done", "Revoked", "Escalated"]) {
    await drawTicket({
      shapes: [],
      ticket: { ...parkedTicket, phase },
    });
    const line = document.querySelector(".ticket-status-line");
    expect(line?.textContent).not.toContain("started");
    expect(line?.textContent).toMatch(/ ago$/u);
    cleanup();
    vi.unstubAllGlobals();
    viewportAtEm(viewportDeskEm);
  }
});

test("a ticket the machine is working on now keeps its open span", async () => {
  await drawTicket({
    shapes: [],
    ticket: { ...resumedTicket, phase: "Evaluation" },
  });
  const line = document.querySelector(".ticket-status-line");
  expect(line?.textContent).toMatch(/^started .+ ago$/u);
});

/** A cancelled run has stopped, so it is not one of the runs still going. */
test("a cancelled run is counted but is not counted as running", async () => {
  const cancelled: readonly ExecutionShape[] = ticket21Parked.map((shape) => {
    if (shape.task !== 2) return shape;
    const { outcome, ...running } = shape;
    expect(outcome).toBe("Failed");
    return { ...running, status: "Cancelled" };
  });
  const { container } = await drawTicket({
    shapes: cancelled,
    ticket: parkedTicket,
  });
  await sectionOpened("Usage");
  const usage = container.querySelector("#usage")?.textContent ?? "";
  expect(usage).toContain("Runs7");
  expect(usage).not.toContain("running");
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

test("the usage panel counts the runs, and says which are still going", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  await sectionOpened("Usage");
  expect(container.querySelector("#usage")?.textContent).toContain("Runs7");
  cleanup();
  vi.unstubAllGlobals();
  viewportAtEm(viewportDeskEm);
  const resumed = await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  await sectionOpened("Usage");
  expect(resumed.container.querySelector("#usage")?.textContent).toContain(
    "Runs8 · 1 running · 1 unmeasured",
  );
});

test("the by-stage table is work first and then the program's own order", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  await sectionOpened("Usage");
  const table = screen.getByRole("table", { name: "Usage by stage" });
  expect(
    [...table.querySelectorAll("tbody th")].map((cell) => cell.textContent),
  ).toEqual(["Work", "Stage 1", "Stage 2"]);
  expect(container.querySelector("#usage")).not.toBeNull();
});

/** A stage authored three evaluators wide, two of them on the page and both
 * relaunched, its cycle superseded by the work that ran after it. */
const fanoutProgram: TicketProgram = [
  { key: 1, evaluators: [{ key: 1 }, { key: 2 }, { key: 3 }] },
];

const fanoutShapes: readonly ExecutionShape[] = [
  {
    execution: "execution-aaaa-1",
    task: 1,
    identity: evalIdentity(1, 1, 1, 1),
    outcome: "Passed",
    retriesSpent: 1,
    totals: { turns: 10, durationMs: 120_000, costUsdMicros: 400_000 },
  },
  {
    execution: "execution-aaaa-2",
    task: 2,
    identity: evalIdentity(1, 1, 1, 2),
    outcome: "Passed",
    retriesSpent: 2,
    totals: { turns: 20, durationMs: 300_000, costUsdMicros: 600_000 },
  },
  {
    execution: "execution-cccc-4",
    task: 4,
    identity: workIdentity(2),
    outcome: "Passed",
    totals: { turns: 8, durationMs: 90_000, costUsdMicros: 200_000 },
  },
];

async function drawFanout(): Promise<Drawn> {
  return drawTicket({
    shapes: fanoutShapes,
    ticket: parkedTicket,
    program: fanoutProgram,
  });
}

/**
 * A stage's evaluators each draw their own row rather than one merged over
 * the whole fan-out, so one evaluator's price, wait and relaunch count never
 * bleed into another's, and the roster's own shortfall is said once, on the
 * last evaluator the page holds.
 */
test("a sparse stage draws each evaluator as its own row, priced and timed apart", async () => {
  const { container } = await drawFanout();
  await cyclesOpened(container);
  const rows = stageRows(groups(container).at(-1));
  expect(rows).toHaveLength(2);
  expect(rows[0]?.querySelector(".ledger-label")?.textContent).toBe(
    "Stage 1 of 1 · 1",
  );
  expect(rows[1]?.querySelector(".ledger-label")?.textContent).toBe(
    "Stage 1 of 1 · 2",
  );
  expect(rows[0]?.querySelector(".ledger-spent")?.textContent).toContain(
    "$0.40",
  );
  expect(rows[1]?.querySelector(".ledger-spent")?.textContent).toContain(
    "$0.60",
  );
  expect(rows[0]?.textContent).toContain("Relaunched 1× by fabric");
  expect(rows[1]?.textContent).toContain("Relaunched 2× by fabric");
  expect(rows[1]?.textContent).toContain("2 of 3 evaluators on this page");
  expect(rows[0]?.textContent).not.toContain("evaluators on this page");
});

/**
 * The state no other fixture reaches: a stage row relaunched and short of its
 * fan-out at once, inside a cycle drawn as superseded, which is where the
 * joined fragments would run past the copy budget.
 */
test("a relaunched, short stage row in a superseded cycle still fits the copy budget", async () => {
  const { container } = await drawFanout();
  await cyclesOpened(container);
  const superseded = groups(container).at(-1);
  expect(superseded?.classList.contains("ledger-group-superseded")).toBe(true);
  const over = drawnStringsOver(container);
  expect(over).toEqual([]);
});

/** The served policy refuses `style-src` but `'self'`, so nothing the ticket
 * page draws — the canonical disclosure opened included — may append one. */
test("nothing the ticket page draws is a runtime style element", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(document.querySelectorAll("style").length).toBe(0);
  await sectionOpened("Provenance");
  fireEvent.click(screen.getByRole("button", { name: "Canonical JSON" }));
  expect(document.querySelectorAll("style").length).toBe(0);
});

const pendingTicket = {
  ticket: 21,
  phase: "Pending",
  sequence: 12,
  ...ticketInstants,
  ...released,
  revision: 2,
};

/** An update is the edit screen's to write, so the page offers the way there
 * and only where the ticket still admits one. The router is mocked, so the
 * link is found as the anchor it draws rather than by a role its href gives. */
test("a Pending ticket offers the edit screen, and a parked one does not", async () => {
  await drawTicket({ shapes: [], ticket: pendingTicket });
  expect(screen.getByText("Edit", { selector: "a" })).toBeDefined();
  cleanup();
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.queryByText("Edit", { selector: "a" })).toBeNull();
});

test("the provenance names the live revision and a draft revised past it", async () => {
  const { container } = await drawTicket({
    shapes: [],
    ticket: pendingTicket,
    versions: { authoringVersion: 3, releasedAuthoringVersion: 2 },
  });
  await sectionOpened("Provenance");
  expect(screen.getByText("Live").nextElementSibling?.textContent).toBe(
    "Revision 2",
  );
  expect(
    screen.getAllByText("Draft").at(-1)?.nextElementSibling?.textContent,
  ).toBe("1 unreleased");
  expect(drawnStringsOver(container)).toEqual([]);
});

test("the provenance says a draft at its release holds nothing unreleased", async () => {
  await drawTicket({
    shapes: [],
    ticket: pendingTicket,
    versions: { authoringVersion: 2, releasedAuthoringVersion: 2 },
  });
  await sectionOpened("Provenance");
  expect(
    screen.getAllByText("Draft").at(-1)?.nextElementSibling?.textContent,
  ).toBe("Nothing unreleased");
});

/** A Pending ticket's author may revise its draft without releasing it, and
 * the page is about what the ticket runs: the brief, its head and the
 * configuration it was released under are the ticket's, not the draft's. */
test("a ticket whose draft is ahead draws the brief and configuration it was released with", async () => {
  await drawTicket({
    shapes: [],
    ticket: pendingTicket,
    versions: { authoringVersion: 3, releasedAuthoringVersion: 2 },
    draft: {
      brief: { intent: "A rewrite nobody has released", links: [] },
      configurationRevision: "r2",
    },
  });
  await sectionOpened("Brief");
  await sectionOpened("Provenance");
  expect(screen.getAllByText("Give the console a footer").length).toBe(1);
  expect(screen.queryByText("A rewrite nobody has released")).toBeNull();
  expect(
    screen.getByText("released under").nextElementSibling?.textContent,
  ).toBe("r1");
  expect(screen.queryByText("r2")).toBeNull();
  expect(
    screen.getAllByText("Draft").at(-1)?.nextElementSibling?.textContent,
  ).toBe("1 unreleased");
});

/** A draft revised while its ticket was Pending and never released holds a
 * program the ticket does not run, so the ledger and the wall are drawn from
 * the program the ticket was released with. */
test("a ticket whose draft's program is ahead draws the stages it ran", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    versions: { authoringVersion: 3, releasedAuthoringVersion: 2 },
    draft: {
      authoring: {
        dependencies: [],
        program: [
          ...ticket21Program,
          { key: 3, evaluators: [{ key: 1 }, { key: 2 }] },
        ],
      },
    },
  });
  const current = groups(container)[0];
  expect(stageRows(current)).toHaveLength(2);
  expect(rowsOf(current ?? container)[1]).toContain("Stage 1 of 2");
  expect(container.textContent).not.toContain("of 3");
  expect(
    screen.getByRole("status", { name: "Needs you" }).textContent,
  ).toContain("Stage 1 of 2 failed");
});
