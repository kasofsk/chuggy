/**
 * The bar over a list, which the tickets list and the epics list both draw:
 * what it is handed for its start before its search and pickers, and a search
 * that is a button naming the box it opens out to, focused, until Escape or
 * leaving it closes it again; and a bar scrolled out of the way that is inert
 * while focus is outside it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test } from "vitest";

import { ListControls, ListSearch } from "../app/browser/ui/ListControls.tsx";

afterEach(cleanup);

function Searched(props: { readonly held?: string }): ReactNode {
  const [search, setSearch] = useState(props.held ?? "");
  return (
    <ListControls start={<span>12 shown</span>}>
      <ListSearch
        label="Search rows"
        placeholder="Titles…"
        search={search}
        onSearch={setSearch}
      />
      <button type="button">Sort</button>
    </ListControls>
  );
}

function barOf(): HTMLElement {
  const bar = document.querySelector<HTMLElement>(".list-controls");
  if (bar === null) throw new Error("the bar is drawn");
  return bar;
}

test("the start stands before the search and the pickers, which sit together at the bar's end", () => {
  render(<Searched />);
  const bar = barOf();
  const [start, selects] = [...bar.children];
  expect(start?.textContent).toBe("12 shown");
  expect(selects?.classList.contains("list-selects")).toBe(true);
  const [search, sort] = [...(selects?.children ?? [])];
  expect(search?.classList.contains("list-search")).toBe(true);
  expect(sort?.textContent).toBe("Sort");
});

test("the search button names the box it opens, which takes focus and nothing until it is open", () => {
  render(<Searched />);
  const toggle = screen.getByRole("button", { name: "Search rows" });
  const box = screen.getByRole("textbox", { name: "Search rows" });
  const field = box.closest(".list-search-field");
  expect(toggle.getAttribute("aria-controls")).toBe(field?.id);
  expect(field?.hasAttribute("inert")).toBe(true);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(field?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(box);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(field?.hasAttribute("inert")).toBe(true);
});

test("focus leaving the search closes it, and a closed search holding words is marked", () => {
  render(<Searched held="billing" />);
  const toggle = screen.getByRole("button", { name: "Search rows" });
  expect(toggle.hasAttribute("data-active")).toBe(true);
  fireEvent.click(toggle);
  const box = screen.getByRole("textbox", { name: "Search rows" });
  fireEvent.change(box, { target: { value: "" } });
  expect(toggle.hasAttribute("data-active")).toBe(false);
  fireEvent.blur(box, {
    relatedTarget: screen.getByRole("button", { name: "Sort" }),
  });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

function listControlsScrolledTo(top: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value: top });
  fireEvent.scroll(window);
}

afterEach(() => {
  listControlsScrolledTo(0);
});

test("scrolled out of the way the bar is inert, unless focus is inside it", () => {
  render(
    <>
      <Searched />
      <button type="button">Elsewhere</button>
    </>,
  );
  const bar = barOf();
  listControlsScrolledTo(600);
  expect(bar.hasAttribute("data-hidden")).toBe(true);
  expect(bar.hasAttribute("inert")).toBe(true);
  listControlsScrolledTo(0);
  expect(bar.hasAttribute("inert")).toBe(false);
  const sort = screen.getByRole("button", { name: "Sort" });
  fireEvent.focus(sort);
  listControlsScrolledTo(600);
  expect(bar.hasAttribute("data-hidden")).toBe(false);
  expect(bar.hasAttribute("inert")).toBe(false);
  fireEvent.blur(sort, {
    relatedTarget: screen.getByRole("button", { name: "Search rows" }),
  });
  expect(bar.hasAttribute("inert")).toBe(false);
  fireEvent.blur(sort, {
    relatedTarget: screen.getByRole("button", { name: "Elsewhere" }),
  });
  expect(bar.hasAttribute("data-hidden")).toBe(true);
  expect(bar.hasAttribute("inert")).toBe(true);
});
