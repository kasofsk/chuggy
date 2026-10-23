/**
 * The ticket list as drawn: the properties of the markup that
 * `ticketListView.ts` and `projectTableRows.ts` cannot say.
 *
 * The one annotation that clips is runs on, whose digest reference is not the
 * ticket's own words: the whole value is on hover and the sheet clips it, and
 * neither shows up in the row's own value. The title is clamped by the sheet
 * and drawn whole in the markup. The last activity reading carries the
 * absolute instant on hover, which is a fact about `Figure`'s tooltip.
 *
 * The order the list draws, the filter a kept word reads as, and what is held
 * back are here too: the selection is proved in the core, and only a drawn
 * list proves the screen draws it.
 */

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
import {
  ticketDispatchViewOf,
  ticketPageCandidate,
} from "./ticketPageFixture.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
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
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const revision = "repository:cfaca0a0f14ec03845a4e01458ac6c3a56d52a23:chuggy";

const image =
  "registry.chuggy.internal/chuggy/worker@sha256:9949c442a2f0a5cd0f0a5b1c8b6e0a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

const title =
  "Serve the escalation reason on the ticket resource, and on the table beside it";

const creator = "23:https://issuer.example/alice";

const ticket = {
  ticket: 11,
  title,
  creator,
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

/** The table drawn from whatever tickets and executions a case wants, the
 * abilities read answering as the tickets do unless the case hands a `fetch`
 * of its own over them. */
async function drawTableWith(
  tickets: readonly unknown[],
  executions: readonly unknown[],
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/executions")) return answer({ executions });
      if (url.includes("/dispatch-view"))
        return answer(
          ticketDispatchViewOf(
            atlas,
            tickets.flatMap((one) => {
              const held = one as {
                readonly ticket: number;
                readonly phase: string;
                readonly openDependencies?: readonly unknown[];
              };
              return held.phase === "Pending" &&
                (held.openDependencies ?? []).length === 0
                ? [{ ...ticketPageCandidate, ticket: held.ticket }]
                : [];
            }),
          ),
        );
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
  vi.stubGlobal("fetch", over(api.fetch));
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

test("the title heads its row in the list's title, which the sheet clamps", async () => {
  await drawTable();
  const drawn = screen.getByText(title).closest(".ticket-list-title");
  expect(drawn?.tagName).toBe("H3");
  expect(drawn?.textContent).toBe(title);
});

test("a row's state, execution, runs-on and activity annotations are all on the one row its title heads", async () => {
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

test("a row names the member who filed it by subject where no email is read, the whole principal on hover, and a row with none names nobody", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  const filed = screen.getByText("alice");
  expect(screen.getByText(title).closest("li")?.contains(filed)).toBe(true);
  fireEvent.focus(filed);
  expect((await screen.findByRole("tooltip")).textContent).toBe(creator);
  const unfiled = screen.getByText("Escalated ticket").closest("li");
  expect(unfiled?.querySelector(".identity")).toBeNull();
});

/** The people read answering, which the case above leaves unanswered. */
test("a row names its creator by the email the project's people hold for them", async () => {
  await drawTableWith(
    [ticket],
    [execution],
    (served) =>
      ((url: string, init?: RequestInit) =>
        url.endsWith("/people")
          ? Promise.resolve(
              answer({
                tenant: atlas.tenant,
                project: atlas.project,
                people: [
                  {
                    subject: "alice",
                    mine: false,
                    tenantAdmin: false,
                    roles: [],
                    email: "alice@example.com",
                  },
                ],
                otherIssuers: 0,
                truncated: false,
              }),
            )
          : served(url, init)) as typeof fetch,
  );
  const filed = await screen.findByText("alice@example.com");
  expect(screen.getByText(title).closest("li")?.contains(filed)).toBe(true);
});

test("a row draws its state as a chip in its phase's tone", async () => {
  await drawTable();
  const chip = screen.getByText("Working");
  expect(chip.className).toBe("ticket-list-state");
  expect(chip.dataset["tone"]).toBe("live");
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
    creator: undefined,
    phase: "Work",
    badge: undefined,
    executionRead: "IndexTruncated",
    executionStatus: undefined,
    executionOutcome: undefined,
    runsOn: undefined,
    activityAt: "2026-08-26T00:00:00Z",
    openDependencies: [],
    revokedDependencies: [],
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
  expect(cell.className).toBe("ticket-list-runs-on");
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
 * with no section and no filter to choose between. */
test("a project with no ticket draws one empty state that offers a new one", async () => {
  await drawTableWith([], []);
  expect(screen.getByRole("heading", { name: "No tickets" })).toBeDefined();
  const offer = screen.getByText("New ticket");
  expect(offer.tagName).toBe("A");
  expect(offer.closest(".empty")).not.toBeNull();
  expect(screen.queryByRole("list", { name: "Tickets" })).toBeNull();
  expect(screen.queryByLabelText("Search tickets")).toBeNull();
});

/** The titles the list draws, in the order it draws them. */
function titlesDrawn(): readonly (string | null)[] {
  return within(screen.getByRole("list", { name: "Tickets" }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector("h3")?.textContent ?? null);
}

test("the rows are one list under one set of controls, with no section", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
  expect(screen.getByLabelText("Search tickets")).toBeDefined();
  expect(titlesDrawn()).toEqual(["Escalated ticket", title]);
});

test("a filter the browser kept is the phase the read asks for", async () => {
  localStorage.setItem("chug.ticket-list.filter", "Escalated");
  await drawTableWith([ticket, escalated], [execution]);
  expect(titlesDrawn()).toEqual(["Escalated ticket"]);
});

test("a kept word that names no phase is the unfiltered read", async () => {
  localStorage.setItem("chug.ticket-list.filter", "NeedsYou");
  await drawTableWith([ticket, escalated], [execution]);
  expect(titlesDrawn()).toEqual(["Escalated ticket", title]);
});

test("a search keeps the rows whose title or number it names, and says how many", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  fireEvent.change(screen.getByLabelText("Search tickets"), {
    target: { value: "escalated" },
  });
  expect(titlesDrawn()).toEqual(["Escalated ticket"]);
  expect(screen.getByRole("status").textContent).toBe("1 matching ticket");
  fireEvent.change(screen.getByLabelText("Search tickets"), {
    target: { value: "#11" },
  });
  expect(titlesDrawn()).toEqual([title]);
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
  expect(screen.getByText("Passed").className).toContain("pill-pass");
  expect(document.body.textContent).not.toContain("Terminal");
});

function newTicketOffers(): number {
  return screen.queryAllByText("New ticket").length;
}

test("a reader who may not mutate is offered no new ticket in the empty state", async () => {
  await drawTableWith(
    [],
    [],
    abilitiesOver({ ...abilitiesEvery, mutate: false }),
  );
  expect(screen.getByRole("heading", { name: "No tickets" })).toBeDefined();
  expect(newTicketOffers()).toBe(0);
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered a new ticket in the empty state, and never above the list",
  async (_said, abilities) => {
    const over = abilitiesOver(abilities);
    await drawTableWith([], [], over);
    expect(newTicketOffers()).toBe(1);
    cleanup();
    await drawTableWith([ticket], [execution], over);
    expect(newTicketOffers()).toBe(0);
  },
);

function pending(
  number: number,
  openDependencies: readonly unknown[],
  revokedDependencies: readonly number[] = [],
): unknown {
  return {
    ticket: number,
    title: `Pending ${String(number)}`,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    openDependencies,
    revokedDependencies,
  };
}

/** Served in the reverse of the order they are drawn in. */
test("pending rows are drawn nearest to dispatchable first, ready ones as Ready", async () => {
  await drawTableWith(
    [
      pending(21, [], [12]),
      pending(22, [{ ticket: 23, phase: "Pending" }]),
      pending(23, [{ ticket: 11, phase: "Work" }]),
      pending(24, []),
      ticket,
    ],
    [execution],
  );
  expect(titlesDrawn()).toEqual([
    title,
    "Pending 24",
    "Pending 23",
    "Pending 22",
    "Pending 21",
  ]);
  expect(
    screen.getAllByText(/^(Ready|Blocked)$/u).map((chip) => chip.textContent),
  ).toEqual(["Ready", "Blocked", "Blocked", "Blocked"]);
});

/** The state sort leads with what needs a person and ends with what stopped,
 * whatever order the read serves them in. */
test("the state sort draws what needs you, then what moves, then what waits, then what finished", async () => {
  await drawTableWith(
    [
      { ...finished, ticket: 17, title: "Revoked", phase: "Revoked" },
      finished,
      pending(24, []),
      ticket,
      escalated,
    ],
    [execution],
  );
  expect(titlesDrawn()).toEqual([
    "Escalated ticket",
    title,
    "Pending 24",
    "Finished ticket",
    "Revoked",
  ]);
});

/** Finished more than a day before the clock, so held back until asked for. */
test("a row that finished long ago is held back behind Show more", async () => {
  const long = {
    ...finished,
    ticket: 19,
    title: "Finished long ago",
    changedAt: "2026-08-01T00:00:00Z",
  };
  await drawTableWith([ticket, long], [execution]);
  expect(titlesDrawn()).toEqual([title]);
  fireEvent.click(screen.getByRole("button", { name: "Show more (1 older)" }));
  expect(titlesDrawn()).toEqual([title, "Finished long ago"]);
});

test("a ready row's chip is the dispatch, and no row offers resume or revoke", async () => {
  await drawTableWith([escalated, pending(24, [])], []);
  const parked = screen.getByText("Escalated ticket").closest("li");
  expect(parked?.querySelector("button")).toBeNull();
  const ready = await screen.findByRole("button", {
    name: "Dispatch ticket #24",
  });
  expect(ready.textContent).toBe("Ready");
  expect(ready.className).toBe("ticket-list-state");
});

test("a reader who may not dispatch sees a ready row's chip, not a button", async () => {
  await drawTableWith(
    [pending(24, [])],
    [],
    abilitiesOver({ ...abilitiesEvery, dispatch: false }),
  );
  expect(screen.getByText("Ready").tagName).toBe("SPAN");
  expect(screen.queryByRole("button", { name: /^Dispatch/u })).toBeNull();
});
