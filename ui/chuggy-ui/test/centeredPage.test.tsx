/**
 * The centred page: one level-one title, a `main` only where it is asked for
 * one, and actions that stack primary first on a narrow column.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { CenteredPage } from "../app/browser/ui/CenteredPage.tsx";
import centeredPageSheet from "../app/browser/ui/CenteredPage.css?raw";
import { Button } from "../app/browser/ui/Button.tsx";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

function centeredPageDrawn(landmark: boolean): void {
  render(
    <CenteredPage
      landmark={landmark}
      title="Accept the invitation"
      mark={<span>mark</span>}
      primary={
        <Button variant="primary" onClick={() => undefined}>
          Accept
        </Button>
      }
      secondary={<Button onClick={() => undefined}>Decline</Button>}
    >
      <p>You were invited to the workspace.</p>
    </CenteredPage>,
  );
}

test("the page is one level-one title, after its mark and before its body", () => {
  centeredPageDrawn(true);
  const headings = screen.getAllByRole("heading");
  expect(headings).toHaveLength(1);
  const [title] = headings;
  expect(title?.tagName).toBe("H1");
  expect(title?.textContent).toBe("Accept the invitation");
  const mark = screen.getByText("mark");
  const body = screen.getByText("You were invited to the workspace.");
  expect(
    mark.compareDocumentPosition(title as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(
    (title as Node).compareDocumentPosition(body) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  styleless();
});

test("a page outside a landmark is the main landmark", () => {
  centeredPageDrawn(true);
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("main").contains(screen.getByRole("heading"))).toBe(
    true,
  );
});

test("a page inside a landmark draws none of its own", () => {
  centeredPageDrawn(false);
  expect(screen.queryAllByRole("main")).toHaveLength(0);
  expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
});

test("the primary action is first in the document, before the secondary", () => {
  centeredPageDrawn(true);
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Accept",
    "Decline",
  ]);
});

test("a narrow column stacks the actions full-width, where a wide one rows them", () => {
  centeredPageDrawn(true);
  const wide = sheetRules(centeredPageSheet, []);
  const narrow = sheetRules(centeredPageSheet, [sheetNarrowCondition]);
  const row = document.querySelector(".centered-page-actions");
  expect(row).not.toBeNull();
  if (row === null) return;
  expect(sheetDeclared(wide, row, "flex-direction")).toBe("");
  expect(sheetDeclared(narrow, row, "flex-direction")).toBe("column");
  for (const button of screen.getAllByRole("button")) {
    expect(sheetDeclared(wide, button, "width")).toBe("");
    expect(sheetDeclared(narrow, button, "width")).toBe("100%");
  }
  const column = document.querySelector(".centered-page-column");
  expect(column).not.toBeNull();
  if (column === null) return;
  expect(sheetDeclared(wide, column, "container-type")).toBe("inline-size");
  expect(sheetDeclared(wide, column, "max-width")).toBe("var(--measure)");
});

test("a page with no actions draws no actions row", () => {
  render(<CenteredPage landmark title="Signed out" />);
  expect(document.querySelector(".centered-page-actions")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
