/**
 * The ⋯ menu, mounted alone: a trigger named by its caller, items whose roles
 * are a menu's whatever kind each is, a destructive one told apart by more
 * than its colour, Escape handing focus back to the trigger, and an item that
 * renames itself while open keeping the focus it holds.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { MoreMenu } from "../app/browser/ui/MoreMenu.tsx";
import type { MoreMenuItem } from "../app/browser/ui/MoreMenu.tsx";
import menuSheet from "../app/browser/ui/Menu.css?raw";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { sheetDeclared, sheetRules } from "./sheet.ts";
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

function CopyLinkMenu(): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <MoreMenu
      label="More actions"
      items={[
        {
          kind: "action",
          label: copied ? "Copied" : "Copy link",
          onSelect: (event) => {
            event.preventDefault();
            setCopied(true);
          },
        },
        { kind: "destructive", label: "Delete", onSelect: () => undefined },
      ]}
    />
  );
}

test("an item renamed while the menu stays open keeps its focus", async () => {
  render(<CopyLinkMenu />);
  const trigger = screen.getByRole("button", { name: "More actions" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const copyLink = await screen.findByRole("menuitem", { name: "Copy link" });
  await waitFor(() => {
    expect(document.activeElement).toBe(copyLink);
  });
  fireEvent.keyDown(copyLink, { key: "Enter" });
  const copied = await screen.findByRole("menuitem", { name: "Copied" });
  expect(copied).toBe(copyLink);
  expect(document.activeElement).toBe(copied);
  fireEvent.keyDown(copied, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  await waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
});

test("an item is a control's height under a coarse pointer, and its own height otherwise", () => {
  const item = document.createElement("div");
  item.className = "menu-item";
  expect(
    sheetDeclared(
      sheetRules(menuSheet, ["(pointer: coarse)"]),
      item,
      "min-height",
    ),
  ).toBe("var(--height-control)");
  expect(sheetDeclared(sheetRules(menuSheet, []), item, "min-height")).toBe("");
});
