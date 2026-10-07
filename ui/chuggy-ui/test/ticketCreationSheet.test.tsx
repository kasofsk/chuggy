/**
 * The ticket form's sheet, as far as a suite with no layout can follow it:
 * read rule by rule and matched against what the form draws. What it holds is
 * that under the narrow width every row, field and hint the form draws can be
 * as narrow as its pane, and that at either width a link or a check is its box
 * and its Remove alone; whether the form then fits is a browser's to say, and
 * no suite here runs one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import sheetText from "../app/browser/TicketCreation.css?raw";
import { CreationFields } from "../app/browser/TicketCreation.tsx";
import { creationStageOf } from "../app/core/ticketCreation.ts";
import {
  creationBinding,
  creationForm,
  creationOffer,
  creationPartition,
} from "./ticketCreationFixture.ts";
import { answeringApi } from "./answeringApi.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A track that can give up all of its width: a share of what is left with no
 * floor, or one sized by content that can itself narrow. */
const tracksShrinkable = ["minmax(0, 1fr)", "auto"];

const rulesWide = sheetRules(sheetText, []);
const rulesNarrow = sheetRules(sheetText, [sheetNarrowCondition]);

function narrowDeclared(element: Element, property: string): string {
  return sheetDeclared(rulesNarrow, element, property);
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
    <QueryClientProvider client={new QueryClient()}>
      <div className="creation">
        <CreationFields
          form={form}
          onChange={() => undefined}
          faults={[]}
          offers={[creationOffer(undefined, { commandedCheckStage: 1 })]}
          repositories={[binding]}
          dependenciesLocked={dependenciesLocked}
          api={{
            ports: answeringApi(() => ({ status: 404, body: {} })).ports,
            partition: creationPartition,
          }}
        />
      </div>
    </QueryClientProvider>,
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
        tracks(sheetDeclared(rules, line, "grid-template-columns")),
        name,
      ).toEqual(["minmax(0, 1fr)", "auto"]);
    }
  },
);
