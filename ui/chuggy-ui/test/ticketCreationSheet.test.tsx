/**
 * The ticket form's sheet, as far as a suite with no layout can follow it:
 * read rule by rule and matched against what the form draws. What it holds is
 * that under the narrow width every grid, fieldset, block and hint the form
 * draws can be as narrow as its pane, and that at either width a link or a
 * check is its box and its Remove alone; whether the form then fits is a
 * browser's to say, and one runs in
 * `ui/chuggy-ui/tools/rendered/ticketCreation.spec.ts`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
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
import { SessionProvider } from "../app/browser/session.tsx";
import { holderDouble } from "./screenHarness.tsx";
import { creationMoreOpened } from "./creationMore.ts";

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

/** The form with every row it can draw: a repository, a link and a check, and
 * the disclosure open on two stages. */
function drawEveryRow(): HTMLElement {
  const binding = creationBinding("https://forge.test/acme/atlas.git");
  const form = creationForm(
    {
      links: ["https://forge.test/acme/atlas/issues/1"],
      checks: ["npm test"],
      program: [creationStageOf(1, 1), creationStageOf(2, 1)],
    },
    [binding],
  );
  const { container } = renderCopied(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <div className="creation">
          <CreationFields
            form={form}
            onChange={() => undefined}
            faults={[]}
            offers={[creationOffer(undefined, { commandedCheckStage: 1 })]}
            repositories={[binding]}
            api={{
              ports: answeringApi(() => ({ status: 404, body: {} })).ports,
              partition: creationPartition,
              storeKey: "chug.ticket-yaml.sheet",
            }}
          />
        </div>
      </QueryClientProvider>
    </SessionProvider>,
  );
  creationMoreOpened();
  return container;
}

test("every grid the sheet lays the form out in can narrow to its pane", () => {
  const container = drawEveryRow();
  const gridded = Array.from(container.querySelectorAll("*")).filter(
    (element) => narrowDeclared(element, "grid-template-columns") !== "",
  );
  const link = screen.getByRole("textbox", { name: "Link 1" });
  const stage = screen.getAllByRole("combobox")[0];
  for (const field of [link, stage])
    expect(gridded).toContain(
      field?.closest(".creation-line, .creation-stage"),
    );
  for (const column of container.querySelectorAll(
    ".creation-fields, .creation-at, .creation-group",
  ))
    expect(gridded).not.toContain(column);
  for (const element of gridded)
    for (const track of tracks(
      narrowDeclared(element, "grid-template-columns"),
    ))
      expect(tracksShrinkable, element.className).toContain(track);
});

test("every fieldset, and every block a column of the form holds, may be narrower than its own default", () => {
  const container = drawEveryRow();
  const blocks = Array.from(
    container.querySelectorAll(
      "fieldset, :is(.creation-fields, .creation-at, .creation-groups, .creation-group) > *",
    ),
  );
  expect(blocks.map((block) => block.tagName)).toEqual(
    expect.arrayContaining(["FIELDSET", "DIV", "SECTION"]),
  );
  for (const block of blocks)
    expect(narrowDeclared(block, "min-width"), block.outerHTML).toBe("0px");
});

test("a hint stands in the one column a narrow row keeps", () => {
  const container = drawEveryRow();
  const hints = Array.from(container.querySelectorAll(".creation-hint"));
  expect(hints.length).toBeGreaterThan(0);
  for (const hint of hints)
    expect(narrowDeclared(hint, "grid-column"), hint.textContent).toBe(
      "1 / -1",
    );
});

test.each([
  { width: "wide", rules: rulesWide },
  { width: "narrow", rules: rulesNarrow },
])(
  "a link or a check is its box and its Remove alone ($width)",
  ({ rules }) => {
    drawEveryRow();
    for (const name of ["Link 1", "Check 1"]) {
      const line = screen
        .getByRole("textbox", { name })
        .closest(".creation-line");
      expect(line).not.toBeNull();
      if (line === null) continue;
      expect(
        tracks(sheetDeclared(rules, line, "grid-template-columns")),
        name,
      ).toEqual(["minmax(0, 1fr)", "auto"]);
    }
  },
);
