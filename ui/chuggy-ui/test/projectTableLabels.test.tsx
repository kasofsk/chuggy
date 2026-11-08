/**
 * The ticket list as drawn: the properties of the markup that
 * `ticketListView.ts` and `projectTableRows.ts` cannot say.
 *
 * The title is clamped by the sheet and drawn whole in the markup. The last
 * activity reading carries the absolute instant on hover, which is a fact
 * about `Figure`'s tooltip.
 *
 * The order the list draws and the filter a kept word reads as are here too:
 * the selection is proved in the core, and only a drawn list proves the screen
 * draws it.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  executionSummarySchema,
  ticketLatestExecutionSchema,
} from "../../../src/contract/responses.ts";
import { ProjectTable } from "../app/browser/ProjectTable.tsx";
import type { TicketListQuery } from "../app/core/ticketListView.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import listSheet from "../app/browser/ProjectTable.css?raw";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  repositoryImportListedOver,
  repositoryImportListingReachUnasked,
  repositoryImportRefusedBinding,
} from "./repositoryImportFixture.ts";

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
  executionsAsked.length = 0;
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

const repository = "https://github.com/acme/widgets.git";

const ticket = {
  ticket: 11,
  title,
  repository,
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

/** Every executions read the table issued, which it issues none of. */
const executionsAsked: string[] = [];

/** Each ticket as the tickets list carries it: with the latest of the
 * executions a case names for it, where it names any. */
function ticketsCarrying(
  tickets: readonly unknown[],
  executions: readonly unknown[],
): readonly unknown[] {
  return tickets.map((one) => {
    const number = (one as { readonly ticket: number }).ticket;
    const latest = executions
      .map((each) => executionSummarySchema.parse(each))
      .filter((each) => each.ticket === number)
      .sort((a, b) => b.task - a.task)[0];
    return latest === undefined
      ? one
      : {
          ...(one as object),
          latestExecution: ticketLatestExecutionSchema.parse(latest),
        };
  });
}

/** The table under an address it writes, as the route holds it. */
function ProjectTableAddressed(): ReactNode {
  const [query, setQuery] = useState<TicketListQuery>({});
  return <ProjectTable query={query} onQuery={setQuery} />;
}

/** The table drawn from whatever tickets and executions a case wants, the
 * abilities read answering as the tickets do unless the case hands a `fetch`
 * of its own over them. */
async function drawTableWith(
  tickets: readonly unknown[],
  executions: readonly unknown[],
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<void> {
  const carrying = ticketsCarrying(tickets, executions);
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      if (url.includes("/executions")) {
        executionsAsked.push(url);
        return answer({ executions });
      }
      const phases = new URL(url, "http://stub").searchParams.getAll("phase");
      return answer({
        partition: atlas,
        sequence: 8,
        tickets: carrying.filter(
          (one) =>
            phases.length === 0 ||
            phases.includes((one as { readonly phase: string }).phase),
        ),
      });
    },
  });
  vi.stubGlobal("fetch", over(api.fetch));
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <ProjectTableAddressed />
    </ScreenHarness>,
  );
  await settled();
}

/** The table with one running ticket, joined to the execution above. */
async function drawTable(): Promise<void> {
  return drawTableWith([ticket], [execution]);
}

/** The list of rows, apart from the counts above it, which name the same
 * states. */
function rowsDrawn(): HTMLElement {
  return screen.getByRole("list", { name: "Tickets" });
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

test("a row's state and activity annotations are on the one row its title heads, and no execution is", async () => {
  await drawTable();
  expect(document.querySelectorAll("table").length).toBe(0);
  expect(document.querySelectorAll("th").length).toBe(0);

  const titleAnchor = screen.getByText(title);
  const card = titleAnchor.closest("li");
  if (card === null) throw new Error("no card around the title");

  expect(within(card).getByText("Working")).toBeDefined();
  expect(within(card).getByText("3h ago")).toBeDefined();
  expect(within(card).queryByText("Running")).toBeNull();
  expect(within(card).queryByText("chuggy-worker v3")).toBeNull();
});

/** The creator as each layout draws it: in the meta where wide, at the start
 * of the foot where narrow. */
const creatorPlaces = [".ticket-list-creator", ".ticket-list-foot-creator"];

/** The text each place a row draws its creator holds. */
function creatorsDrawn(card: Element | null): readonly (string | null)[] {
  return creatorPlaces.map(
    (place) => card?.querySelector(`${place} .identity`)?.textContent ?? null,
  );
}

test("a row names the member who filed it by subject where no email is read, the whole principal on hover, and a row with none names nobody", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  const card = screen.getByText(title).closest("li");
  expect(creatorsDrawn(card)).toEqual(["alice", "alice"]);
  const [filed] = within(card as HTMLElement).getAllByText("alice");
  if (filed === undefined) throw new Error("no creator on the row");
  fireEvent.focus(filed);
  expect((await screen.findByRole("tooltip")).textContent).toBe(creator);
  const unfiled = screen.getByText("Escalated ticket").closest("li");
  expect(unfiled?.querySelector(".identity")).toBeNull();
});

const wideCondition = "(min-width: 53em)";
const narrowCondition = "(max-width: 53em)";

/** Which of a row's creator places the sheet shows under the conditions. */
function creatorPlacesShown(conditions: readonly string[]): readonly string[] {
  const rules = sheetRules(listSheet, conditions);
  return creatorPlaces.filter((place) => {
    const drawn = document.createElement("span");
    drawn.className = place.slice(1);
    return sheetDeclared(rules, drawn, "display") !== "none";
  });
}

test.each([
  ["wide", [wideCondition], [".ticket-list-creator"]],
  ["narrow", [narrowCondition], [".ticket-list-foot-creator"]],
  [
    "on a phone",
    [narrowCondition, sheetNarrowCondition],
    [".ticket-list-foot-creator"],
  ],
] as const)(
  "%s, the sheet shows a row's creator in exactly one place",
  (_width, conditions, shown) => {
    expect(creatorPlacesShown(conditions)).toEqual(shown);
  },
);

test("a row names its repository by owner and name, the whole address on hover, and a row with none names no repository", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  const named = screen.getByText("acme/widgets");
  expect(named.className).toBe("ticket-list-repository");
  expect(screen.getByText(title).closest("li")?.contains(named)).toBe(true);
  fireEvent.focus(named);
  expect((await screen.findByRole("tooltip")).textContent).toBe(repository);
  const unnamed = screen.getByText("Escalated ticket").closest("li");
  expect(unnamed?.querySelector(".ticket-list-repository")).toBeNull();
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
  await screen.findAllByText("alice@example.com");
  expect(creatorsDrawn(screen.getByText(title).closest("li"))).toEqual([
    "alice@example.com",
    "alice@example.com",
  ]);
});

test("a row draws its state as the small state label, in its phase's tone", async () => {
  await drawTable();
  const label = within(rowsDrawn())
    .getByText("Working")
    .closest<HTMLElement>(".ticket-state");
  expect(label?.parentElement?.className).toBe("ticket-list-standing");
  expect(label?.dataset["size"]).toBe("small");
  expect(label?.dataset["tone"]).toBe("live");
});

test("a ready row's label is tinted and a done row's filled, each with its own mark", async () => {
  await drawTableWith([finished, pending(24, [])], []);
  const labelOf = (word: string): HTMLElement | null =>
    within(rowsDrawn()).getByText(word).closest<HTMLElement>(".ticket-state");
  const ready = labelOf("Ready");
  const done = labelOf("Done");
  expect(ready?.dataset["form"]).toBe("tinted");
  expect(done?.dataset["form"]).toBe("filled");
  expect(ready?.querySelector("svg")?.innerHTML).not.toBe(
    done?.querySelector("svg")?.innerHTML,
  );
});

test("an escalated row answers its kind on the phase chip's hover", async () => {
  await drawTableWith([escalated], []);
  const trigger = within(rowsDrawn())
    .getByText("Escalated")
    .closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Escalated");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe("Work failed");
});

test("opening the list issues no executions read, and no sentence names a page budget", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  expect(screen.getByText("Escalated ticket")).toBeDefined();
  expect(executionsAsked).toStrictEqual([]);
  expect(document.body.textContent).not.toContain("not read");
  expect(document.body.textContent).not.toContain("page budget");
});

test("the last activity column draws the relative reading and answers the absolute on hover", async () => {
  await drawTable();
  const cell = screen.getByText("3h ago");
  fireEvent.focus(cell);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "2026-08-27 00:00",
  );
});

/** The served policy refuses `style-src` but `'self'`, so nothing this table
 * draws — a tooltip open included — may append a runtime style element. */
test("nothing the project table draws is a runtime style element", async () => {
  await drawTable();
  expect(document.querySelectorAll("style").length).toBe(0);
  fireEvent.focus(screen.getByText("acme/widgets"));
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
  expect(screen.getByRole("button", { name: "Search tickets" })).toBeDefined();
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

const finished = {
  ticket: 13,
  title: "Finished ticket",
  phase: "Done",
  sequence: 5,
  ...ticketInstants,
};

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
    within(rowsDrawn())
      .getAllByText(/^(Ready|Blocked)$/u)
      .map((chip) => chip.textContent),
  ).toEqual(["Ready", "Blocked", "Blocked", "Blocked"]);
});

test("the counts above the list name each unfinished state the rows stand in, in order, and no finished one", async () => {
  await drawTableWith(
    [
      finished,
      escalated,
      ticket,
      pending(23, [{ ticket: 11, phase: "Work" }]),
      pending(24, []),
      pending(25, []),
    ],
    [execution],
  );
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  expect(
    within(counts)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Blocked1", "Ready2", "Working1", "Escalated1"]);
});

/** Each dependency chip of the row that waits on it, by the number it shows. */
function dependencyChips(waiting: string): ReadonlyMap<string, string> {
  const row = screen.getByText(waiting).closest("li");
  return new Map(
    [...(row?.querySelectorAll<HTMLElement>(".ticket-dependency") ?? [])].map(
      (chip) => [chip.textContent, chip.dataset["standing"] ?? ""] as const,
    ),
  );
}

test("a pending dependency reads Ready or Blocked from the rows the list holds, and Blocked where it holds none", async () => {
  await drawTableWith(
    [
      ticket,
      pending(23, [{ ticket: 11, phase: "Work" }]),
      pending(24, []),
      pending(
        26,
        [
          { ticket: 23, phase: "Pending" },
          { ticket: 24, phase: "Pending" },
          { ticket: 99, phase: "Pending" },
          { ticket: 11, phase: "Work" },
        ],
        [12],
      ),
    ],
    [execution],
  );
  expect(dependencyChips("Pending 26")).toStrictEqual(
    new Map([
      ["#23", "Blocked"],
      ["#24", "Ready"],
      ["#99", "Blocked"],
      ["#11", "Work"],
      ["#12", "Revoked"],
    ]),
  );
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

test("a ready row's chip is the dispatch, and no row offers resume or revoke", async () => {
  await drawTableWith([escalated, pending(24, [])], []);
  const parked = screen.getByText("Escalated ticket").closest("li");
  expect(parked?.querySelector("button")).toBeNull();
  const ready = await screen.findByRole("button", {
    name: "Dispatch ticket #24",
  });
  expect(ready.textContent).toBe("Ready");
  expect(ready.className).toBe("ticket-list-standing");
  expect(ready.firstElementChild?.className).toBe("ticket-state");
});

test("a reader who may not dispatch sees a ready row's chip, not a button", async () => {
  await drawTableWith(
    [pending(24, [])],
    [],
    abilitiesOver({ ...abilitiesEvery, dispatch: false }),
  );
  expect(within(rowsDrawn()).getByText("Ready").closest("button")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Dispatch/u })).toBeNull();
});

test("a live binding whose newest import was refused raises one notice over the tickets, linking to it", async () => {
  await drawTableWith(
    [ticket],
    [execution],
    repositoryImportListedOver([
      repositoryImportRefusedBinding(repository),
      repositoryImportRefusedBinding(
        "https://github.com/acme/gears.git",
        "2026-10-18T00:00:00Z",
      ),
    ]),
  );
  expect(screen.getByText(/^Import refused/u).textContent).toBe(
    "Import refused · acme/widgets",
  );
  expect(screen.getByRole("link", { name: "acme/widgets" })).toBeDefined();
});

/** What the worker App reaches is the forge's to answer, and only the
 * Repositories page draws it, so the tickets and their notice ask it nothing. */
test("the tickets and their notice read the project's bindings only without reach", async () => {
  const asked = new Set<string>();
  const listed = repositoryImportListedOver([
    repositoryImportRefusedBinding(repository),
  ]);
  await drawTableWith([ticket], [execution], (served) => {
    const over = listed(served);
    return ((url: string, init?: RequestInit) => {
      if (url.includes("/repositories")) asked.add(url);
      return over(url, init);
    }) as typeof fetch;
  });
  expect(screen.getByText(/^Import refused/u)).toBeDefined();
  expect([...asked]).toStrictEqual([
    `/api/v1/tenants/${atlas.tenant}/projects/${atlas.project}${repositoryImportListingReachUnasked}`,
  ]);
});

test("a project with no tickets still carries the notice of a refused import", async () => {
  await drawTableWith(
    [],
    [],
    repositoryImportListedOver([repositoryImportRefusedBinding(repository)]),
  );
  expect(screen.getByText("No tickets")).toBeDefined();
  expect(screen.getByText(/^Import refused/u).textContent).toBe(
    "Import refused · acme/widgets",
  );
});

/** Each count above the list, by what it says, with whether it is pressed
 * or dimmed. */
function countsDrawn(): readonly string[] {
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  return within(counts)
    .getAllByRole("button")
    .map(
      (count) =>
        `${count.textContent ?? ""}${count.getAttribute("aria-pressed") === "true" ? " pressed" : ""}${count.hasAttribute("data-dimmed") ? " dimmed" : ""}`,
    );
}

async function countTapped(standing: RegExp): Promise<void> {
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  fireEvent.click(within(counts).getByRole("button", { name: standing }));
  await settled();
}

function filterDrawn(): string | null {
  return screen.getByRole("button", { name: /^Filter/u }).textContent;
}

async function filterChosen(choice: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Filter/u }), {
    key: "ArrowDown",
  });
  await settled();
  fireEvent.click(screen.getByRole("menuitemradio", { name: choice }));
  await settled();
}

const countedTickets = [
  ticket,
  escalated,
  pending(23, [{ ticket: 11, phase: "Work" }]),
  pending(24, []),
  pending(25, []),
  pending(26, [], [9]),
];

test("a state's count filters the list to that state and is pressed, every other count still drawn dimmed, and tapped again draws every ticket", async () => {
  await drawTableWith(countedTickets, [execution]);
  expect(countsDrawn()).toEqual([
    "Blocked2",
    "Ready2",
    "Working1",
    "Escalated1",
  ]);
  await countTapped(/^Working/u);
  expect(titlesDrawn()).toEqual([title]);
  expect(countsDrawn()).toEqual([
    "Blocked2 dimmed",
    "Ready2 dimmed",
    "Working1 pressed",
    "Escalated1 dimmed",
  ]);
  expect(filterDrawn()).toContain("Working");
  await countTapped(/^Working/u);
  expect(titlesDrawn()).toHaveLength(countedTickets.length);
  expect(countsDrawn()).toEqual([
    "Blocked2",
    "Ready2",
    "Working1",
    "Escalated1",
  ]);
  expect(filterDrawn()).toContain("All states");
  expect(localStorage.getItem("chug.ticket-list.filter")).toBe("All");
});

test("Ready and Blocked each filter the list to the pending tickets of their own standing", async () => {
  await drawTableWith(countedTickets, [execution]);
  await countTapped(/^Ready/u);
  expect(titlesDrawn()).toEqual(["Pending 25", "Pending 24"]);
  expect(countsDrawn()).toEqual([
    "Blocked2 dimmed",
    "Ready2 pressed",
    "Working1 dimmed",
    "Escalated1 dimmed",
  ]);
  expect(filterDrawn()).toContain("Ready");
  await countTapped(/^Ready/u);
  await countTapped(/^Blocked/u);
  expect(titlesDrawn()).toEqual(["Pending 23", "Pending 26"]);
  expect(countsDrawn()).toEqual([
    "Blocked2 pressed",
    "Ready2 dimmed",
    "Working1 dimmed",
    "Escalated1 dimmed",
  ]);
  expect(filterDrawn()).toContain("Blocked");
});

test("a dimmed count tapped moves the filter to its state, and the counts stay those of every ticket", async () => {
  await drawTableWith(countedTickets, [execution]);
  await countTapped(/^Working/u);
  await countTapped(/^Escalated/u);
  expect(titlesDrawn()).toEqual(["Escalated ticket"]);
  expect(countsDrawn()).toEqual([
    "Blocked2 dimmed",
    "Ready2 dimmed",
    "Working1 dimmed",
    "Escalated1 pressed",
  ]);
  expect(filterDrawn()).toContain("Escalated");
});

test("the Filter picker and the counts are one filter, each drawing what the other chose", async () => {
  await drawTableWith(countedTickets, [execution]);
  await filterChosen("Blocked");
  expect(countsDrawn()).toEqual([
    "Blocked2 pressed",
    "Ready2 dimmed",
    "Working1 dimmed",
    "Escalated1 dimmed",
  ]);
  await filterChosen("Pending");
  expect(countsDrawn()).toEqual([
    "Blocked2",
    "Ready2",
    "Working1 dimmed",
    "Escalated1 dimmed",
  ]);
  await countTapped(/^Ready/u);
  expect(filterDrawn()).toContain("Ready");
  await filterChosen("Escalated");
  expect(countsDrawn()).toEqual([
    "Blocked2 dimmed",
    "Ready2 dimmed",
    "Working1 dimmed",
    "Escalated1 pressed",
  ]);
  await filterChosen("All states");
  expect(countsDrawn()).toEqual([
    "Blocked2",
    "Ready2",
    "Working1",
    "Escalated1",
  ]);
});

/** What the list's sheet gives a count for its shadow while a keyboard focuses
 * it. Whether jsdom counts a focus as a keyboard's depends on what an earlier
 * case pressed, so the focus is named by an attribute the sheet is read with. */
function countFocusedShadow(count: Element): string {
  const focused = "data-keyboard-focused";
  const rules = sheetRules(
    listSheet.replaceAll(":focus-visible", `[${focused}]`),
    [],
  );
  const held = count.cloneNode() as Element;
  held.setAttribute(focused, "");
  return sheetDeclared(rules, held, "box-shadow");
}

test("a dimmed count is faded, and still a button that can be pressed", async () => {
  await drawTableWith(countedTickets, [execution]);
  await countTapped(/^Working/u);
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  const rules = sheetRules(listSheet, []);
  const faded = (count: HTMLElement): string =>
    sheetDeclared(rules, count.firstElementChild as Element, "opacity");
  const ready = within(counts).getByRole<HTMLButtonElement>("button", {
    name: /^Ready/u,
  });
  const working = within(counts).getByRole<HTMLButtonElement>("button", {
    name: /^Working/u,
  });
  expect(ready.disabled).toBe(false);
  expect(Number(faded(ready))).toBeLessThan(1);
  expect(faded(working)).toBe("");
});

test("a count a keyboard focuses is ringed, pressed or not", async () => {
  await drawTableWith(countedTickets, [execution]);
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  const working = (): Element =>
    within(counts).getByRole("button", { name: /^Working/u });
  expect(countFocusedShadow(working())).toBe("var(--ring-focus)");
  await countTapped(/^Working/u);
  expect(working().getAttribute("aria-pressed")).toBe("true");
  expect(countFocusedShadow(working())).toContain("var(--ring-focus)");
});

test("on a phone a count shows only its number, its label's mark and word hidden", async () => {
  await drawTableWith(countedTickets, [execution]);
  const counts = screen.getByRole("list", { name: "Tickets by state" });
  const working = within(counts).getByRole("button", { name: /^Working/u });
  const rules = sheetRules(listSheet, [sheetNarrowCondition]);
  const shown = (selector: string): boolean =>
    sheetDeclared(
      rules,
      working.querySelector(selector) as Element,
      "display",
    ) !== "none";
  expect(shown(".ticket-state-mark")).toBe(false);
  expect(shown(".ticket-state-word")).toBe(false);
  expect(shown(".num")).toBe(true);
});
