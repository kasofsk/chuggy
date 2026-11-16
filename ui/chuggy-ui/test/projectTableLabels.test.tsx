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
 * draws it. So is the bar: the search, one Filter control holding each filter
 * once, and the sort, with a mark under it for each filter on.
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
import filterSheet from "../app/browser/ui/ListFilter.css?raw";
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
  addressesWritten.length = 0;
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

/** Every address the table wrote, in order. */
const addressesWritten: TicketListQuery[] = [];

/** The table under an address it writes, as the route holds it. */
function ProjectTableAddressed(props: {
  readonly initial: TicketListQuery;
}): ReactNode {
  const [query, setQuery] = useState<TicketListQuery>(props.initial);
  return (
    <ProjectTable
      query={query}
      onQuery={(next) => {
        addressesWritten.push(next);
        setQuery(next);
      }}
    />
  );
}

/** The table drawn from whatever tickets and executions a case wants, the
 * abilities read answering as the tickets do unless the case hands a `fetch`
 * of its own over them. */
async function drawTableWith(
  tickets: readonly unknown[],
  executions: readonly unknown[],
  over: (served: typeof fetch) => typeof fetch = (served) => served,
  initial: TicketListQuery = {},
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
      <ProjectTableAddressed initial={initial} />
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

test("the title is on the card whole and unclipped, is the row's one link, and leads the ticket number", async () => {
  await drawTable();
  const titleAnchor = screen.getByText(title).closest("a");
  if (titleAnchor === null) throw new Error("no link around the title");
  expect(titleAnchor.className).not.toContain("truncate");
  expect(titleAnchor.className).not.toContain("max-w-aside");
  expect(titleAnchor.className).not.toContain("whitespace-nowrap");

  const card = titleAnchor.closest("li");
  if (card === null) throw new Error("no card around the title");
  expect([...card.querySelectorAll("a")]).toEqual([titleAnchor]);
  expect(titleAnchor.textContent).toBe(title);
  expect(titleAnchor.querySelector("a, button, [tabindex]")).toBeNull();
  expect(titleAnchor.closest("h3")).not.toBeNull();
  const number = within(card).getByText("#11");
  expect(number.closest("a")).toBeNull();
  expect(
    titleAnchor.compareDocumentPosition(number) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.focus(titleAnchor);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("the title heads its row in the list's title, which the sheet clamps", async () => {
  await drawTable();
  const drawn = screen.getByText(title).closest(".record-row-title");
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

/** The members each place a row draws its creator holds, in order. */
function membersDrawn(card: Element | null): readonly (readonly string[])[] {
  return creatorPlaces.map((place) =>
    [...(card?.querySelectorAll(`${place} .identity`) ?? [])].map(
      (drawn) => drawn.textContent ?? "",
    ),
  );
}

test("a row names its owner after its creator in both places where they differ, and only its creator where they do not", async () => {
  await drawTableWith(
    [
      { ...ticket, owner: "23:https://issuer.example/bob" },
      { ...escalated, creator, owner: creator },
    ],
    [execution],
  );
  const taken = screen.getByText(title).closest("li");
  expect(membersDrawn(taken)).toEqual([
    ["alice", "bob"],
    ["alice", "bob"],
  ]);
  expect(
    taken?.querySelector(".ticket-list-creator .visually-hidden")?.textContent,
  ).toContain("Owner");
  expect(
    membersDrawn(screen.getByText("Escalated ticket").closest("li")),
  ).toEqual([["alice"], ["alice"]]);
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

test("a row draws its state as a status badge in its phase's tone, in the slot every row's state stands in", async () => {
  await drawTable();
  const badge = within(rowsDrawn())
    .getByText("Working")
    .closest<HTMLElement>(".status-badge");
  expect(badge?.parentElement?.className).toBe("ticket-list-standing");
  expect(badge?.dataset["tone"]).toBe("live");
  expect(rowsDrawn().querySelector(".ticket-state")).toBeNull();
});

test("a ready row's badge is in the tone of a done row's and a blocked row's in its own, each with its tone's mark", async () => {
  await drawTableWith(
    [
      finished,
      pending(24, []),
      pending(25, [{ ticket: 24, phase: "Pending" }]),
    ],
    [],
  );
  const badgeOf = (word: string): HTMLElement | null =>
    within(rowsDrawn()).getByText(word).closest<HTMLElement>(".status-badge");
  const ready = badgeOf("Ready");
  const blocked = badgeOf("Blocked");
  expect(ready?.dataset["tone"]).toBe("pass");
  expect(badgeOf("Done")?.dataset["tone"]).toBe("pass");
  expect(blocked?.dataset["tone"]).toBe("queued");
  expect(ready?.querySelector("svg")?.innerHTML).not.toBe(
    blocked?.querySelector("svg")?.innerHTML,
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

const projectEmpty = "No tickets yet. Ask in a chat to make one.";

/** A project with no ticket at all is one line sending the reader to a chat,
 * with no section, no filter to choose between and nothing to press. */
test("a project with no ticket says so in one line that sends the reader to a chat, under the page's one top-level heading", async () => {
  await drawTableWith([], []);
  const empty = screen.getByText(projectEmpty);
  expect(empty.tagName).toBe("P");
  expect(empty.className).toBe("empty");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(document.querySelectorAll("a")).toHaveLength(0);
  expect(screen.queryAllByRole("button")).toEqual([]);
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

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s may author is offered no new ticket, empty or not",
  async (_said, abilities) => {
    const over = abilitiesOver(abilities);
    await drawTableWith([], [], over);
    expect(screen.getByText(projectEmpty)).toBeDefined();
    expect(screen.queryByText("New ticket")).toBeNull();
    cleanup();
    await drawTableWith([ticket], [execution], over);
    expect(screen.queryByText("New ticket")).toBeNull();
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
  expect(ready.firstElementChild?.className).toBe("status-badge");
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
  expect(screen.getByText(projectEmpty)).toBeDefined();
  expect(screen.getByText(/^Import refused/u).textContent).toBe(
    "Import refused · acme/widgets",
  );
});

/** The Filter control in the bar, by the name it carries. */
function filterControl(): HTMLElement {
  return screen.getByRole("button", { name: /^Filter/u });
}

/** The Filter panel, opened from the bar. */
async function filterPanelOpened(): Promise<HTMLElement> {
  fireEvent.click(filterControl());
  await settled();
  return screen.getByRole("dialog", { name: "Filter" });
}

/** The marks under the bar, by what each says. */
function filterMarks(): readonly (string | null)[] {
  const marks = screen.queryByRole("list", { name: "Filters on" });
  return [...(marks?.querySelectorAll(".chip-label") ?? [])].map(
    (mark) => mark.textContent,
  );
}

test("the bar holds the search, the Filter control and the sort, and nothing is drawn under it while no filter is on", async () => {
  await drawTableWith([ticket, escalated], [execution]);
  const bar = document.querySelector<HTMLElement>(".list-controls");
  expect(
    within(bar as HTMLElement)
      .getAllByRole("button")
      .map((control) => control.getAttribute("title") ?? control.textContent),
  ).toStrictEqual(["Search tickets", "Filter", "Sort State"]);
  expect(filterControl().textContent).toBe("Filter");
  expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
});

test("the panel offers every former filter once, grouped and labelled: each state, the creator and the owner", async () => {
  await drawTableWith([ticket], [execution], abilitiesOver(abilitiesEvery));
  const panel = await filterPanelOpened();
  const groups = [...panel.querySelectorAll("fieldset")].map((group) => [
    group.querySelector("legend")?.textContent,
    within(group)
      .getAllByRole("combobox")
      .map((select) => select.getAttribute("id") ?? ""),
  ]);
  expect(groups.map(([legend, selects]) => [legend, selects?.length])).toEqual([
    ["State", 1],
    ["People", 2],
  ]);
  const options = (label: string): readonly (string | null)[] =>
    within(within(panel).getByRole("combobox", { name: label }))
      .getAllByRole("option")
      .map((option) => option.textContent);
  expect(options("State")).toStrictEqual([
    "All states",
    "Pending",
    "Ready",
    "Blocked",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ]);
  expect(options("Creator").slice(0, 2)).toStrictEqual(["Anyone", "Me"]);
  expect(options("Owner").slice(0, 2)).toStrictEqual(["Anyone", "Me"]);
  expect(within(panel).getAllByRole("combobox")).toHaveLength(3);
});

test("the control counts the filters on, each also a mark under the bar that one press removes, the address keeping the rest", async () => {
  await drawTableWith(
    [ticket, escalated],
    [execution],
    abilitiesOver(abilitiesEvery),
    {
      filter: "Escalated",
      owner: abilitiesEvery.principal,
      sort: "Oldest",
    },
  );
  expect(filterControl().textContent).toBe("Filter22 filters on");
  expect(filterMarks()).toStrictEqual(["State: Escalated", "Owner: Me"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Owner: Me" }));
  await settled();
  expect(addressesWritten).toStrictEqual([
    { sort: "Oldest", filter: "Escalated" },
  ]);
  expect(filterMarks()).toStrictEqual(["State: Escalated"]);
  expect(filterControl().textContent).toBe("Filter11 filter on");
  fireEvent.click(
    screen.getByRole("button", { name: "Remove State: Escalated" }),
  );
  await settled();
  expect(addressesWritten.at(-1)).toStrictEqual({
    sort: "Oldest",
    filter: "All",
  });
  expect(localStorage.getItem("chug.ticket-list.filter")).toBe("All");
  expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
  expect(filterControl().textContent).toBe("Filter");
});

test("a filter chosen in the panel is written to the address as the picker wrote it, and draws the list under it", async () => {
  await drawTableWith(
    [ticket, escalated],
    [execution],
    abilitiesOver(abilitiesEvery),
  );
  const panel = await filterPanelOpened();
  fireEvent.change(within(panel).getByRole("combobox", { name: "State" }), {
    target: { value: "Escalated" },
  });
  await settled();
  fireEvent.change(within(panel).getByRole("combobox", { name: "Creator" }), {
    target: { value: abilitiesEvery.principal },
  });
  await settled();
  expect(addressesWritten).toStrictEqual([
    { filter: "Escalated" },
    { filter: "Escalated", creator: abilitiesEvery.principal },
  ]);
  expect(filterMarks()).toStrictEqual(["State: Escalated", "Creator: Me"]);
});

test("Clear all turns every filter in the panel off, keeps the search and the sort, and closes the panel back onto its control", async () => {
  await drawTableWith([ticket], [execution], abilitiesOver(abilitiesEvery), {
    q: "gate",
    sort: "Newest",
    filter: "Work",
    creator: abilitiesEvery.principal,
  });
  const panel = await filterPanelOpened();
  fireEvent.click(within(panel).getByRole("button", { name: "Clear all" }));
  await settled();
  expect(addressesWritten).toStrictEqual([
    { q: "gate", sort: "Newest", filter: "All" },
  ]);
  expect(localStorage.getItem("chug.ticket-list.filter")).toBe("All");
  expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
  expect(document.activeElement).toBe(filterControl());
  expect(filterMarks()).toStrictEqual([]);
  const reopened = await filterPanelOpened();
  expect(
    within(reopened)
      .getByRole<HTMLButtonElement>("button", { name: "Clear all" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("the panel takes the focus as it opens, holds its filters in reading order, and Escape closes it back onto its control", async () => {
  await drawTableWith([ticket], [execution]);
  const panel = await filterPanelOpened();
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(
    [...panel.querySelectorAll<HTMLElement>("select, button")].map((control) =>
      control.getAttribute("id") === null
        ? control.textContent
        : panel.querySelector(`label[for="${control.id}"]`)?.textContent,
    ),
  ).toStrictEqual(["State", "Creator", "Owner", "Clear all", "Close"]);
  fireEvent.keyDown(document.activeElement ?? panel, { key: "Escape" });
  await settled();
  expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
  expect(document.activeElement).toBe(filterControl());
  await filterPanelOpened();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await settled();
  expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
  expect(document.activeElement).toBe(filterControl());
});

test("on a phone the panel is a sheet across the screen's foot over a scrim, and beside a wide list a popover with no scrim", async () => {
  await drawTableWith([ticket], [execution]);
  const panel = await filterPanelOpened();
  const wrapper = panel.parentElement as Element;
  const scrim = document.querySelector(".list-filter-scrim") as Element;
  const wide = sheetRules(filterSheet, []);
  const phone = sheetRules(filterSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(wide, scrim, "display")).toBe("none");
  expect(sheetDeclared(phone, scrim, "display")).toBe("block");
  expect(sheetDeclared(phone, scrim, "background")).toBe("var(--scrim)");
  expect(sheetDeclared(phone, wrapper, "inset")).toBe("auto 0 0");
  expect(sheetDeclared(phone, wrapper, "transform")).toBe("none");
  expect(sheetDeclared(phone, panel, "width")).toBe("100%");
  expect(sheetDeclared(wide, panel, "width")).toBe("var(--width-aside)");
});
