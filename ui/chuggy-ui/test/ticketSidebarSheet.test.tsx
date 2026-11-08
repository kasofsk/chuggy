/**
 * The ticket page's sheet where a value meets its cell and a draft its label,
 * as far as a suite with no layout can follow it: a sidebar value, an identity
 * and a branch among them, wraps within its cell at either width, and the
 * Draft label is outlined rather than toned.
 */

import { cleanup } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, expect, test } from "vitest";

import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import { TicketStateLabel } from "../app/browser/ticket/TicketStateLabel.tsx";
import { Field, Fields } from "../app/browser/ui/Fields.tsx";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";

afterEach(cleanup);

function drawnElement(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`nothing drawn at ${selector}`);
  return element;
}

test.each([
  ["wide", []],
  ["narrow", [sheetNarrowCondition]],
] as const)(
  "a sidebar value wraps within its cell at the %s width, however long and unbroken",
  (_width, conditions) => {
    renderCopied(
      <aside className="ticket-sidebar">
        <Fields>
          <Field name="Filed by">
            <code className="identity">dave.longname@engineering.vteng.io</code>
          </Field>
        </Fields>
      </aside>,
    );
    const rules = sheetRules(ticketSheet, conditions);
    const field = drawnElement(".ticket-sidebar .field");
    const value = drawnElement(".ticket-sidebar dd");
    expect(sheetDeclared(rules, field, "min-width")).toBe("0px");
    expect(sheetDeclared(rules, value, "min-width")).toBe("0px");
    expect(sheetDeclared(rules, value, "overflow-wrap")).toBe("anywhere");
    expect(
      sheetDeclared(rules, drawnElement("dd .identity"), "white-space"),
    ).toBe("normal");
  },
);

test("the Draft label is a dashed edge in the control edge colour, in secondary ink, on no ground", () => {
  renderCopied(<TicketStateLabel standing="Draft" size="page" />);
  const label = drawnElement(".ticket-state");
  const rules = sheetRules(ticketSheet, []);
  expect(sheetDeclared(rules, label, "border")).toBe(
    "var(--hairline) dashed var(--edge-control)",
  );
  expect(sheetDeclared(rules, label, "color")).toBe("var(--ink-2)");
  expect(sheetDeclared(rules, label, "background")).toBe("transparent");
});
