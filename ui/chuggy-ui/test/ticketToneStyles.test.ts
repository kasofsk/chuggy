import { expect, test } from "vitest";

import listSheet from "../app/browser/ProjectTable.css?raw";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import { phaseTone } from "../app/core/tones.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";

test.each([
  ["Work", "live"],
  ["Evaluation", "evaluation"],
  ["Finalization", "finalization"],
  ["Escalated", "parked"],
  ["Done", "pass"],
] as const)(
  "%s has its own tint in the list and ticket status",
  (phase, tone) => {
    const badge = document.createElement("span");
    badge.className = "ticket-list-state";
    badge.dataset.tone = phaseTone(phase);
    badge.dataset.standing = phase;
    const listRules = sheetRules(listSheet, []);
    expect(sheetDeclared(listRules, badge, "color")).toBe(
      `var(--tone-${tone})`,
    );
    expect(sheetDeclared(listRules, badge, "background")).toBe(
      `var(--wash-${tone})`,
    );

    const status = document.createElement("section");
    status.className = "ticket-status";
    status.dataset.tone = phaseTone(phase);
    const statusRules = sheetRules(ticketSheet, []);
    expect(sheetDeclared(statusRules, status, "background")).toBe(
      `var(--wash-${tone})`,
    );
    expect(sheetDeclared(statusRules, status, "border-color")).toBe(
      `color-mix(in srgb, var(--tone-${tone}) 30%, var(--edge))`,
    );
    expect(
      sheetDeclared(
        sheetRules(tokenSheet, []),
        document.documentElement,
        `--wash-${tone}`,
      ),
    ).toContain(`var(--tone-${tone})`);
  },
);
