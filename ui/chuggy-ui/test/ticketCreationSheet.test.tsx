/**
 * The ticket form's sheet, as far as a suite with no layout can follow it:
 * read rule by rule and matched against what the form draws. What it holds is
 * that under the narrow width every row, field and hint the form draws can be
 * as narrow as its pane, and that at either width a link or a check is its box
 * and its Remove alone; whether the form then fits is a browser's to say, and
 * no suite here runs one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import sheetText from "../app/browser/TicketCreation.css?raw";
import { CreationFields } from "../app/browser/TicketCreation.tsx";
import { creationStageOf } from "../app/core/ticketCreation.ts";
import {
  creationBinding,
  creationForm,
  creationInitialization,
  creationSummary,
} from "./ticketCreationFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The container query the console's narrow width is, as tokens.css names it. */
const narrowCondition = "(max-width: 40em)";

/** A track that can give up all of its width: a share of what is left with no
 * floor, or one sized by content that can itself narrow. */
const tracksShrinkable = ["minmax(0, 1fr)", "auto"];

/** Every style rule in the sheet that holds at one width, in source order:
 * those outside any container query, and under the narrow width those inside
 * the narrow one as well. */
function sheetRules(narrow: boolean): readonly CSSStyleRule[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(sheetText);
  const rules: CSSStyleRule[] = [];
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) rules.push(rule);
      else if (rule instanceof CSSContainerRule) {
        if (narrow && rule.conditionText === narrowCondition)
          walk(rule.cssRules);
      } else if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
    }
  };
  walk(sheet.cssRules);
  return rules;
}

const rulesWide = sheetRules(false);
const rulesNarrow = sheetRules(true);

/**
 * What the sheet declares for one element at one width: the last matching
 * declaration in source order. Every rule here that competes for a property is
 * one class against one class, so their order is the cascade.
 */
function declaredAt(
  rules: readonly CSSStyleRule[],
  element: Element,
  property: string,
): string {
  let declared = "";
  for (const rule of rules) {
    const value = rule.style.getPropertyValue(property);
    if (value !== "" && element.matches(rule.selectorText)) declared = value;
  }
  return declared;
}

function narrowDeclared(element: Element, property: string): string {
  return declaredAt(rulesNarrow, element, property);
}

/** Tracks split at the spaces outside any brackets. */
function tracks(template: string): readonly string[] {
  const found: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of template) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === " " && depth === 0) {
      found.push(current);
      current = "";
    } else current += character;
  }
  return [...found, current].filter((track) => track !== "");
}

/** The form with every row it can draw: a repository, a link and a check, the
 * locked dependencies an edit draws, and the Advanced section open on two
 * stages. */
function drawEveryRow(dependenciesLocked: boolean): HTMLElement {
  const binding = creationBinding("https://forge.test/acme/atlas.git");
  const form = creationForm(
    {
      links: ["https://forge.test/acme/atlas/issues/1"],
      checks: ["npm test"],
      program: [creationStageOf(1, 1), creationStageOf(2, 1)],
    },
    [binding],
  );
  const { container } = render(
    <div className="creation">
      <CreationFields
        form={form}
        onChange={() => undefined}
        faults={[]}
        configuration={creationSummary("r3", "Ready")}
        initialization={{ ...creationInitialization, commandedCheckStage: 1 }}
        repositories={[binding]}
        dependenciesLocked={dependenciesLocked}
      />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  return container;
}

test.each([false, true])(
  "every grid the sheet lays the form out in can narrow to its pane (an edit: %s)",
  (dependenciesLocked) => {
    const container = drawEveryRow(dependenciesLocked);
    const gridded = Array.from(container.querySelectorAll("*")).filter(
      (element) => narrowDeclared(element, "grid-template-columns") !== "",
    );
    const title = screen.getByRole("textbox", { name: "Title" });
    const link = screen.getByRole("textbox", { name: "Link 1" });
    const stage = screen.getAllByRole("combobox")[0];
    for (const field of [title, link, stage])
      expect(gridded).toContain(field?.parentElement);
    for (const element of gridded)
      for (const track of tracks(
        narrowDeclared(element, "grid-template-columns"),
      ))
        expect(tracksShrinkable, element.className).toContain(track);
  },
);

test("every field, and every fieldset of fields, may be narrower than its own default", () => {
  const container = drawEveryRow(false);
  const fields = Array.from(
    container.querySelectorAll(
      "input:not([type=checkbox]), select, textarea, fieldset",
    ),
  );
  expect(fields.map((field) => field.tagName)).toEqual(
    expect.arrayContaining(["INPUT", "SELECT", "TEXTAREA", "FIELDSET"]),
  );
  for (const field of fields)
    expect(narrowDeclared(field, "min-width"), field.outerHTML).toBe("0px");
});

test.each([false, true])(
  "a hint stands in the one column a narrow row keeps (an edit: %s)",
  (dependenciesLocked) => {
    const container = drawEveryRow(dependenciesLocked);
    const hints = Array.from(container.querySelectorAll(".creation-hint"));
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints)
      expect(narrowDeclared(hint, "grid-column"), hint.textContent).toBe(
        "1 / -1",
      );
  },
);

test.each([
  { width: "wide", rules: rulesWide },
  { width: "narrow", rules: rulesNarrow },
])(
  "a link or a check is its box and its Remove alone ($width)",
  ({ rules }) => {
    drawEveryRow(false);
    for (const name of ["Link 1", "Check 1"]) {
      const line = screen.getByRole("textbox", { name }).parentElement;
      expect(line).not.toBeNull();
      if (line === null) continue;
      expect(
        tracks(declaredAt(rules, line, "grid-template-columns")),
        name,
      ).toEqual(["minmax(0, 1fr)", "auto"]);
    }
  },
);
