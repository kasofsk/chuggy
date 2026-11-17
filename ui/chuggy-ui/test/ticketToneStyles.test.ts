import { expect, test } from "vitest";

import badgeSheet from "../app/browser/ui/StatusBadge.css?raw";
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
] as const)("%s has its own tint on its status badge", (phase, tone) => {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset["tone"] = phaseTone(phase);
  const badgeRules = sheetRules(badgeSheet, []);
  expect(sheetDeclared(badgeRules, badge, "--status-badge-ink")).toBe(
    `var(--tone-${tone})`,
  );
  expect(sheetDeclared(badgeRules, badge, "--status-badge-ground")).toBe(
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
