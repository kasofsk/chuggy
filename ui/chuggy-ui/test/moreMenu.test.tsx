/**
 * The ⋯ menu, mounted alone: a trigger named by its caller, items whose roles
 * are a menu's whatever kind each is, a destructive one told apart by more
 * than its colour, and Escape handing focus back to the trigger.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { MoreMenu } from "../app/browser/ui/MoreMenu.tsx";
import type { MoreMenuItem } from "../app/browser/ui/MoreMenu.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { styleless } from "./styleless.ts";

beforeEach(resizeObserverStubbed);

afterEach(cleanup);

const items: readonly MoreMenuItem[] = [
  {
    kind: "link",
    label: "Duplicate",
    link: (anchor) => <a href="/tickets/new" {...anchor} />,
  },
  { kind: "action", label: "Copy link", onSelect: () => undefined },
  { kind: "destructive", label: "Delete", onSelect: () => undefined },
];

async function moreMenuOpened(): Promise<HTMLElement> {
  render(<MoreMenu label="More actions" items={items} />);
  const trigger = screen.getByRole("button", { name: "More actions" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("menu");
  return trigger;
}

test("the trigger is named by its caller and draws only the glyph", () => {
  render(<MoreMenu label="More actions" items={items} />);
  const trigger = screen.getByRole("button", { name: "More actions" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.textContent).toBe("");
  expect(trigger.classList).toContain("more-menu-trigger");
});

test("every item, link, action or destructive, is a menu item carrying its word", async () => {
  await moreMenuOpened();
  const drawn = screen.getAllByRole("menuitem");
  expect(drawn.map((item) => item.textContent)).toEqual([
    "Duplicate",
    "Copy link",
    "Delete",
  ]);
  expect(drawn[0]?.tagName).toBe("A");
  expect(drawn[0]?.getAttribute("href")).toBe("/tickets/new");
  expect(
    drawn.map((item) => item.classList.contains("more-menu-destructive")),
  ).toEqual([false, false, true]);
  styleless();
});

test("choosing an action reaches the caller", async () => {
  const chosen: string[] = [];
  render(
    <MoreMenu
      label="More actions"
      items={[
        {
          kind: "action",
          label: "Copy link",
          onSelect: () => {
            chosen.push("Copy link");
          },
        },
      ]}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
  expect(chosen).toEqual(["Copy link"]);
});

test("Escape closes the menu and returns focus to the trigger", async () => {
  const trigger = await moreMenuOpened();
  await waitFor(() => {
    expect(screen.getByRole("menu").contains(document.activeElement)).toBe(
      true,
    );
  });
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
});
