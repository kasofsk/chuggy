import { expect, test } from "vitest";

import listSheet from "../app/browser/ProjectTable.css?raw";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import { phaseTone } from "../app/core/tones.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";

function toneWashed(tone: string): string | undefined {
  return sheetDeclared(
    sheetRules(tokenSheet, []),
    document.documentElement,
    `--wash-${tone}`,
  );
}

test.each([
  ["Work", "live"],
  ["Evaluation", "evaluation"],
  ["Finalization", "finalization"],
  ["Escalated", "parked"],
  ["Done", "pass"],
] as const)("%s has its own tint in the list", (phase, tone) => {
  const badge = document.createElement("span");
  badge.className = "ticket-list-state";
  badge.dataset["tone"] = phaseTone(phase);
  badge.dataset["standing"] = phase;
  const listRules = sheetRules(listSheet, []);
  expect(sheetDeclared(listRules, badge, "color")).toBe(`var(--tone-${tone})`);
  expect(sheetDeclared(listRules, badge, "background")).toBe(
    `var(--wash-${tone})`,
  );
  expect(toneWashed(tone)).toContain(`var(--tone-${tone})`);
});

test.each(["live", "evaluation", "finalization", "parked"] as const)(
  "a steps column's top edge takes the %s tone it is given, and the plain edge where it is given none",
  (tone) => {
    const column = document.createElement("div");
    column.className = "ticket-steps-column";
    const rules = sheetRules(ticketSheet, []);
    expect(sheetDeclared(rules, column, "--steps-edge")).toBe("var(--edge)");
    column.dataset["edge"] = tone;
    expect(sheetDeclared(rules, column, "--steps-edge")).toBe(
      `var(--tone-${tone})`,
    );
  },
);
