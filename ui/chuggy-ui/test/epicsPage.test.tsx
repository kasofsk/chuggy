/**
 * The epic list: a row an epic with its status and progress, a page more on
 * request, and the way to a new epic drawn only for a reader who may write one.
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
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { EpicsPage } from "../app/browser/EpicsPage.tsx";
import type { EpicsQuery } from "../app/core/epics.ts";
import { leadPartition } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesFetch,
  abilitiesNone,
} from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";

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

function summary(number: number, title: string, status = "in_progress") {
  return {
    number,
    revision: 1,
    title,
    visibility: "Active",
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
  const { rerender } = render(screenAt(query, onQuery));
  await settled();
  return {
    asked,
    redrawn: async (next) => {
      rerender(screenAt(next, onQuery));
      await settled();
    },
  };
}

test("each epic is a row with its status, progress and a link to its page", async () => {
  await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing"), summary(9, "Search", "done")] },
  });
  const list = screen.getByRole("list", { name: "Epics" });
  const rows = within(list).getAllByRole("listitem");
  const [first, second] = rows;
  if (first === undefined || second === undefined)
    throw new Error("two rows are drawn");
  expect(within(first).getByText("In progress")).toBeTruthy();
  expect(within(first).getByText("1 of 2 done")).toBeTruthy();
  expect(
    within(first).getByRole("link", { name: "Billing" }).getAttribute("href"),
  ).toBe("/acme/atlas/epics/7");
  expect(within(second).getByText("Done")).toBeTruthy();
});

test("a project with no epic says so", async () => {
  await drawn(abilitiesNone, { first: { epics: [] } });
  expect(screen.getByText("No epics")).toBeTruthy();
});

test("show more reads the page after the cursor and draws it under the first", async () => {
  const { asked } = await drawn(abilitiesNone, {
    first: { epics: [summary(7, "Billing")], nextAfter: 7 },
    "7": { epics: [summary(3, "Older")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await settled();
  expect(asked.some((url) => url.includes("after=7"))).toBe(true);
  expect(screen.getByRole("link", { name: "Older" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("the new epic form is drawn for a reader who may write and not for one who may not", async () => {
  await drawn(abilitiesEvery, { first: { epics: [] } });
  expect(screen.getByRole("button", { name: "New epic" })).toBeTruthy();
  cleanup();
  await drawn(abilitiesNone, { first: { epics: [] } });
  expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
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

  expect(box.value).toBe("");
  expect(asked).toStrictEqual([]);
});
