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
import {
  DetailsPane,
  DetailsToggle,
} from "../app/browser/shell/DetailsPane.tsx";
import { ShellSlots, useShellSlotHolder } from "../app/browser/shell/slots.tsx";
import { ViewportColumnAsideProvider } from "../app/browser/shell/viewport.ts";
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
import type { TicketProgram } from "../app/core/ticketLedger.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { TicketPageEveryTab, ticketHeader } from "./ticketPageEveryTab.tsx";

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
// jscpd:ignore-end -- the case's own doubles resume here

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
        <TicketPageEveryTab />
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
  options: {
    readonly shell?: boolean;
    /** Whether the pages' column holds the details beside the page. */
    readonly beside?: boolean;
  } = {},
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
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      {options.shell === true ? (
        <ViewportColumnAsideProvider value={options.beside ?? false}>
          <ShellAroundPage />
        </ViewportColumnAsideProvider>
      ) : (
        <TicketPageEveryTab />
      )}
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
  return [...container.querySelectorAll<HTMLElement>(".ticket-runs-cycle")];
}

function rowItems(group: HTMLElement | undefined): readonly HTMLElement[] {
  return [
    ...(group?.querySelectorAll<HTMLElement>(".ticket-runs-rows > li") ?? []),
  ];
}

/** Every row an evaluated stage drew, picked out from the work row that
 * always draws first in its cycle. */
function stageRows(group: HTMLElement | undefined): readonly HTMLElement[] {
  return rowItems(group).filter((row) =>
    row.querySelector(".ticket-runs-name")?.textContent?.startsWith("Stage"),
  );
}

function rowsOf(group: HTMLElement): readonly string[] {
  return rowItems(group).map((row) => row.textContent);
}

function outcomeOf(group: HTMLElement | undefined): string | undefined {
  return group?.querySelector(".ticket-runs-outcome")?.textContent;
}

/** The Overview's sidebar, which is where the page says what the ticket is
 * and what its runs have cost. */
function sidebar(): HTMLElement {
  return screen.getByRole("complementary", { name: "Properties" });
}

/** The Activity panel, which is where the page says what has run. */
function activity(): HTMLElement {
  return screen.getByRole("region", { name: "Activity" });
}

test("the parked ticket names its wall, its phase and what the whole of it cost, its tokens left to Usage", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(ticketHeader().textContent).toContain("Escalated");
  expect(sidebar().textContent).toContain("$2.74");
  expect(sidebar().textContent).not.toContain("tok");
  expect(activity().textContent).toContain("198k");
  expect(activity().textContent).toContain("Runs7");
  expect(screen.getAllByText("Rework budget exhausted").length).toBeGreaterThan(
    0,
  );
});

test("the page draws no sequence", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(sidebar().textContent).not.toContain("167");
  expect(screen.queryByText("Sequence")).toBeNull();
});

test("the wall is a card that needs you: why and which stage failed, with the resume in the header", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const card = screen.getByRole("status", { name: "Needs you" });
  expect(card.textContent).toContain("Rework budget exhausted");
  expect(card.textContent).toContain("Failed at Stage 1 in cycle 3");
  expect(card.textContent).toContain("Read the run");
  expect(within(card).queryByRole("button")).toBeNull();
  expect(
    within(ticketHeader()).getByRole("button", { name: "Resume" }),
  ).toBeDefined();
});

test("the cycles are newest first, the current one marked", async () => {
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
  expect(
    drawn.map((group) => group.querySelector(".pill")?.textContent),
  ).toEqual(["Current", undefined, undefined]);
});

test("the current cycle draws its work, its stages, where it stopped and its rollup", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const current = groups(container)[0];
  expect(current).toBeDefined();
  if (current === undefined) throw new Error("no current cycle");
  const rows = rowsOf(current);
  expect(rows[0]).toContain("Work");
  expect(rows[0]).toContain("9m 30s");
  expect(rows[1]).toContain("Stage 1");
  expect(rows[1]).toContain("$0.35");
  expect(rows[2]).toContain("Stage 2");
  expect(rows[2]).toContain("Not reached");
  expect(rows[3]).toContain("Landing");
  expect(rows[3]).toContain("Not reached");
  expect(outcomeOf(current)).toBe("Failed at Stage 1");
  expect(current.querySelector(".ticket-runs-rollup")?.textContent).toContain(
    "$2.05",
  );
});

test("a superseded cycle says what sent it back", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(outcomeOf(groups(container)[1])).toBe("Sent back by Stage 2");
});

test("a page that does not start at cycle 1 draws the cycles it holds", async () => {
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
  expect(
    groups(container).map((group) => group.querySelector("h3")?.textContent),
  ).toEqual(["Cycle 3", "Cycle 2"]);
});

test("the resume states what it re-runs", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(
    screen.getByText(/Reworks · new artifact/u).closest(".act"),
  ).not.toBeNull();
});

/** The sidebar's Repository field: its value, and the address it keeps for
 * hover. */
function repositoryCell(): { text: string; title: string | null } {
  const value = screen.getByText("Repository").nextElementSibling;
  return {
    text: value?.textContent ?? "",
    title: value?.querySelector("[title]")?.getAttribute("title") ?? null,
  };
}

test("the sidebar names the repository by its label, the address on hover", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      brief: {
        intent: "Give the console a footer",
        links: [],
        repository: "https://example.test/acme/atlas.git",
      },
    },
  });
  expect(repositoryCell()).toEqual({
    text: "acme/atlas",
    title: "https://example.test/acme/atlas.git",
  });
});

test("a brief naming no repository says so in the sidebar", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(repositoryCell()).toEqual({ text: "None", title: null });
});

test("the sidebar's repository links to its page on the forge for an https clone URL", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      brief: {
        intent: "Give the console a footer",
        links: [],
        repository: "https://github.com/kasofsk/chuggy.git",
      },
    },
  });
  const link = screen
    .getByText("Repository")
    .nextElementSibling?.querySelector("a");
  expect(link?.getAttribute("href")).toBe("https://github.com/kasofsk/chuggy");
  expect(link?.getAttribute("title")).toBe(
    "https://github.com/kasofsk/chuggy.git",
  );
});

test("the sidebar's repository stays text for an address with no page on a forge", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: {
      ...parkedTicket,
      brief: {
        intent: "Give the console a footer",
        links: [],
        repository: "http://git.chuggy-git.svc.cluster.local./chuggy.git",
      },
    },
  });
  expect(
    screen.getByText("Repository").nextElementSibling?.querySelector("a"),
  ).toBeNull();
});

test("the ticket is headed by its own title where it has one", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, title: "Serve the reason" },
  });
  expect(
    screen.getByRole("heading", { level: 1, name: "Serve the reason #21" }),
  ).toBeDefined();
});

test("the page fills no second header row in the shell's top bar: its tabs are its own", async () => {
  await drawTicket(
    { shapes: ticket21Parked, ticket: parkedTicket },
    { shell: true },
  );
  expect(
    screen.getByText("Overview").closest("nav")?.getAttribute("aria-label"),
  ).toBe("Ticket");
  expect(screen.getByRole("heading", { level: 1 }).closest("header")).not.toBe(
    null,
  );
});

test("the title is the page's one h1, and it holds the title and the number after it", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, title: "Serve the reason" },
  });
  const heading = screen.getByRole("heading", { level: 1 });
  expect(heading.textContent).toBe("Serve the reason #21");
  expect(heading.querySelector(".ticket-header-number")?.textContent).toBe(
    "#21",
  );
});

test("the brief's intent is drawn once, as markdown, under Instructions", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  const section = screen
    .getByRole("heading", { level: 2, name: "Instructions" })
    .closest("section");
  expect(section?.textContent).toContain("Give the console a footer");
  expect(screen.getAllByText("Give the console a footer")).toHaveLength(1);
});

test("every part of the page is drawn without being opened, in order", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  const names = screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "");
  const order = ["Cycle 3", "Instructions", "Configuration", "Activity"];
  const at = order.map((name) =>
    names.findIndex((held) => held.startsWith(name)),
  );
  expect(at.every((index) => index >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((x, y) => x - y));
  expect(screen.queryByRole("button", { name: /^Provenance/u })).toBeNull();
  expect(screen.queryByText("On this page")).toBeNull();
});

test("the canonical JSON is closed until asked for, and its trigger controls it", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
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
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const usage = activity();
  expect(usage.querySelector(".fig-basis")?.textContent).toBe("list");
  expect(usage.textContent).toContain("$2.74");
  expect(usage.textContent).toContain("1h 06m");
  expect(usage.textContent).toContain("claude-opus-4");
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
  expect(ticketHeader().textContent).toContain("Evaluating");
  expect(screen.queryByText("Rework budget exhausted")).toBeNull();
  const current = groups(container)[0];
  if (current === undefined) throw new Error("no current cycle");
  const marks = rowItems(current).map((row) => [
    row.querySelector(".ticket-runs-name")?.textContent,
    row.querySelector(".ticket-run-mark")?.getAttribute("data-mark"),
    row.hasAttribute("data-superseded"),
  ]);
  expect(marks).toContainEqual(["Stage 1", "Spin", false]);
  expect(marks).toContainEqual(["Stage 1", "Alert", true]);
  expect(outcomeOf(current)).toBe("Running Stage 1");
});

test("a running ticket's slot is the run going now, and nothing needs you", async () => {
  await drawTicket({ shapes: ticket21Resumed, ticket: resumedTicket });
  const now = screen.getByRole("region", { name: "Now" });
  expect(now.querySelector(".ticket-card-title")?.textContent).toBe(
    "Running Stage 1",
  );
  expect(now.querySelector(".ticket-card-where")?.textContent).toContain(
    "Cycle 3",
  );
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

test("a short page says so", async () => {
  await drawTicket({
    shapes: ticket21Parked.slice(0, 4),
    ticket: parkedTicket,
    cursor: "more",
  });
  const short = screen.getByText(/Showing first 4 executions/u);
  expect(short.classList.contains("notice-inline")).toBe(true);
  expect(short.classList.contains("notice-parked")).toBe(true);
  expect(
    within(screen.getByRole("navigation", { name: "Ticket" })).getByRole(
      "link",
      { name: /^Runs/u },
    ).textContent,
  ).toBe("Runs4+");
});

test("without the draft the rows still group by the program the ticket was released with", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
    withDraft: false,
  });
  expect(groups(container)).toHaveLength(3);
});

test("a ticket read carrying no program still groups its runs by cycle, and numbers its stages", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...parkedTicket, program: undefined },
  });
  expect(groups(container)).toHaveLength(3);
  expect(
    groups(container).flatMap((group) =>
      rowItems(group).map(
        (row) => row.querySelector(".ticket-runs-name")?.textContent,
      ),
    ),
  ).toEqual([
    "Work",
    "Stage 1",
    "Landing",
    "Work",
    "Stage 1",
    "Stage 2",
    "Work",
    "Stage 1",
  ]);
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
    expect(container.querySelector(".ticket-steps")).not.toBeNull();
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
 * Truncation is the executions read's own fact and does not wait on the draft.
 */
test("a short page marks the run count, draft or no draft", async () => {
  for (const withDraft of [true, false]) {
    await drawTicket({
      shapes: ticket21Parked.slice(0, 4),
      ticket: parkedTicket,
      cursor: "more",
      withDraft,
    });
    expect(activity().textContent).toContain("on this page");
    cleanup();
    vi.unstubAllGlobals();
    viewportAtEm(viewportDeskEm);
  }
});

/** A row reads its run to learn whether it has a conversation, so a cycle
 * the page draws closed reads its runs only once a reader opens it. */
test("the Runs tab reads each run it lists once, for the line it says", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const runsRead = routed.flatMap(
    (url) => /\/executions\/([^/?]+)$/u.exec(url)?.slice(1) ?? [],
  );
  expect([...new Set(runsRead)].sort()).toEqual(
    ticket21Parked.map((shape) => shape.execution).sort(),
  );
});

/** A run's time is how long it ran, from its first attempt's opening, so the
 * queue before it is no part of it. */
test("a row's time is its run's span from its start, the wait left out", async () => {
  const started: readonly ExecutionShape[] = ticket21Parked.map((shape) =>
    shape.task === 1 ? { ...shape, startedAt: "2026-08-26T00:11:00Z" } : shape,
  );
  const times = async (
    shapes: readonly ExecutionShape[],
  ): Promise<string | undefined> => {
    const { container } = await drawTicket({ shapes, ticket: parkedTicket });
    const work = rowItems(groups(container).at(-1))[0];
    const time = work?.querySelector(".ticket-runs-time")?.textContent;
    cleanup();
    vi.unstubAllGlobals();
    viewportAtEm(viewportDeskEm);
    return time;
  };
  const from = await times(ticket21Parked);
  const ran = await times(started);
  expect(from).not.toBe(ran);
  expect(ran).toMatch(/^\d+m( \d{2}s)?$/u);
});

/** A cancelled run has stopped, so it is not one of the runs still going. */
test("a cancelled run is counted but is not counted as running", async () => {
  const cancelled: readonly ExecutionShape[] = ticket21Parked.map((shape) => {
    if (shape.task !== 2) return shape;
    const { outcome, ...running } = shape;
    expect(outcome).toBe("Failed");
    return { ...running, status: "Cancelled" };
  });
  await drawTicket({
    shapes: cancelled,
    ticket: parkedTicket,
  });
  const usage = activity().textContent;
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
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  expect(activity().textContent).toContain("Runs7");
  cleanup();
  vi.unstubAllGlobals();
  viewportAtEm(viewportDeskEm);
  await drawTicket({
    shapes: ticket21Resumed,
    ticket: resumedTicket,
  });
  expect(activity().textContent).toContain("Runs8 · 1 running · 1 unmeasured");
});

test("the by-stage table is work first and then the program's own order", async () => {
  await drawTicket({
    shapes: ticket21Parked,
    ticket: parkedTicket,
  });
  const table = within(activity()).getByRole("table", {
    name: "Usage by stage",
  });
  expect(
    [...table.querySelectorAll("tbody th")].map((cell) => cell.textContent),
  ).toEqual(["Work", "Stage 1", "Stage 2"]);
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
    relaunches: 1,
    totals: { turns: 10, durationMs: 120_000, costUsdMicros: 400_000 },
  },
  {
    execution: "execution-aaaa-2",
    task: 2,
    identity: evalIdentity(1, 1, 1, 2),
    outcome: "Passed",
    retriesSpent: 2,
    relaunches: 2,
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
test("a sparse stage draws each evaluator as its own row, priced apart", async () => {
  const { container } = await drawFanout();
  const rows = stageRows(groups(container).at(-1));
  expect(rows).toHaveLength(2);
  expect(rows[0]?.querySelector(".ticket-runs-name")?.textContent).toBe(
    "Stage 1 · 1",
  );
  expect(rows[1]?.querySelector(".ticket-runs-name")?.textContent).toBe(
    "Stage 1 · 2",
  );
  expect(rows[0]?.querySelector(".ticket-runs-cost")?.textContent).toContain(
    "$0.40",
  );
  expect(rows[1]?.querySelector(".ticket-runs-cost")?.textContent).toContain(
    "$0.60",
  );
});

/**
 * The state no other fixture reaches: a stage row relaunched and short of its
 * fan-out at once, inside a cycle drawn as superseded, which is where the
 * joined fragments would run past the copy budget.
 */
test("a relaunched, short stage row in a superseded cycle still fits the copy budget", async () => {
  const { container } = await drawFanout();
  const superseded = groups(container).at(-1);
  expect(superseded?.querySelector(".pill")).toBeNull();
  const over = drawnStringsOver(container);
  expect(over).toEqual([]);
});

/** The served policy refuses `style-src` but `'self'`, so nothing the ticket
 * page draws — the canonical disclosure opened included — may append one. */
test("nothing the ticket page draws is a runtime style element", async () => {
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(document.querySelectorAll("style").length).toBe(0);
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

/** The banner over the steps, which is drawn only for a draft holding edits
 * no update has released. */
function unreleased(): HTMLElement | null {
  return screen.queryByRole("region", { name: "Unreleased changes" });
}

test("the instructions name the live revision and when it was released, and a draft revised past it is a banner leading to its form", async () => {
  const { container } = await drawTicket({
    shapes: [],
    ticket: pendingTicket,
    versions: { authoringVersion: 4, releasedAuthoringVersion: 2 },
  });
  expect(container.querySelector(".ticket-revision")?.textContent).toMatch(
    /^Revision 2 · .+ ago$/u,
  );
  expect(unreleased()?.textContent).toBe("2 unreleased changesOpen draft");
  expect(screen.queryByText("Revision history")).toBeNull();
  expect(drawnStringsOver(container)).toEqual([]);
});

test("a draft at its release, or one not yet read, draws no banner", async () => {
  await drawTicket({
    shapes: [],
    ticket: pendingTicket,
    versions: { authoringVersion: 2, releasedAuthoringVersion: 2 },
  });
  expect(unreleased()).toBeNull();
  cleanup();
  vi.unstubAllGlobals();
  viewportAtEm(viewportDeskEm);
  await drawTicket({ shapes: [], ticket: pendingTicket, withDraft: false });
  expect(unreleased()).toBeNull();
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
  expect(screen.getAllByText("Give the console a footer").length).toBe(1);
  expect(screen.queryByText("A rewrite nobody has released")).toBeNull();
  expect(
    within(sidebar()).getByText("Configuration").nextElementSibling
      ?.textContent,
  ).toBe("r1");
  expect(screen.queryByText("r2")).toBeNull();
  expect(unreleased()?.textContent).toContain("1 unreleased change");
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
  expect(rowsOf(current ?? container)[1]).toContain("Stage 1");
  expect(container.textContent).not.toContain("Stage 3");
  expect(
    screen.getByRole("status", { name: "Needs you" }).textContent,
  ).toContain("Failed at Stage 1 in cycle 3");
});

/** Every run a finished ticket holds has ended, and the page says how each
 * one did rather than the machine's word for having ended. */
test("a finished ticket's page never says Terminal", async () => {
  const { container } = await drawTicket({
    shapes: ticket21Parked,
    ticket: { ...resumedTicket, phase: "Done" },
  });
  expect(container.textContent).toContain("Done");
  expect(container.textContent).not.toContain("Terminal");
});

/** What the sidebar says against one name. */
function sidebarField(name: string): HTMLElement | null {
  const value = within(sidebar()).queryByText(name, {
    selector: "dt",
  })?.nextElementSibling;
  return value instanceof HTMLElement ? value : null;
}

test("the sidebar draws each dependency with its state, the configuration it runs under and its branch by name", async () => {
  await drawTicket({
    shapes: [],
    ticket: {
      ...pendingTicket,
      dependencies: [19, 20],
      revokedDependencies: [19],
      openDependencies: [{ ticket: 20, phase: "Work" }],
      configurationVersion: { name: "atlas", number: 6 },
      brief: {
        ...released.brief,
        branch: "refs/heads/footer",
        finalization: { kind: "PullRequest", target: "refs/heads/main" },
      },
    },
  });
  expect(sidebarField("Depends on")?.textContent).toBe("#19Revoked#20Working");
  expect(sidebarField("Configuration")?.textContent).toBe("atlas #6");
  expect(sidebarField("Branch")?.textContent).toBe("footer → main");
});

test("cost and run time are absent before the first run, and say so far while a run is live", async () => {
  await drawTicket({ shapes: [], ticket: pendingTicket });
  expect(sidebarField("Cost")).toBeNull();
  expect(sidebarField("Run time")).toBeNull();
  cleanup();
  vi.unstubAllGlobals();
  viewportAtEm(viewportDeskEm);
  await drawTicket({ shapes: ticket21Resumed, ticket: resumedTicket });
  expect(sidebarField("Cost")?.textContent).toMatch(/^\$2\.74.* so far$/u);
  expect(sidebarField("Run time")?.textContent).toMatch(/ so far$/u);
  cleanup();
  vi.unstubAllGlobals();
  viewportAtEm(viewportDeskEm);
  await drawTicket({ shapes: ticket21Parked, ticket: parkedTicket });
  expect(sidebarField("Run time")?.textContent).not.toContain("so far");
});
