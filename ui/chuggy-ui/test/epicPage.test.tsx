/**
 * One epic: its figures, its graph and history, and the edit form, which is
 * drawn only for a reader who may write and sent at the revision read.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  epicPageDrawn,
  epicQueryClient,
  epicServing,
  epicServingReset,
  epicView,
} from "./epicPageFixture.tsx";
import { epicRouted } from "./epicPageRouter.tsx";
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
});

async function drawn(
  abilities: AbilitiesAnswer,
  written: (request: SentRequest) => Response = () => answer({}, 503),
  client = epicQueryClient(),
): Promise<readonly SentRequest[]> {
  return (await epicPageDrawn(abilities, { written, client })).sent;
}

test("the epic is drawn with its figures, its graph and its history", async () => {
  await drawn(abilitiesNone);
  expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
  expect(
    screen.getByRole("progressbar", { name: "1 of 2 done" }).textContent,
  ).toBe("1/2");
  expect(screen.getByText("whole")).toBeTruthy();
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

test("the edit form is drawn for a reader who may write and not for one who may not", async () => {
  await drawn(abilitiesNone);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  cleanup();
  await drawn(abilitiesEvery);
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
});

async function editedTitle(title: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await settled();
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: title },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settled();
}

test("a revision is sent at the revision that was read", async () => {
  const sent = await drawn(abilitiesEvery, () =>
    answer({ epic: 7, revision: 4 }),
  );
  await editedTitle("Payments");
  const writes = sent.filter((request) => request.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({
    kind: "Revise",
    epic: 7,
    expected: 3,
    content: { title: "Payments", tickets: [4, 5] },
  });
});

test("a revision made over another's is refused as stale and offers a reload", async () => {
  await drawn(abilitiesEvery, () =>
    answer(
      { error: { code: "StaleRevision", message: "stale" }, current: 5 },
      409,
    ),
  );
  await editedTitle("Payments");
  expect(screen.getByRole("alert").textContent).toContain("Reload");
  expect(screen.getByRole("button", { name: "Reload the epic" })).toBeTruthy();
});

test("a later read leaves what is typed on the revision it was read at, until the reader reloads the epic", async () => {
  const client = epicQueryClient();
  const sent = await drawn(
    abilitiesEvery,
    () =>
      answer(
        { error: { code: "StaleRevision", message: "stale" }, current: 4 },
        409,
      ),
    client,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await settled();
  const title = () =>
    screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value;
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Payments" },
  });
  epicServing.view = { ...epicView, revision: 4, title: "Renamed" };
  await client.invalidateQueries();
  await settled();

  expect(title()).toBe("Payments");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settled();
  expect(
    sent.filter((request) => request.method !== "GET").at(-1)?.body,
  ).toMatchObject({ expected: 3, content: { title: "Payments" } });

  fireEvent.click(screen.getByRole("button", { name: "Reload the epic" }));
  await settled();
  expect(title()).toBe("Renamed");
});

test("the edit form holds the epic the page is on, and a move to another closes the one opened before it", async () => {
  epicRouted.epic = "8";
  const { sent, rerender } = await epicPageDrawn(abilitiesEvery, {
    written: () => answer({ epic: 8, revision: 4 }),
  });
  epicRouted.epic = "7";
  rerender(undefined);
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await settled();
  epicRouted.epic = "8";
  rerender(undefined);
  await settled();
  expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await settled();

  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Title" }).value,
  ).toBe("Search");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settled();
  expect(
    sent.filter((request) => request.method !== "GET").at(-1)?.body,
  ).toMatchObject({
    epic: 8,
    expected: 3,
    content: { title: "Search", tickets: [6] },
  });
});
