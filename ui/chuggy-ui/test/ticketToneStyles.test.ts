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

test.each([
  ["work", "live"],
  ["evaluation", "evaluation"],
  ["finalization", "finalization"],
] as const)(
  "the %s configuration is tinted by the phase it runs in",
  (stage, tone) => {
    const section = document.createElement("section");
    section.className = "ticket-config-sub";
    section.dataset["stage"] = stage;
    const rules = sheetRules(ticketSheet, []);
    expect(sheetDeclared(rules, section, "--stage-wash")).toBe(
      `var(--wash-${tone})`,
    );
    expect(sheetDeclared(rules, section, "--stage-tone")).toBe(
      `var(--tone-${tone})`,
    );
    expect(toneWashed(tone)).toContain(`var(--tone-${tone})`);
  },
);

test("the status bar is the plain panel whatever the ticket's phase", () => {
  const status = document.createElement("section");
  status.className = "ticket-status";
  status.dataset["tone"] = phaseTone("Work");
  expect(sheetDeclared(sheetRules(ticketSheet, []), status, "background")).toBe(
    "var(--surface-1)",
  );
});
