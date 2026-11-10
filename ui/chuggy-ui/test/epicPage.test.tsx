/**
 * One epic: its figures, its graph and history, and its edit page, which a
 * reader who may not write is sent away from, which saves at the revision the
 * page read and returns to the Overview, and whose Cancel writes nothing.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { EpicEditPage } from "../app/browser/epic/EpicEditPage.tsx";
import { EpicGraphTab } from "../app/browser/epic/EpicGraphTab.tsx";
import {
  epicPageDrawn,
  epicQueryClient,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { epicNavigated, epicRouted } from "./epicPageRouter.tsx";
import { leadPartition } from "./leadFixture.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { answer, settled } from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => (await import("./epicPageRouter.tsx")).epicRouterDouble,
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  epicServingReset();
  epicRouted.epic = "7";
  epicNavigated.length = 0;
});

const overviewPath = (epic: number) =>
  `/${leadPartition.tenant}/${leadPartition.project}/epics/${String(epic)}`;

async function editDrawn(
  abilities: AbilitiesAnswer,
  written: (request: SentRequest) => Response = () => answer({}, 503),
  client = epicQueryClient(),
): Promise<readonly SentRequest[]> {
  return (
    await epicPageDrawn(abilities, { written, client, tab: <EpicEditPage /> })
  ).sent;
}

function writes(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((request) => request.method !== "GET");
}

function title(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });
}

async function saved(typed: string): Promise<void> {
  fireEvent.change(title(), { target: { value: typed } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settled();
}

test("the epic is drawn with its figures, its graph and its history", async () => {
  await epicPageDrawn(abilitiesNone, { tab: <EpicGraphTab /> });
  expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
  expect(screen.getByRole("progressbar", { name: "1 of 2 done" })).toBeTruthy();
  const graphic = await screen.findByRole("group", {
    name: "Tickets of the epic and what they wait on",
  });
  expect(graphic.querySelectorAll("path.epic-graph-connector")).toHaveLength(2);
  expect(
    graphic.querySelector("[data-outside] a")?.getAttribute("aria-label"),
  ).toBe("Open ticket #2: Schema, outside the epic");
  expect(graphic.querySelectorAll("[data-member]")).toHaveLength(2);
  expect(document.querySelector(".epic-header-saved")?.textContent).toContain(
    "Revision 3 · saved by",
  );
});

test("a reader who may not write epics is sent from the edit page to the Overview", async () => {
  await editDrawn(abilitiesNone);
  expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  expect(epicNavigated).toStrictEqual([overviewPath(7)]);
});

test("the edit page holds the epic's title, its summary counted against the most it may hold, and its description as Markdown", async () => {
  await editDrawn(abilitiesEvery);
  expect(title().value).toBe("Billing");
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Summary" }).value,
  ).toBe("All of billing");
  expect(screen.getByText("14 / 600")).toBeTruthy();
  const description = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Description",
  });
  expect(description.value).toBe("The **whole** of billing");
  expect(description.hasAttribute("data-mono")).toBe(true);
  expect(screen.getByText("Markdown")).toBeTruthy();
});

test("Save sends at the revision the page read and returns to the Overview", async () => {
  const sent = await editDrawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  await saved("Payments");
  expect(writes(sent)).toHaveLength(1);
  expect(writes(sent)[0]?.body).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { title: "Payments", visibility: "Active", tickets: [4, 5] },
  });
  expect(epicNavigated).toStrictEqual([overviewPath(7)]);
});

test("Cancel returns to the Overview with nothing written", async () => {
  const sent = await editDrawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  fireEvent.change(title(), { target: { value: "Payments" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settled();
  expect(writes(sent)).toHaveLength(0);
  expect(epicNavigated).toStrictEqual([overviewPath(7)]);
});

test("a revision made over another's is refused as stale, stays on the page and offers a reload", async () => {
  await editDrawn(abilitiesEvery, () =>
    answer(
      { error: { code: "StaleRevision", message: "stale" }, current: 5 },
      409,
    ),
  );
  await saved("Payments");
  expect(screen.getByRole("alert").textContent).toBe(
    "The epic was changed since you opened it. Reload it and make the change again.",
  );
  expect(screen.getByRole("button", { name: "Reload the epic" })).toBeTruthy();
  expect(epicNavigated).toStrictEqual([]);
});

test("a later read leaves what is typed on the revision it was read at, until the reader reloads the epic", async () => {
  const client = epicQueryClient();
  const sent = await editDrawn(
    abilitiesEvery,
    () =>
      answer(
        { error: { code: "StaleRevision", message: "stale" }, current: 4 },
        409,
      ),
    client,
  );
  fireEvent.change(title(), { target: { value: "Payments" } });
  epicServing.view = { ...epicView, revision: 4, title: "Renamed" };
  await client.invalidateQueries();
  await settled();

  expect(title().value).toBe("Payments");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settled();
  expect(writes(sent).at(-1)?.body).toMatchObject({
    expected: 3,
    content: { title: "Payments" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Reload the epic" }));
  await settled();
  expect(title().value).toBe("Renamed");
});

test("the edit page holds the epic the address names, and a move to another drops what was typed on the first", async () => {
  epicRouted.epic = "8";
  const { sent, rerender } = await epicPageDrawn(abilitiesEvery, {
    written: () => answer({ epic: 8, revision: 4 }),
    tab: <EpicEditPage />,
  });
  epicRouted.epic = "7";
  rerender(<EpicEditPage />);
  await settled();
  fireEvent.change(title(), { target: { value: "Typed on 7" } });
  epicRouted.epic = "8";
  rerender(<EpicEditPage />);
  await settled();

  expect(title().value).toBe("Search");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settled();
  expect(writes(sent).at(-1)?.body).toMatchObject({
    epic: 8,
    expected: 3,
    content: { title: "Search", tickets: [6] },
  });
});
