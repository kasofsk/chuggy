/**
 * The epic list: the tickets list's bar over it, a row an epic drawn as a
 * ticket's row with its progress, and each page more on request joining the
 * one list.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicsPage } from "../app/browser/EpicsPage.tsx";
import { epicsSearchWaitMs } from "../app/core/epics.ts";
import type { EpicsQuery } from "../app/core/epics.ts";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesFetch, abilitiesNone } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { renderCopied } from "./copied.tsx";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
  useParams: () => ({ ...leadPartition }),
  useNavigate: () => () => Promise.resolve(),
}));
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

function screenAt(query: EpicsQuery, onQuery: (query: EpicsQuery) => void) {
  return (
    <ScreenHarness
      partition={leadPartition}
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
    return Promise.resolve(answer(pages[after] ?? { epics: [] }));
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

test("each epic is a row of the tickets list's, its title over its number and summary, then its progress", async () => {
  await drawn(abilitiesNone, {
    first: {
      epics: [
        { ...summary(7, "Billing"), summary: "Invoices and refunds" },
        summary(9, "Search", "done", "Archived"),
      ],
    },
  });
  const list = screen.getByRole("list", { name: "Epics" });
  expect(list.classList.contains("ticket-list")).toBe(true);
  const rows = within(list).getAllByRole("listitem");
  const [first, second] = rows;
  if (first === undefined || second === undefined)
    throw new Error("two rows are drawn");
  expect(first.querySelector(".ticket-list-row")).not.toBeNull();
  expect(
    within(first)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toStrictEqual([
    ["Billing", "/acme/atlas/epics/7"],
    ["7", "/acme/atlas/epics/7"],
  ]);
  expect(
    first.querySelector(".ticket-list-info .ticket-list-meta")?.textContent,
  ).toBe("Invoices and refunds");
  const bar = within(first).getByRole("progressbar", { name: "1 of 2 done" });
  expect(
    [...bar.querySelectorAll<SVGRectElement>(".epic-progress-segment")].map(
      (segment) => segment.dataset["group"],
    ),
  ).toStrictEqual(["Done", "Pending"]);
  expect(first.querySelector(".ticket-list-foot")?.contains(bar)).toBe(true);
  expect(first.querySelector(".epic-progress-said")?.textContent).toBe(
    "1 of 2 done",
  );
  expect(within(first).queryByText("In progress")).toBeNull();
  expect(within(first).queryByText("Archived")).toBeNull();
  expect(second.querySelector(".ticket-list-foot-standing")?.textContent).toBe(
    "Archived",
  );
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

test("a project with no epic says so", async () => {
  await drawn(abilitiesNone, { first: { epics: [] } });
  expect(screen.getByText("No epics")).toBeTruthy();
});

test("show more reads the page after the cursor and draws its rows in the one list, under the first's", async () => {
  const { asked } = await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing")], nextAfter: 7 },
    "7": { epics: [summary(3, "Older")], nextAfter: 3 },
    "3": { epics: [summary(1, "Oldest")] },
  });
  const more = screen.getByRole("button", { name: "Show more" });
  expect(more.parentElement?.classList.contains("ticket-list-more")).toBe(true);
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
      .getAllByRole("listitem")
      .map((row) => row.dataset["epic"]),
  ).toStrictEqual(["7", "3", "1"]);
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
