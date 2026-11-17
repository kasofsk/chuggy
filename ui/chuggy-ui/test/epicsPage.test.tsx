/**
 * The epic list: the tickets list's bar over it, a record row an epic with
 * its progress and its status, skeleton rows while a page is read, and each
 * page more on request joining the one list.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicsPage } from "../app/browser/EpicsPage.tsx";
import { epicsSearchWaitMs } from "../app/core/epics.ts";
import type { EpicsQuery } from "../app/core/epics.ts";
import { projectPartition } from "./projectFixture.ts";
import { abilitiesFetch, abilitiesNone } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { renderCopied } from "./copied.tsx";

vi.mock("@tanstack/react-router", () => {
  interface Linked {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }
  const hrefOf = (props: Linked) =>
    (props.to ?? "/").replace(
      /\$(\w+)/gu,
      (named: string, key: string) => props.params?.[key] ?? named,
    );
  return {
    createLink:
      (
        component: (props: { href: string; children?: ReactNode }) => ReactNode,
      ) =>
      (props: Linked) =>
        component({ href: hrefOf(props), children: props.children }),
    useParams: () => ({ ...projectPartition }),
    useNavigate: () => () => Promise.resolve(),
  };
});
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const byPhase = {
  Pending: 1,
  Work: 0,
  Evaluation: 0,
  Finalization: 0,
  Done: 1,
  Escalated: 0,
  Revoked: 0,
};

function summary(
  number: number,
  title: string,
  status = "in_progress",
  visibility = "Active",
) {
  return {
    number,
    revision: 1,
    title,
    visibility,
    progress: { byPhase, drafts: 0, done: 1, total: 2 },
    status,
    waitingOnOutside: [],
  };
}

/** A page whose read never answers. */
const epicsPagePending = "Pending";

function screenAt(query: EpicsQuery, onQuery: (query: EpicsQuery) => void) {
  return (
    <ScreenHarness
      partition={projectPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <EpicsPage query={query} onQuery={onQuery} />
    </ScreenHarness>
  );
}

async function drawn(
  abilities: AbilitiesAnswer,
  pages: Readonly<Record<string, unknown>>,
  query: EpicsQuery = {},
  onQuery: (query: EpicsQuery) => void = () => undefined,
): Promise<{
  readonly asked: readonly string[];
  readonly redrawn: (query: EpicsQuery) => Promise<void>;
}> {
  const asked: string[] = [];
  const served = ((url: string) => {
    asked.push(url);
    const after = /after=(\d+)/u.exec(url)?.[1] ?? "first";
    const page = pages[after];
    if (page === epicsPagePending) return new Promise<never>(() => undefined);
    return Promise.resolve(answer(page ?? { epics: [] }));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", abilitiesFetch(abilities, served));
  const { rerender } = renderCopied(screenAt(query, onQuery));
  await settled();
  return {
    asked,
    redrawn: async (next) => {
      rerender(screenAt(next, onQuery));
      await settled();
    },
  };
}

test("each epic is a record row: its title the one link, in a heading, over its progress, its words and its summary, with its status at the line's end", async () => {
  await drawn(abilitiesNone, {
    first: {
      epics: [
        { ...summary(7, "Billing"), summary: "Invoices and refunds" },
        summary(9, "Search", "done", "Archived"),
      ],
    },
  });
  const list = screen.getByRole("list", { name: "Epics" });
  expect(list.classList.contains("record-list")).toBe(true);
  const rows = within(list).getAllByRole("listitem");
  const [first, second] = rows;
  if (first === undefined || second === undefined)
    throw new Error("two rows are drawn");
  expect(
    within(first)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toStrictEqual([["Billing", "/acme/atlas/epics/7"]]);
  expect(
    within(first).getByRole("heading", { level: 3, name: "Billing" }),
  ).toBeTruthy();
  const meta = first.querySelector(".record-row-meta");
  const bar = within(first).getByRole("progressbar", { name: "1 of 2 done" });
  expect(
    [...bar.querySelectorAll<SVGRectElement>(".epic-progress-segment")].map(
      (segment) => segment.dataset["group"],
    ),
  ).toStrictEqual(["Done", "Pending"]);
  expect(meta?.contains(bar)).toBe(true);
  expect(meta?.querySelector(".epic-progress-said")?.textContent).toBe(
    "1 of 2 done",
  );
  expect(meta?.textContent).toContain("Invoices and refunds");
  const badges = (row: Element) =>
    [
      ...row.querySelectorAll<HTMLElement>(
        ".record-row-trailing .status-badge",
      ),
    ].map((badge) => [badge.dataset["tone"], badge.textContent]);
  expect(badges(first)).toStrictEqual([["live", "In progress"]]);
  expect(badges(second)).toStrictEqual([
    ["pass", "Done"],
    ["retired", "Archived"],
  ]);
});

test("the list borrows no class of the tickets list's", async () => {
  await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing")], nextAfter: 7 },
  });
  expect(document.querySelector("[class*='ticket-list']")).toBeNull();
});

test("while the first page is read the list is skeleton rows, hidden from a reader", async () => {
  await drawn(abilitiesNone, { first: epicsPagePending });
  const list = screen.getByRole("list", { name: "Loading…", hidden: true });
  const rows = [...list.children];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector("[data-skeleton]")).not.toBeNull();
  }
  expect(screen.queryByRole("link")).toBeNull();
});

test("while a page more is read its skeleton rows stand at the list's end, under the rows already read", async () => {
  await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing")], nextAfter: 7 },
    "7": epicsPagePending,
  });
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await settled();
  const list = screen.getByRole("list", { name: "Epics" });
  const rows = [...list.children];
  expect(rows[0]?.querySelector("[data-skeleton]")).toBeNull();
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows.slice(1))
    expect(row.querySelector("[data-skeleton]")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("the list's bar is the tickets list's, its search a button that opens to the box and its sort and visibility round pickers", async () => {
  await drawn(abilitiesNone, { first: { epics: [summary(7, "Billing")] } });
  const bar = document.querySelector(".list-controls");
  if (!(bar instanceof HTMLElement)) throw new Error("the bar is drawn");
  const toggle = within(bar).getByRole("button", { name: "Search epics" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(
    within(bar).getByRole("textbox", { name: "Search epics" }),
  ).toBeTruthy();
  expect(
    within(bar)
      .getAllByRole("button", { name: /^(Sort|Visibility)/u })
      .map((picker) => picker.textContent),
  ).toStrictEqual(["Sort Newest", "Visibility Active"]);
  expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
});

test("a row's bar has its words beside it, naming what runs", async () => {
  const running = {
    ...summary(7, "Billing"),
    progress: {
      byPhase: { ...byPhase, Pending: 10, Done: 3, Work: 1 },
      drafts: 0,
      done: 3,
      total: 14,
    },
  };
  await drawn(abilitiesNone, { first: { epics: [running] } });
  expect(
    screen.getByRole("progressbar", { name: "3 of 14 done, 1 running" }),
  ).toBeTruthy();
  expect(document.querySelector(".epic-progress-said")?.textContent).toBe(
    "3 of 14 done · 1 running",
  );
});

test("a project with no epic says so in one line, that one is made by asking in a chat, and offers no press", async () => {
  await drawn(abilitiesNone, { first: { epics: [] } });
  const line = screen.getByText("No epics yet. Ask in a chat to make one.");
  expect(line.tagName).toBe("P");
  expect(screen.queryByRole("list", { name: "Epics" })).toBeNull();
  const page = screen.getByRole("region", { name: "Epics" });
  const bar = page.querySelector(".list-controls");
  expect(
    within(page)
      .queryAllByRole("button")
      .filter((press) => !bar?.contains(press)),
  ).toStrictEqual([]);
});

test.each<[string, EpicsQuery]>([
  ["a search", { q: "zzz" }],
  ["the archived view", { visibility: "Archived" }],
])(
  "%s that matches no epic says nothing matches, not that the project has none",
  async (_, query) => {
    await drawn(abilitiesNone, { first: { epics: [] } }, query);
    const line = screen.getByText("No epic matches this search or filter.");
    expect(line.tagName).toBe("P");
    expect(screen.queryByText(/Ask in a chat/u)).toBeNull();
  },
);

test.each<[string, EpicsQuery]>([
  ["a sort", { sort: "oldest" }],
  ["every visibility", { visibility: "All" }],
])(
  "%s with no search leaves an empty project saying it has no epics yet",
  async (_, query) => {
    await drawn(abilitiesNone, { first: { epics: [] } }, query);
    expect(
      screen.getByText("No epics yet. Ask in a chat to make one."),
    ).toBeDefined();
  },
);

test("show more reads the page after the cursor and draws its rows in the one list, under the first's", async () => {
  const { asked } = await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing")], nextAfter: 7 },
    "7": { epics: [summary(3, "Older")], nextAfter: 3 },
    "3": { epics: [summary(1, "Oldest")] },
  });
  const more = screen.getByRole("button", { name: "Show more" });
  expect(more.parentElement?.classList.contains("record-list-more")).toBe(true);
  fireEvent.click(more);
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await settled();
  expect(asked.some((url) => url.includes("after=7"))).toBe(true);
  expect(asked.some((url) => url.includes("after=3"))).toBe(true);
  const [list, ...others] = screen.getAllByRole("list", { name: "Epics" });
  expect(others).toStrictEqual([]);
  if (list === undefined) throw new Error("the list is drawn");
  expect(
    within(list)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  ).toStrictEqual([
    "/acme/atlas/epics/7",
    "/acme/atlas/epics/3",
    "/acme/atlas/epics/1",
  ]);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("a search the address moves to by going back replaces what is typed, and is not written back", async () => {
  const asked: EpicsQuery[] = [];
  const { redrawn } = await drawn(
    abilitiesNone,
    { first: { epics: [] } },
    { q: "billing" },
    (query) => asked.push(query),
  );
  const box = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Search epics",
  });
  expect(box.value).toBe("billing");

  await redrawn({});
  await new Promise((resolve) => setTimeout(resolve, epicsSearchWaitMs));

  expect(box.value).toBe("");
  expect(asked).toStrictEqual([]);
});
