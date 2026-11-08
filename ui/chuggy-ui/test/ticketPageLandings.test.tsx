// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ticketLandingsPolledMs } from "../app/core/ticketLandings.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  ticketPageAmbientRoute,
  turned,
} from "./screenHarness.tsx";
import {
  landingAwaitingMerge,
  landingClosed,
  landingConflicted,
  landingConflictPath,
  landingHeld,
  landingLanded,
  landingMergedElsewhere,
  landingPullRequest,
  landingRunning,
  landingsRead,
  ticket68Shapes,
} from "./ticketLandingsFixture.ts";
import { ledgerPage, ticket21Program } from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { frame } from "./streamDouble.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketLandingPageAt,
  TicketPageEveryTab,
} from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "21" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/**
 * The ticket page over what the read of its landings answers: a Landing row
 * under the cycle it belongs to on the Runs tab, the landing's own page with
 * every record the read holds, the Overview's Landing step, and the read
 * asked again on a frame and on a clock.
 */

/**
 * The instant every case is drawn at. The page reads ages against the clock,
 * so a clock left moving lets two draws a case compares straddle a change in
 * an age's text; only `Date` is fixed, so the harness's timers still run.
 */
const ticketPageLandingsNowMs = Date.parse("2026-10-29T00:30:00Z");

beforeEach(() => {
  vi.setSystemTime(ticketPageLandingsNowMs);
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Answering = (url: string) => Response | Promise<Response>;

/** What a case serves beside the landings: the ticket's phase and program and its runs. */
interface Served {
  readonly phase?: string;
  readonly program?: boolean;
  readonly shapes?: readonly ExecutionShape[];
  /** How the brief lands the work, its read's default where a case names none. */
  readonly finalization?: { readonly kind: string };
}

function ticketBody(served: Served): Record<string, unknown> {
  return {
    ticket: 21,
    phase: served.phase ?? "Work",
    sequence: 9,
    ...ticketInstants,
    brief: {
      intent: "Land the console",
      links: [],
      ...(served.finalization === undefined
        ? {}
        : { finalization: served.finalization }),
    },
    ...(served.program === false ? {} : { program: ticket21Program }),
  };
}

/** Every address the landings read was asked at by the last drawn page. */
let landingsAsked: string[] = [];

/** The stream the last drawn page is listening on, for a case to push at. */
let stream = openedStream();

async function drawn(
  landings: Answering,
  served: Served = {},
  page: ReactNode = <TicketPageEveryTab />,
): Promise<HTMLElement> {
  landingsAsked = [];
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const ambient = ticketPageAmbientRoute(url);
      if (ambient !== undefined) return ambient;
      if (url.includes("/executions"))
        return answer(ledgerPage(served.shapes ?? ticket68Shapes));
      if (url.includes("/drafts/")) return answer({}, 404);
      return answer(ticketBody(served));
    },
    landings: (url) => {
      landingsAsked.push(url);
      return landings(url);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  stream = openedStream();
  const view = renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={stream.ports.fetch}
    >
      {page}
    </ScreenHarness>,
  );
  await settled();
  return view.container;
}

function groupOf(container: HTMLElement, cycle: number): HTMLElement {
  const group = [
    ...container.querySelectorAll<HTMLElement>(".ticket-runs-cycle"),
  ].find(
    (held) =>
      held.querySelector("h3")?.textContent === `Cycle ${String(cycle)}`,
  );
  if (group === undefined) throw new Error(`no cycle ${String(cycle)} drawn`);
  return group;
}

function summaryOf(group: HTMLElement): string | null | undefined {
  return group.querySelector(".ticket-runs-outcome")?.textContent;
}

/** What a cycle's Landing row on the Runs tab says, where it draws one. */
function landingSaid(group: HTMLElement): string | undefined {
  return [...group.querySelectorAll(".ticket-runs-rows > li")]
    .find(
      (row) =>
        row.querySelector(".ticket-runs-name")?.textContent === "Landing",
    )
    ?.querySelector(".ticket-runs-line")?.textContent;
}

/** What the Overview's steps block says of the current cycle's landing. */
function stepsLanding(container: HTMLElement): HTMLElement {
  const box = container.querySelector<HTMLElement>(
    '[aria-label="Finalization"] .ticket-steps-name',
  )?.parentElement;
  if (box === null || box === undefined)
    throw new Error("no Landing box drawn");
  return box;
}

/** The mark a cycle's Landing row on the Runs tab is drawn with, where it
 * draws one. */
function landingMarkOf(group: HTMLElement): string | null | undefined {
  return [...group.querySelectorAll(".ticket-runs-rows > li")]
    .find(
      (row) =>
        row.querySelector(".ticket-runs-name")?.textContent === "Landing",
    )
    ?.querySelector(".ticket-run-mark")
    ?.getAttribute("data-mark");
}

/** The landing's own page over what the read answers. */
function landingPage(landings: Answering, served: Served = {}) {
  return drawn(landings, served, <TicketLandingPageAt />);
}

/** The rows of every Landing block `scope` is or holds. */
function landingRows(scope: HTMLElement): readonly HTMLElement[] {
  return [
    ...(scope.matches(".ledger-block") ? [scope] : []),
    ...scope.querySelectorAll<HTMLElement>(".ledger-block"),
  ]
    .filter(
      (block) =>
        block.querySelector(".ledger-eyebrow")?.textContent === "Landing",
    )
    .flatMap((block) => [
      ...block.querySelectorAll<HTMLElement>(".ledger-row"),
    ]);
}

function rowSaid(row: HTMLElement): readonly (string | null | undefined)[] {
  return [
    row.querySelector(".ledger-label")?.textContent,
    row.querySelector(".pill")?.textContent,
    row.querySelector(".ledger-note")?.textContent,
  ];
}

/** Every cycle's header and every row it draws, as text. */
function cyclesSaid(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".ticket-runs-cycle")].map(
    (group) => group.textContent,
  );
}

/** What the landing page's list says against one name. */
function fieldOf(container: HTMLElement, name: string): HTMLElement {
  const value = within(container).getByText(name, {
    selector: "dt",
  }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no ${name} drawn`);
  return value;
}

async function detailOpened(row: HTMLElement): Promise<HTMLElement> {
  await turned(() => {
    within(row).getByRole("button", { name: "Details" }).click();
  });
  await settled();
  const detail = row.querySelector<HTMLElement>(".ledger-detail");
  if (detail === null) throw new Error("no detail drawn");
  return detail;
}

const conflicted68: Answering = () =>
  answer(landingsRead([landingConflicted(2)]));

test("a ticket with no landings, and one whose read never answered, draws its cycles as before", async () => {
  const none = cyclesSaid(
    await drawn(() => answer({ landings: [], truncated: false })),
  );
  cleanup();
  const unanswered = await drawn(() => new Promise<Response>(() => undefined));
  expect(cyclesSaid(unanswered)).toEqual(none);
  expect(summaryOf(groupOf(unanswered, 2))).toBe("Passed");
  expect(landingSaid(groupOf(unanswered, 3))).toBe("Not reached");
  expect(landingSaid(groupOf(unanswered, 2))).toBeUndefined();
  cleanup();
  const page = await landingPage(() =>
    answer({ landings: [], truncated: false }),
  );
  expect(page.textContent).toContain("No landing");
});

test("a cycle whose landing failed on a conflict draws it failed, and its page every record of it", async () => {
  const container = await drawn(conflicted68);
  expect(summaryOf(groupOf(container, 2))).toBe("Landing failed");
  expect(landingSaid(groupOf(container, 2))).toBe("Failed");
  expect(landingMarkOf(groupOf(container, 2))).toBe("Cross");
  cleanup();
  const page = await landingPage(conflicted68);
  expect(page.querySelector(".ticket-run-heading")?.textContent).toBe(
    "LandingCycle 2Failed",
  );
  expect(
    page
      .querySelector(".ticket-run-heading .ticket-run-mark")
      ?.getAttribute("data-mark"),
  ).toBe("Cross");
  const [row] = landingRows(page);
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Cycle 2",
    "Failed",
    "Merge conflict · 1 file",
  ]);
  expect(row.querySelector(".pill")?.className).toBe("pill pill-fail");
  const detail = await detailOpened(row);
  expect(detail.textContent).toContain(landingConflictPath);
  expect(detail.textContent).toContain("Targetmain");
  expect(detail.textContent).not.toContain("refs/heads/");
  expect(detail.textContent).toContain("7c1e04a");
  expect(detail.textContent).toContain("b51d9f0");
  expect(detail.textContent).not.toContain("More not shown");
});

test("a landed landing draws its pull request as a link named as its forge names it, and its commits short", async () => {
  const landed = () => answer(landingsRead([landingLanded(3)]));
  const container = await drawn(landed);
  expect(summaryOf(groupOf(container, 3))).toBe("Running work");
  expect(landingSaid(groupOf(container, 3))).toBe("Landed");
  cleanup();
  const page = await landingPage(landed);
  const link = within(fieldOf(page, "Pull request")).getByRole("link");
  expect(link.textContent).toBe("acme/atlas#68");
  expect(link.getAttribute("href")).toBe(landingPullRequest);
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(fieldOf(page, "Pull request").textContent).toBe(
    "acme/atlas#68 · Landed",
  );
  expect(fieldOf(page, "Head").textContent).toBe("b51d9f0");
  expect(fieldOf(page, "Merge commit").textContent).toBe("e0f3a7c");
  expect(fieldOf(page, "Attempts").textContent).toBe("1");
});

test("a pull request a person merged at another head draws its merge commit and that the head was not evaluated on its record, and both heads in its detail", async () => {
  const page = await landingPage(() =>
    answer(landingsRead([landingMergedElsewhere(3)])),
  );
  const [row] = landingRows(page);
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Cycle 3",
    "Landed",
    "forge.example.testMergede0f3a7c·Unevaluated head",
  ]);
  expect(
    [...row.querySelectorAll(".ledger-note .ticket-landing-part")].map(
      (commit) => commit.textContent,
    ),
  ).toEqual(["Mergede0f3a7c", "·Unevaluated head"]);
  const detail = await detailOpened(row);
  expect(detail.textContent).toContain("Merge commite0f3a7c");
  expect(detail.textContent).toContain("Merged headd4e5f6a");
  expect(detail.textContent).toContain("Evaluated headb51d9f0");
  expect(detail.textContent).not.toContain("Status");
});

test("a landing held on its pull request being closed says closed, and offers the pull request", async () => {
  const since = new Date(Date.now() - 3 * 60_000 - 5_000).toISOString();
  const page = await landingPage(() =>
    answer(landingsRead([landingClosed(3, since)])),
  );
  const [row] = landingRows(page);
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Cycle 3",
    "Held",
    "Held 3m · Closedforge.example.test",
  ]);
  expect(
    within(row).getByRole("link").getAttribute("href"),
    "a closed pull request is offered to be reopened",
  ).toBe(landingPullRequest);
});

test("a pull request address that does not parse, or is not https, draws no link and leaves the cycles drawn", async () => {
  for (const url of ["not a url", "http://forge.example.test/pull/68"]) {
    const landed = () => answer(landingsRead([landingLanded(3, url)]));
    const container = await drawn(landed);
    expect(container.querySelectorAll(".ticket-runs-cycle")).toHaveLength(3);
    cleanup();
    const page = await landingPage(landed);
    expect(page.querySelector('a[href*="pull"]')).toBeNull();
    cleanup();
  }
});

test("a held landing draws its age and hold on its record, and on the steps block's Landing", async () => {
  const since = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
  const held = () => answer(landingsRead([landingHeld(3, since)]));
  const container = await drawn(held, { phase: "Finalization" });
  expect(stepsLanding(container).textContent).toBe(
    "LandingHeld 12m · Target unreadable",
  );
  cleanup();
  const [row] = landingRows(await landingPage(held, { phase: "Finalization" }));
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Cycle 3",
    "Held",
    "Held 12m · Target unreadable",
  ]);
});

test("a landing whose merge waits on the forge says so on its record, its detail and the steps block's Landing", async () => {
  const checkedAt = new Date(Date.now() - 2 * 60_000 - 5_000).toISOString();
  const waiting = () =>
    answer(landingsRead([landingAwaitingMerge(3, checkedAt)]));
  const container = await drawn(waiting, { phase: "Finalization" });
  expect(stepsLanding(container).textContent).toContain(
    "Blocked · behind · checked 2m ago",
  );
  cleanup();
  const [row] = landingRows(
    await landingPage(waiting, { phase: "Finalization" }),
  );
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Cycle 3",
    "Waiting",
    "Blocked · behind · checked 2m agoforge.example.test",
  ]);
  expect(within(row).getByRole("link").getAttribute("href")).toBe(
    landingPullRequest,
  );
  const detail = await detailOpened(row);
  expect(detail.textContent).toContain("Merge statebehind");
  expect(detail.textContent).toContain("Checked");
});

test("a running landing's box marks it under way and leads to the landing's page", async () => {
  const container = await drawn(
    () => answer(landingsRead([landingConflicted(2), landingRunning(3)])),
    { phase: "Finalization" },
  );
  const box = stepsLanding(container);
  expect(box.querySelector(".ticket-run-mark")?.getAttribute("data-mark")).toBe(
    "Merge",
  );
  expect(box.closest("a")).not.toBeNull();
});

test("a failed landing's box draws the failed mark and why, never the merge mark", async () => {
  const container = await drawn(
    () => answer(landingsRead([landingConflicted(3)])),
    { phase: "Escalated" },
  );
  const box = stepsLanding(container);
  expect(box.querySelector(".ticket-run-mark")?.getAttribute("data-tone")).toBe(
    "fail",
  );
  expect(box.textContent).toBe("LandingMerge conflict");
});

test("two landings of one cycle draw two records in the read's order, the cycle naming the newer", async () => {
  const twice = () =>
    answer(
      landingsRead([
        landingConflicted(3),
        { ...landingRunning(3), generation: 2 },
      ]),
    );
  const container = await drawn(twice);
  const third = groupOf(container, 3);
  expect(summaryOf(third)).toBe("Running work");
  expect(landingSaid(third)).toBe("Running");
  cleanup();
  expect(
    landingRows(await landingPage(twice)).map((row) => rowSaid(row)[1]),
  ).toEqual(["Failed", "Running"]);
});

test("a landing whose cycle the ledger does not hold is a record of the landing's page, naming its cycle", async () => {
  const beyond = () =>
    answer(landingsRead([landingConflicted(2), landingRunning(4)]));
  const container = await drawn(beyond);
  expect(container.querySelectorAll(".ticket-runs-cycle")).toHaveLength(3);
  cleanup();
  const page = await landingPage(beyond);
  expect(landingRows(page).map((row) => rowSaid(row).slice(0, 2))).toEqual([
    ["Cycle 2", "Failed"],
    ["Cycle 4", "Running"],
  ]);
});

test("a ticket whose read carries no program still draws its landing under its cycle", async () => {
  const container = await drawn(conflicted68, { program: false });
  expect(landingSaid(groupOf(container, 2))).toBe("Failed");
});

test("a conflict list the read says was cut says so", async () => {
  const cut = landingConflicted(3);
  const page = await landingPage(() =>
    answer(
      landingsRead([
        { ...cut, conflict: { paths: [landingConflictPath], truncated: true } },
      ]),
    ),
  );
  const [row] = landingRows(page);
  if (row === undefined) throw new Error("no Landing row drawn");
  expect((await detailOpened(row)).textContent).toContain("More not shown");
});

test("a frame naming the ticket asks the read again, and one naming another does not", async () => {
  const container = await drawn(conflicted68);
  expect(landingsAsked).toHaveLength(1);
  const pushed = (resource: string, ticket: number): void => {
    stream.push(
      frame("Ticket", "40", {
        version: 1,
        resource,
        representation: { ...ticketBody({}), ticket },
      }),
    );
  };
  await turned(() => {
    pushed("40", 40);
  });
  await settled();
  expect(landingsAsked).toHaveLength(1);
  await turned(() => {
    pushed("21", 21);
  });
  await settled();
  expect(landingsAsked).toHaveLength(2);
  expect(summaryOf(groupOf(container, 2))).toBe("Landing failed");
});

async function clockMoved(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

test("the clock asks the read again, and a read that fails keeps the last answer and the cycles", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let next: Answering = conflicted68;
  const container = await drawn((url) => next(url));
  expect(landingsAsked).toHaveLength(1);
  next = () => answer({ error: { code: "InternalError" } }, 500);
  await clockMoved(ticketLandingsPolledMs);
  await settled();
  expect(landingsAsked).toHaveLength(2);
  expect(container.querySelectorAll(".ticket-runs-cycle")).toHaveLength(3);
  expect(summaryOf(groupOf(container, 2))).toBe("Landing failed");
});

test("a ticket that lands nothing reads None for its Landing on the Runs tab, the rail and the steps block, with no mark and no link", async () => {
  const container = await drawn(
    () => answer({ landings: [], truncated: false }),
    { phase: "Done", finalization: { kind: "None" } },
  );
  const current = groupOf(container, 3);
  expect(landingSaid(current)).toBe("None");
  expect(landingMarkOf(current)).toBeNull();
  const row = [...current.querySelectorAll(".ticket-runs-rows > li")].find(
    (held) =>
      held.querySelector(".ticket-runs-name")?.textContent === "Landing",
  );
  expect(row?.querySelector("a")).toBeNull();
  const box = stepsLanding(container);
  expect(box.textContent).toBe("LandingNone");
  expect(box.querySelector("svg")).toBeNull();
  expect(box.closest("a")).toBeNull();
  cleanup();
  const rail = within(
    await landingPage(() => answer({ landings: [], truncated: false }), {
      phase: "Done",
      finalization: { kind: "None" },
    }),
  ).getByRole("navigation", { name: "Runs" });
  const landing = within(rail).getByText("Landing");
  expect(landing.closest("a")).toBeNull();
  expect(landing.parentElement?.querySelector("svg")).toBeNull();
});

test("the landing's page names the branches it lands from and into, never their whole references", async () => {
  const landed = landingLanded(3);
  const page = await landingPage(() =>
    answer(
      landingsRead([
        {
          ...landed,
          proposal:
            landed.proposal === undefined
              ? undefined
              : {
                  ...landed.proposal,
                  headRef: "refs/heads/chug/ticket-68",
                  baseRef: "refs/heads/main",
                },
        },
      ]),
    ),
  );
  expect(fieldOf(page, "From").textContent).toBe("chug/ticket-68");
  expect(fieldOf(page, "Into").textContent).toBe("main");
});
