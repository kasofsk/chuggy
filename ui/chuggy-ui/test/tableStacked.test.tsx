/**
 * The table primitive's two answers to a narrow container: a stacked table,
 * whose rows become cards titled by what names the row and ending in its
 * actions, every other cell of which carries its column's label, and which
 * keeps a table's roles; and a table that stays one, whose scroller is
 * a keyboard stop with a fade on the side it has more on only while it has
 * and is not focused, since the fade would cut its focus ring away.
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

test("a stacked table's every cell but the one naming its row carries its column's label, for the eye only", () => {
  const table = stackedDrawn();
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const cells = Array.from(row.children);
    expect(
      cells.map((cell) => cell.querySelector(".tabular-label")?.textContent),
    ).toEqual([undefined, "Turns", "Cost"]);
    for (const cell of cells.slice(1))
      expect(
        cell.querySelector(".tabular-label")?.getAttribute("aria-hidden"),
      ).toBe("true");
  }
  expect(screen.getByRole("cell", { name: "$4.10" })).toBeDefined();
});

test("in a card, the cell naming the row is its title, the card's width and drawn strong", () => {
  const table = stackedDrawn();
  const title = within(table)
    .getAllByRole("rowheader")[0]
    ?.querySelector(".tabular-value");
  if (title === null || title === undefined)
    throw new Error("the row's header drew no value");
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(narrow, title, "grid-column")).toBe("1 / -1");
  expect(sheetDeclared(narrow, title, "font-weight")).toBe(
    "var(--weight-strong)",
  );
  expect(sheetDeclared(narrow, title, "color")).toBe("var(--ink-1)");
  expect(sheetDeclared(sheetRules(tableSheet, []), title, "font-weight")).toBe(
    "",
  );
});

test("a card reads its row's name first and its actions last, whatever order the columns are given in, and so do the columns", () => {
  render(
    <Table
      caption="People"
      stacked={{
        columns: [
          { key: "edit", label: "Edit", actions: true },
          { key: "held", label: "Held" },
          { key: "who", label: "Person", rowHeader: true },
        ],
        rows: [
          {
            key: "ada",
            cells: {
              edit: <button className="btn">Edit</button>,
              held: "Admin",
              who: "ada",
            },
          },
        ],
      }}
    />,
  );
  const table = screen.getByRole("table", { name: "People" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((head) => head.textContent),
  ).toEqual(["Person", "Held", "Edit"]);
  const row = within(table).getAllByRole("row")[1];
  const cells = Array.from(row?.children ?? []);
  expect(cells.map((cell) => cell.getAttribute("role"))).toEqual([
    "rowheader",
    "cell",
    "cell",
  ]);
  expect(cells[2]?.querySelector(".tabular-label")).toBeNull();
  expect(
    within(table)
      .getByRole("columnheader", { name: "Edit" })
      .querySelector(".visually-hidden")?.textContent,
  ).toBe("Edit");
});

test("in a card, every press and link a row draws is a finger's height, and between columns it is as it is drawn", () => {
  render(
    <Table
      caption="Links"
      stacked={{
        columns: [
          { key: "name", label: "Name", rowHeader: true },
          { key: "open", label: "Open" },
          { key: "revoke", label: "Revoke", actions: true },
        ],
        rows: [
          {
            key: "one",
            cells: {
              name: "one",
              open: <a href="/one">Review</a>,
              revoke: <button className="btn">Revoke</button>,
            },
          },
        ],
      }}
    />,
  );
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  const wide = sheetRules(tableSheet, []);
  for (const control of [
    screen.getByRole("link", { name: "Review" }),
    screen.getByRole("button", { name: "Revoke" }),
  ]) {
    expect(sheetDeclared(narrow, control, "min-height")).toBe(
      "var(--height-touch)",
    );
    expect(sheetDeclared(wide, control, "min-height")).toBe("");
  }
});

test("a cell a row holds nothing in is drawn between columns and left out of its card", () => {
  render(
    <Table
      caption="Placement"
      stacked={{
        columns: [
          { key: "kind", label: "Kind", rowHeader: true },
          { key: "runner", label: "Runner" },
        ],
        rows: [
          {
            key: "work",
            cells: { kind: "Work", runner: null },
            empty: ["runner"],
          },
          { key: "chat", cells: { kind: "Chat", runner: "Live" } },
        ],
      }}
    />,
  );
  const [left, kept] = screen.getAllByRole("cell");
  if (left === undefined || kept === undefined)
    throw new Error("the table drew no cells");
  expect(left.getAttribute("data-empty")).toBe("");
  expect(kept.hasAttribute("data-empty")).toBe(false);
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(narrow, left, "display")).toBe("none");
  expect(sheetDeclared(narrow, kept, "display")).toBe("grid");
  expect(sheetDeclared(sheetRules(tableSheet, []), left, "display")).toBe("");
});

test("in a card, short values stand side by side under their labels, and one a row holds nothing in keeps its place", () => {
  render(
    <Table
      caption="Roles"
      stacked={{
        columns: [
          { key: "project", label: "Project", rowHeader: true },
          { key: "admin", label: "Admin", inline: true },
          { key: "viewer", label: "Viewer", inline: true },
        ],
        rows: [
          {
            key: "one",
            cells: { project: "one", admin: null, viewer: "box" },
            empty: ["admin"],
          },
        ],
      }}
    />,
  );
  const [left, kept] = screen.getAllByRole("cell");
  if (left === undefined || kept === undefined)
    throw new Error("the table drew no cells");
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(narrow, kept, "display")).toBe("inline-grid");
  expect(sheetDeclared(narrow, kept, "grid-template-columns")).toBe(
    "max-content",
  );
  expect(sheetDeclared(narrow, left, "visibility")).toBe("hidden");
  expect(sheetDeclared(narrow, left, "display")).toBe("inline-grid");
  expect(sheetDeclared(sheetRules(tableSheet, []), kept, "display")).toBe("");
});

test("what stands under a row spans the table, no rule parting the two, and is its card's foot", () => {
  render(
    <Table
      caption="Links"
      stacked={{
        columns: [
          { key: "name", label: "Name", rowHeader: true },
          { key: "state", label: "State" },
        ],
        rows: [
          {
            key: "one",
            cells: { name: "one", state: "Open" },
            below: <p>Revoke link?</p>,
          },
          { key: "two", cells: { name: "two", state: "Used" }, below: null },
        ],
      }}
    />,
  );
  const table = screen.getByRole("table", { name: "Links" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  const [asked, below] = rows;
  const foot = below?.firstElementChild;
  if (asked === undefined || foot === null || foot === undefined)
    throw new Error("nothing was drawn under the row");
  expect(foot.getAttribute("colspan")).toBe("2");
  expect(foot.textContent).toBe("Revoke link?");
  const wide = sheetRules(tableSheet, []);
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(
    sheetDeclared(wide, asked.firstElementChild ?? asked, "border-bottom"),
  ).toBe("0px");
  expect(sheetDeclared(narrow, asked, "border-bottom")).toBe("0px");
  expect(sheetDeclared(narrow, foot, "display")).toBe("block");
});

test("in a card, a wide value and every value of a framed table is set under its label, and any other beside it", () => {
  const drawn = (framed: boolean): readonly HTMLElement[] => {
    render(
      <Table
        caption={framed ? "Framed" : "Bare"}
        stacked={{
          framed,
          columns: [
            { key: "name", label: "Name", rowHeader: true },
            { key: "kind", label: "Kind" },
            { key: "app", label: "App", wide: true },
          ],
          rows: [
            { key: "one", cells: { name: "one", kind: "User", app: "x" } },
          ],
        }}
      />,
    );
    return within(
      screen.getByRole("table", { name: framed ? "Framed" : "Bare" }),
    ).getAllByRole("cell");
  };
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  const columns = (cell: HTMLElement | undefined): string =>
    cell === undefined
      ? ""
      : sheetDeclared(narrow, cell, "grid-template-columns");
  const [kind, app] = drawn(false);
  expect(columns(kind)).toContain("var(--col-field-label)");
  expect(columns(app)).toBe("minmax(0, 1fr)");
  const [framedKind] = drawn(true);
  expect(columns(framedKind)).toBe("minmax(0, 1fr)");
});

test("a value cut short between columns is drawn whole in a card, a subject in it too", () => {
  render(
    <Table
      caption="People"
      stacked={{
        columns: [{ key: "who", label: "Person", rowHeader: true }],
        rows: [
          {
            key: "robot",
            cells: {
              who: (
                <span className="tabular-cut">
                  <code className="identity">s-robot</code>
                </span>
              ),
            },
          },
        ],
      }}
    />,
  );
  const subject = screen.getByText("s-robot");
  const cut = subject.parentElement;
  if (cut === null) throw new Error("the subject was drawn in nothing");
  const wide = sheetRules(tableSheet, []);
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(wide, cut, "white-space")).toBe("nowrap");
  expect(sheetDeclared(wide, cut, "text-overflow")).toBe("ellipsis");
  expect(sheetDeclared(narrow, cut, "white-space")).toBe("normal");
  expect(sheetDeclared(narrow, cut, "overflow")).toBe("visible");
  expect(sheetDeclared(narrow, subject, "white-space")).toBe("normal");
});

test("a framed table pads its cells as its card is, and its cards keep their own padding", () => {
  render(
    <Table
      caption="People"
      stacked={{
        framed: true,
        columns: [
          { key: "who", label: "Person", rowHeader: true },
          { key: "held", label: "Held" },
        ],
        rows: [{ key: "ada", cells: { who: "ada", held: "Admin" } }],
      }}
    />,
  );
  const table = screen.getByRole("table", { name: "People" });
  expect(table.classList.contains("tabular-framed")).toBe(true);
  const cell = screen.getByRole("cell");
  const wide = sheetRules(tableSheet, []);
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(wide, cell, "padding")).toBe("var(--space-3)");
  expect(sheetDeclared(wide, cell, "padding-inline-end")).toBe(
    "var(--space-4)",
  );
  expect(sheetDeclared(wide, cell, "white-space")).toBe("normal");
  expect(sheetDeclared(narrow, cell, "padding")).toBe("var(--space-1) 0");
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
  expect(
    sheetDeclared(narrow, head.querySelector("th") ?? head, "display"),
  ).toBe("block");
  expect(table.parentElement?.classList.contains("tabular-stacking")).toBe(
    true,
  );
  expect(
    sheetDeclared(wide, table.parentElement ?? table, "container-type"),
  ).toBe("inline-size");
});

test("in a card, a value a finger opens is a finger's height, and between columns it is as it is drawn", () => {
  render(
    <Table
      caption="Runners"
      stacked={{
        columns: [{ key: "seen", label: "Seen", rowHeader: true }],
        rows: [
          { key: "one", cells: { seen: <span tabIndex={0}>Nov 2</span> } },
        ],
      }}
    />,
  );
  const opened = screen.getByText("Nov 2");
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(narrow, opened, "min-height")).toBe(
    "var(--height-touch)",
  );
  expect(sheetDeclared(narrow, opened, "min-width")).toBe(
    "var(--height-touch)",
  );
  expect(sheetDeclared(sheetRules(tableSheet, []), opened, "min-height")).toBe(
    "",
  );
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

/** Whether jsdom counts a focus as a keyboard's depends on what an earlier case
 * pressed, so the focus is named by an attribute the sheet is read with. */
test("an overflowing scroller focused by keyboard drops the fade that would cut its ring away", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
  const scroller = childrenDrawn();
  const focused = "data-keyboard-focused";
  const rules = sheetRules(
    tableSheet.replaceAll(":focus-visible", `[${focused}]`),
    [],
  );
  expect(sheetDeclared(rules, scroller, "mask-image")).toContain("to left");
  scroller.setAttribute(focused, "");
  expect(sheetDeclared(rules, scroller, "mask-image")).toBe("none");
});

test("a table that has not opted in is drawn inside nothing but its scroller", () => {
  const { container } = render(
    <Table caption="Members">
      <tbody>
        <tr>
          <td>ada</td>
        </tr>
      </tbody>
    </Table>,
  );
  expect(container.children).toHaveLength(1);
  const outermost = container.firstElementChild;
  expect(outermost?.matches(".tabular-scroll")).toBe(true);
  expect(outermost?.firstElementChild).toBe(screen.getByRole("table"));
});

test("an overflowing scroller with no caption is a keyboard stop but no unnamed region", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
  render(
    <Table>
      <tbody>
        <tr>
          <td>linux-1</td>
        </tr>
      </tbody>
    </Table>,
  );
  const scroller = screen.getByRole("table").parentElement;
  expect(scroller?.tabIndex).toBe(0);
  expect(screen.queryByRole("region")).toBeNull();
});

test("a stacked column whose label is hidden names its head to assistive technology only, and its card value draws no label and takes the card's width", () => {
  render(
    <Table
      caption="Runners"
      stacked={{
        columns: [
          { key: "name", label: "Name", rowHeader: true },
          { key: "seen", label: "Seen" },
          { key: "remove", label: "Remove", labelHidden: true },
        ],
        rows: [
          {
            key: "one",
            cells: {
              name: "one",
              seen: "Nov 2",
              remove: <button>Drop</button>,
            },
          },
        ],
      }}
    />,
  );
  const table = screen.getByRole("table", { name: "Runners" });
  const head = within(table).getByRole("columnheader", { name: "Remove" });
  expect(head.querySelector(".visually-hidden")?.textContent).toBe("Remove");
  const [seen, cell] = within(table).getAllByRole("cell");
  expect(cell?.querySelector(".tabular-label")).toBeNull();
  const value = cell?.querySelector(".tabular-value");
  const seenValue = seen?.querySelector(".tabular-value");
  if (value === null || value === undefined)
    throw new Error("the cell drew no value");
  if (seenValue === null || seenValue === undefined)
    throw new Error("the labelled cell drew no value");
  const narrow = sheetRules(tableSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(narrow, value, "grid-column")).toBe("1 / -1");
  expect(sheetDeclared(narrow, seenValue, "grid-column")).toBe("");
  const labelled = within(table).getByRole("rowheader");
  expect(labelled.querySelector(".tabular-label")).toBeNull();
});
