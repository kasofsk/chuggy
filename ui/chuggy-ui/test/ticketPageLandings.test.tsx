// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
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
  landingConflicted,
  landingConflictPath,
  landingHeld,
  landingLanded,
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
import { viewportAtEm } from "./viewport.ts";

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
 * The ticket page over what the read of its landings answers: a row a landing
 * under the cycle it belongs to, the fragment on that cycle's header and on
 * the cycle a failed landing opened, the status bar while it finalizes, and
 * the read asked again on a frame and on a clock.
 */

beforeEach(() => {
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
}

function ticketBody(served: Served): Record<string, unknown> {
  return {
    ticket: 21,
    phase: served.phase ?? "Work",
    sequence: 9,
    ...ticketInstants,
    brief: { intent: "Land the console", links: [] },
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
  const view = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={stream.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  return view.container;
}

function groupOf(container: HTMLElement, cycle: number): HTMLElement {
  const group = [
    ...container.querySelectorAll<HTMLElement>(".ledger-group"),
  ].find(
    (held) =>
      held.querySelector("h3")?.textContent === `Cycle ${String(cycle)}`,
  );
  if (group === undefined) throw new Error(`no cycle ${String(cycle)} drawn`);
  return group;
}

/** A cycle opened, since a superseded one is closed and mounts no rows. */
async function groupOpened(
  container: HTMLElement,
  cycle: number,
): Promise<HTMLElement> {
  const group = groupOf(container, cycle);
  await turned(() => {
    (group as HTMLDetailsElement).open = true;
    group.dispatchEvent(new Event("toggle"));
  });
  await settled();
  return group;
}

function summaryOf(group: HTMLElement): string | null | undefined {
  return group.querySelector(".ledger-group-summary")?.textContent;
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

/** Every cycle's header and every row the open ones draw, as text. */
function cyclesSaid(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".ledger-group")].map(
    (group) => group.textContent ?? "",
  );
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
  expect(summaryOf(groupOf(unanswered, 2))).toBe(
    "Work passed · Stage 2 of 2 passed",
  );
  expect(landingRows(unanswered)).toEqual([]);
  expect(none.join(" ")).not.toContain("Landing");
});

test("ticket 68: the second cycle's landing failed on a conflict, and the third says it follows it", async () => {
  const container = await drawn(conflicted68);
  expect(summaryOf(groupOf(container, 2))).toBe(
    "Work passed · Stage 2 of 2 passed · Landing failed",
  );
  const third = groupOf(container, 3);
  const opened = third.querySelector(".ledger-note span.text-tone-fail");
  expect(opened?.textContent?.trim()).toBe("After merge conflict");
  expect(landingRows(third)).toEqual([]);

  const second = await groupOpened(container, 2);
  const [row] = landingRows(second);
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Landing",
    "Failed",
    "Merge conflict · 1 file",
  ]);
  expect(row.querySelector(".pill")?.className).toBe("pill pill-fail");
  const detail = await detailOpened(row);
  expect(detail.textContent).toContain(landingConflictPath);
  expect(detail.textContent).toContain("refs/heads/main");
  expect(detail.textContent).toContain("7c1e04a");
  expect(detail.textContent).toContain("b51d9f0");
  expect(detail.textContent).not.toContain("More not shown");
});

test("a landed landing draws its pull request as a link under its host, and its commit short", async () => {
  const container = await drawn(() => answer(landingsRead([landingLanded(3)])));
  const [row] = landingRows(groupOf(container, 3));
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row).slice(0, 2)).toEqual(["Landing", "Landed"]);
  const link = within(row).getByRole("link");
  expect(link.textContent).toBe("forge.example.test");
  expect(link.getAttribute("href")).toBe(landingPullRequest);
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(row.querySelector(".ledger-note .identity")?.textContent).toBe(
    "e0f3a7c",
  );
  expect(summaryOf(groupOf(container, 3))).toMatch(/ · Landed$/u);
});

test("a pull request address that does not parse, or is not https, draws no link and leaves the cycles drawn", async () => {
  for (const url of ["not a url", "http://forge.example.test/pull/68"]) {
    const container = await drawn(() =>
      answer(landingsRead([landingLanded(3, url)])),
    );
    expect(container.querySelectorAll(".ledger-group")).toHaveLength(3);
    expect(container.querySelector('.ledger a[href*="pull"]')).toBeNull();
    cleanup();
  }
});

test("a held landing draws its age and hold on its row, and on the status bar while finalizing", async () => {
  const since = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
  const container = await drawn(
    () => answer(landingsRead([landingHeld(3, since)])),
    { phase: "Finalization" },
  );
  const [row] = landingRows(groupOf(container, 3));
  if (row === undefined) throw new Error("no Landing row drawn");
  expect(rowSaid(row)).toEqual([
    "Landing",
    "Held",
    "Held 12m · Target unreadable",
  ]);
  expect(container.querySelector(".ticket-status-line")?.textContent).toContain(
    "Held 12m · Target unreadable",
  );
});

test("a running landing's pull request is a link on the status bar while finalizing", async () => {
  const container = await drawn(
    () => answer(landingsRead([landingConflicted(2), landingRunning(3)])),
    { phase: "Finalization" },
  );
  const line = container.querySelector<HTMLElement>(".ticket-status-line");
  if (line === null) throw new Error("no status line drawn");
  expect(within(line).getByRole("link").getAttribute("href")).toBe(
    landingPullRequest,
  );
});

test("a landing is not on the status bar while the ticket is not finalizing", async () => {
  const container = await drawn(() =>
    answer(landingsRead([landingRunning(3)])),
  );
  expect(container.querySelector(".ticket-status-line a[href]")).toBeNull();
});

test("two landings of one cycle draw two rows in the read's order, the header naming the newer", async () => {
  const container = await drawn(() =>
    answer(
      landingsRead([
        landingConflicted(3),
        { ...landingRunning(3), generation: 2 },
      ]),
    ),
  );
  const third = groupOf(container, 3);
  expect(landingRows(third).map((row) => rowSaid(row)[1])).toEqual([
    "Failed",
    "Running",
  ]);
  expect(summaryOf(third)).toMatch(/ · Landing running$/u);
});

test("a landing whose cycle the ledger does not hold is drawn after the cycles, naming its cycle", async () => {
  const container = await drawn(() =>
    answer(landingsRead([landingConflicted(2), landingRunning(4)])),
  );
  const ledger = container.querySelector<HTMLElement>(".ledger");
  const last = ledger?.lastElementChild as HTMLElement;
  expect(last.classList.contains("ledger-block")).toBe(true);
  expect(landingRows(last).map((row) => rowSaid(row).slice(0, 2))).toEqual([
    ["Cycle 4", "Running"],
  ]);
  expect(container.querySelectorAll(".ledger-group")).toHaveLength(3);
});

test("a ticket whose read carries no program draws every landing after its rows", async () => {
  const container = await drawn(conflicted68, { program: false });
  expect(container.querySelectorAll(".ledger-group")).toHaveLength(0);
  expect(landingRows(container).map((row) => rowSaid(row).slice(0, 2))).toEqual(
    [["Cycle 2", "Failed"]],
  );
});

test("a conflict list the read says was cut says so", async () => {
  const cut = landingConflicted(3);
  const container = await drawn(() =>
    answer(
      landingsRead([
        { ...cut, conflict: { paths: [landingConflictPath], truncated: true } },
      ]),
    ),
  );
  const [row] = landingRows(groupOf(container, 3));
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
  expect(summaryOf(groupOf(container, 2))).toMatch(/Landing failed$/u);
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
  expect(container.querySelectorAll(".ledger-group")).toHaveLength(3);
  expect(summaryOf(groupOf(container, 2))).toMatch(/Landing failed$/u);
});
