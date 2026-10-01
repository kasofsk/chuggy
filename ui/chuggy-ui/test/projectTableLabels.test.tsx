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
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import {
  cellExecutionUnread,
  TicketRowExecutionCell,
} from "../app/browser/TicketCells.tsx";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Local components, because the hover clock reads in the browser's own zone. */
const changedAt = new Date(2026, 7, 27, 0, 0);
const fixedNowMs = changedAt.getTime() + 3_600_000 * 3;

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => fixedNowMs,
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end

/**
 * The one annotation that still clips — runs on, whose digest reference is not
 * the ticket's own words — on the two things `projectTableRows.ts` cannot say
 * about it: that the whole value is on the chip, and that the chip still clips.
 *
 * Both are properties of the markup and of nothing else. `title` dropped there
 * loses the image with no way back to it, and `max-w-aside` dropped lets a
 * value the length of a full digest reference take the card apart. Neither
 * shows up in the row's own value, so neither is provable above this tier.
 *
 * The title is the opposite property, now that it fills the card: that it
 * wraps whole rather than clipping is markup too, and is asserted the same
 * way, on the same tier.
 *
 * The last activity annotation is the same tier for a different reason: that
 * it draws the relative reading and carries the absolute one on hover is a
 * fact about `Figure`'s tooltip, not about `activityAt` itself.
 */

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const image =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

const title =
  "Serve the escalation reason on the ticket resource, and on the table beside it";

const ticket = {
  ticket: 11,
  title,
  phase: "Work",
  sequence: 7,
  ...ticketInstants,
  changedAt: changedAt.toISOString(),
};

const execution = {
  execution: "e1",
  ticket: 11,
  task: 1,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 11, cycle: 1 } },
  cluster: "rig",
  configurationRevision: revision,
  configurationVersion: { name: "chuggy", number: 12 },
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image,
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  worker: { name: "chuggy-worker", version: "v3" },
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
};

const escalated = {
  ticket: 12,
  title: "Escalated ticket",
  phase: "Escalated",
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  sequence: 3,
  ...ticketInstants,
};

/** The table drawn from whatever tickets and executions a case wants. */
async function drawTableWith(
  tickets: readonly unknown[],
  executions: readonly unknown[],
): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/executions")) return answer({ executions });
      const phases = new URL(url, "http://stub").searchParams.getAll("phase");
      return answer({
        partition: atlas,
        sequence: 8,
        tickets: tickets.filter(
          (one) =>
            phases.length === 0 ||
            phases.includes((one as { readonly phase: string }).phase),
        ),
      });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <ProjectTable />
    </ScreenHarness>,
  );
  await settled();
}

/** The table with one running ticket, joined to the execution above. */
async function drawTable(): Promise<void> {
  return drawTableWith([ticket], [execution]);
}

test("the title is on the card whole and unclipped, links, and leads the ticket number", async () => {
  await drawTable();
  const titleAnchor = screen.getByText(title);
  expect(titleAnchor.tagName).toBe("A");
  expect(titleAnchor.className).not.toContain("truncate");
  expect(titleAnchor.className).not.toContain("max-w-aside");
  expect(titleAnchor.className).not.toContain("whitespace-nowrap");

  const numberLink = screen.getByRole("link", { name: "11" });
  expect(
    titleAnchor.compareDocumentPosition(numberLink) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.focus(titleAnchor);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a row's phase, execution, runs-on and activity annotations are all on the one card its title heads", async () => {
  await drawTable();
  expect(document.querySelectorAll("table").length).toBe(0);
  expect(document.querySelectorAll("th").length).toBe(0);

  const titleAnchor = screen.getByText(title);
  const card = titleAnchor.closest("li");
  if (card === null) throw new Error("no card around the title");

  expect(card.contains(screen.getByText("Working"))).toBe(true);
  expect(card.contains(screen.getByText("Running"))).toBe(true);
  expect(card.contains(screen.getByText("chuggy-worker v3"))).toBe(true);
  expect(card.contains(screen.getByText("3h ago"))).toBe(true);
});

test("a row draws its phase as a chip", async () => {
  await drawTable();
  const chip = screen.getByText("Working");
  expect(chip.className).toContain("pill-live");
});

test("an escalated row answers its kind on the phase chip's hover", async () => {
  await drawTableWith([escalated], []);
  const trigger = screen.getByText("Escalated").closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Escalated");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe("work failed");
});

test("a row whose index was truncated draws no chip for its execution", () => {
  const row: ProjectTableRow = {
    ticket: 9,
    title: undefined,
    phase: "Work",
    section: "InProgress",
    badge: undefined,
    executionRead: "IndexTruncated",
    executionStatus: undefined,
    executionOutcome: undefined,
    runsOn: undefined,
    activityAt: "2026-08-26T00:00:00Z",
  };
  render(<TicketRowExecutionCell row={row} />);
  expect(screen.getByText(cellExecutionUnread)).toBeDefined();
  expect(document.querySelector(".pill")).toBeNull();
});

test("the last activity column draws the relative reading and answers the absolute on hover", async () => {
  await drawTable();
  const cell = screen.getByText("3h ago");
  fireEvent.focus(cell);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "2026-08-27 00:00",
  );
});

test("the runs-on cell keeps the image reference, and keeps clipping it", async () => {
  await drawTable();
  const cell = screen.getByText("chuggy-worker v3");
  expect(cell.className).toContain("max-w-aside");
  fireEvent.focus(cell);
  expect((await screen.findByRole("tooltip")).textContent).toBe(image);
});

/** The served policy refuses `style-src` but `'self'`, so nothing this table
 * draws — a tooltip open included — may append a runtime style element. */
test("nothing the project table draws is a runtime style element", async () => {
  await drawTable();
  expect(document.querySelectorAll("style").length).toBe(0);
  fireEvent.focus(screen.getByText("chuggy-worker v3"));
  await screen.findByRole("tooltip");
  expect(document.querySelectorAll("style").length).toBe(0);
});

/** A project with no ticket at all is one empty state offering the first,
 * rather than five sections each saying so under a clock of its own. */
test("a project with no ticket draws one empty state that offers a new one", async () => {
  await drawTableWith([], []);
  expect(screen.getByRole("heading", { name: "No tickets" })).toBeDefined();
  const offer = screen.getByText("New ticket");
  expect(offer.tagName).toBe("A");
  expect(offer.closest(".empty")).not.toBeNull();
  expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
  expect(screen.queryByRole("group", { name: "phase" })).toBeNull();
});

function sectionHeadings(): readonly (string | null)[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
}

test("the unfiltered view draws only the sections holding a ticket", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  expect(sectionHeadings()).toEqual(["Needs you", "In progress"]);
  expect(screen.queryByText("None")).toBeNull();
  expect(screen.queryByRole("heading", { name: "No tickets" })).toBeNull();
});

test("every filter is named with its section's capitalised heading", async () => {
  await drawTable();
  expect(
    within(screen.getByRole("group", { name: "phase" }))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    "All",
    "Needs you",
    "In progress",
    "Up next",
    "Done",
    "Failed or revoked",
  ]);
});

/** A caption dates the rows under it, so a section with none carries none. */
test("a filtered view whose section holds no ticket says None, under no caption", async () => {
  await drawTable();
  const working = screen.getByRole("region", { name: "In progress" });
  expect(working.querySelector(".freshness")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await settled();
  expect(sectionHeadings()).toEqual(["Done"]);
  const done = screen.getByRole("region", { name: "Done" });
  expect(within(done).getByText("None")).toBeDefined();
  expect(done.querySelector(".freshness")).toBeNull();
});

const finished = {
  ticket: 13,
  title: "Finished ticket",
  phase: "Done",
  sequence: 5,
  ...ticketInstants,
};

const passed = {
  ...execution,
  execution: "e3",
  ticket: 13,
  identity: { type: "WorkTask", value: { ticket: 13, cycle: 1 } },
  status: "Terminal",
  outcome: "Passed",
  terminalAt: "2026-08-26T11:00:00.000Z",
};

test("a finished row says how its run ended, and never Terminal", async () => {
  await drawTableWith([finished], [passed]);
  const done = screen.getByRole("region", { name: "Done" });
  expect(within(done).getByText("Passed").className).toContain("pill-pass");
  expect(document.body.textContent).not.toContain("Terminal");
});
