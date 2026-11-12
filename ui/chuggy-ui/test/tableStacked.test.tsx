/**
 * The table primitive's two answers to a narrow container: a stacked table,
 * whose rows become cards each cell of which carries its column's label and
 * which keeps a table's roles; and a table that stays one, whose scroller is
 * a keyboard stop with a fade on the side it has more on only while it has.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Table } from "../app/browser/ui/Table.tsx";
import type { TableColumn } from "../app/browser/ui/Table.tsx";
import tableSheet from "../app/browser/ui/Table.css?raw";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

afterEach(() => {
  styleless();
  cleanup();
  vi.restoreAllMocks();
});

const columns: readonly TableColumn<"model" | "turns" | "cost">[] = [
  { key: "model", label: "Model", rowHeader: true },
  { key: "turns", label: "Turns", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
];

function stackedDrawn(): HTMLElement {
  render(
    <Table
      caption="Usage by model"
      stacked={{
        columns,
        rows: [
          { key: "opus", cells: { model: "opus", turns: "12", cost: "$4.10" } },
          {
            key: "haiku",
            cells: { model: "haiku", turns: "3", cost: "$0.20" },
          },
        ],
      }}
    />,
  );
  return screen.getByRole("table", { name: "Usage by model" });
}

test("a stacked table's every cell carries its column's label, for the eye only", () => {
  const table = stackedDrawn();
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const cells = Array.from(row.children);
    expect(
      cells.map((cell) => cell.querySelector(".tabular-label")?.textContent),
    ).toEqual(["Model", "Turns", "Cost"]);
    for (const cell of cells)
      expect(
        cell.querySelector(".tabular-label")?.getAttribute("aria-hidden"),
      ).toBe("true");
  }
  expect(screen.getByRole("cell", { name: "$4.10" })).toBeDefined();
});

test("a stacked table restates a table's roles on every element it draws", () => {
  const table = stackedDrawn();
  expect(table.getAttribute("role")).toBe("table");
  expect(
    Array.from(table.querySelectorAll("thead, tbody"), (group) =>
      group.getAttribute("role"),
    ),
  ).toEqual(["rowgroup", "rowgroup"]);
  for (const row of table.querySelectorAll("tr"))
    expect(row.getAttribute("role")).toBe("row");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((head) => head.textContent),
  ).toEqual(["Model", "Turns", "Cost"]);
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((head) => head.getAttribute("scope")),
  ).toEqual(["row", "row"]);
  expect(within(table).getAllByRole("cell")).toHaveLength(4);
});

test("a row of a stacked table is typed to hold a value for every column", () => {
  render(
    <Table
      stacked={{
        columns,
        // @ts-expect-error a row that leaves a column out
        rows: [{ key: "opus", cells: { model: "opus", turns: "12" } }],
      }}
    />,
  );
  expect(screen.getAllByRole("cell")).toHaveLength(2);
});

test("a stacked table is cards with their labels on a narrow container, and columns on a wide one", () => {
  const table = stackedDrawn();
  const label = table.querySelector("tbody .tabular-label");
  const head = table.querySelector("thead");
  const row = table.querySelector("tbody tr");
  if (label === null || head === null || row === null)
    throw new Error("the stacked table drew no body");
  const wide = sheetRules(tableSheet, []);
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(wide, label, "display")).toBe("none");
  expect(sheetDeclared(narrow, label, "display")).toBe("block");
  expect(sheetDeclared(wide, row, "display")).toBe("");
  expect(sheetDeclared(narrow, row, "display")).toBe("block");
  expect(sheetDeclared(narrow, head, "clip-path")).toBe("inset(50%)");
  expect(sheetDeclared(narrow, head, "display")).toBe("");
  expect(table.parentElement?.classList.contains("tabular-stacking")).toBe(
    true,
  );
  expect(
    sheetDeclared(wide, table.parentElement ?? table, "container-type"),
  ).toBe("inline-size");
});

function childrenDrawn(): HTMLElement {
  render(
    <Table caption="Runners">
      <thead>
        <tr>
          <th scope="col">Runner</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>linux-1</td>
        </tr>
      </tbody>
    </Table>,
  );
  const scroller = screen.getByRole("table", { name: "Runners" }).parentElement;
  if (scroller === null) throw new Error("the table drew no scroller");
  return scroller;
}

test("a table that has not opted in draws no roles, labels or container of its own", () => {
  const scroller = childrenDrawn();
  const table = screen.getByRole("table");
  expect(scroller.className).toBe("tabular-scroll max-w-full overflow-x-auto");
  expect(table.className).toBe("tabular");
  expect(scroller.querySelector("[role]")).toBeNull();
  expect(scroller.querySelector(".tabular-label")).toBeNull();
});

test("a scroller that holds its table whole is no keyboard stop and draws no fade", () => {
  const scroller = childrenDrawn();
  expect(scroller.hasAttribute("tabindex")).toBe(false);
  expect(scroller.hasAttribute("role")).toBe(false);
  expect(scroller.hasAttribute("data-more-end")).toBe(false);
  expect(
    sheetDeclared(sheetRules(tableSheet, []), scroller, "mask-image"),
  ).toBe("");
});

test("a scroller with more to show is a named keyboard stop that fades the side the more is on", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
  const scroller = childrenDrawn();
  expect(screen.getByRole("region", { name: "Runners" })).toBe(scroller);
  expect(scroller.tabIndex).toBe(0);
  expect(scroller.hasAttribute("data-more-end")).toBe(true);
  expect(scroller.hasAttribute("data-more-start")).toBe(false);
  const rules = sheetRules(tableSheet, []);
  expect(sheetDeclared(rules, scroller, "mask-image")).toContain("to left");
  expect(sheetDeclared(rules, scroller, "overscroll-behavior-x")).toBe(
    "contain",
  );

  scroller.scrollLeft = 600;
  fireEvent.scroll(scroller);
  expect(scroller.hasAttribute("data-more-start")).toBe(true);
  expect(scroller.hasAttribute("data-more-end")).toBe(false);
  expect(sheetDeclared(rules, scroller, "mask-image")).toContain("to right");
});
