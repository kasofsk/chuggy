/**
 * The searchable roster mounted alone: the box narrows the rows the caller
 * draws, and a query keeping none of them is the one empty line.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { SearchableRoster } from "../app/browser/ui/SearchableRoster.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

const names = ["kasofsk/chuggy", "gdoteof/scratch", "kasofsk/scratch"];

function drawRoster(): HTMLInputElement {
  render(
    <SearchableRoster
      label="Search"
      rows={names}
      textOf={(name) => name}
      keyOf={(name) => name}
      renderRow={(name) => <span>{name}</span>}
    />,
  );
  return screen.getByLabelText<HTMLInputElement>("Search");
}

function drawnRows(): readonly (string | null)[] {
  return screen.queryAllByRole("listitem").map((row) => row.textContent);
}

test("typing narrows the rows to those the query keeps", () => {
  const box = drawRoster();
  expect(drawnRows()).toStrictEqual(names);
  fireEvent.change(box, { target: { value: "Scratch kas" } });
  expect(box.value).toBe("Scratch kas");
  expect(drawnRows()).toStrictEqual(["kasofsk/scratch"]);
  expect(screen.queryByText("No match")).toBeNull();
  styleless();
});

test("a query keeping no row draws the empty line and no list", () => {
  const box = drawRoster();
  fireEvent.change(box, { target: { value: "absent" } });
  expect(drawnRows()).toStrictEqual([]);
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByText("No match").classList.contains("empty")).toBe(true);
});
