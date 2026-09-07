/**
 * The selector settings draft's own decisions, with no renderer: what a strip
 * press writes, what a limit box parses to, and which rows the wire's own
 * installation default is known for.
 */

import { expect, test } from "vitest";

import type { SelectorProjectSettingsResponse } from "../../../src/contract/responses.ts";
import {
  selectorSettingsDispatchCell,
  selectorSettingsLimitOverriddenAtRead,
  selectorSettingsModeCell,
  selectorSettingsTextOverriddenAtRead,
  selectorSettingsWrite,
} from "../app/core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsDrawn,
} from "../app/core/selectorSettingsForm.ts";
import { leadPartition } from "./leadFixture.ts";

const readDrawn: SelectorSettingsDrawn = {
  northStar: "ship the console",
  threadStandingRules: "",
  basePrompt: "",
  mode: "",
  dispatchMode: "",
  limits: {
    tokensPerDecision: "200000",
    millisecondsPerDecision: "",
    toolCallsPerDecision: "",
    dispatchesPerDecision: "",
    inputBytesPerDecision: "",
    candidatePagesPerDecision: "",
  },
};

function draftOf(
  drawn: Partial<SelectorSettingsDrawn> = {},
): SelectorSettingsDraft {
  return {
    ...readDrawn,
    ...drawn,
    revision: 12,
    carried: { toolAllowlist: ["Read"] },
    read: readDrawn,
  };
}

const settings: SelectorProjectSettingsResponse = {
  partition: leadPartition,
  revision: 12,
  overrides: { northStar: "ship the console" },
  effective: {
    revision: 12,
    projectRevision: 12,
    mode: "Running",
    installationMode: "Running",
    dispatchMode: "Automatic",
    basePrompt: "choose the next ticket",
    northStar: "ship the console",
    threadStandingRules: "- You act through your owner's own commands.",
    modelAllowlist: [],
    toolAllowlist: [],
    limits: {
      tokensPerDecision: 200_000,
      millisecondsPerDecision: 900_000,
      toolCallsPerDecision: 40,
      dispatchesPerDecision: 3,
      inputBytesPerDecision: 1_048_576,
      candidatePagesPerDecision: 4,
      concurrentDecisions: 2,
      selectionsPerMinute: 6,
    },
    operationalContextMaxAgeMs: 60_000,
  },
};

/** A press must carry the SAVED override set plus the one field it moves,
 * never an open section's unsaved text — the draft holds both, so a cell that
 * spread the live draft instead of the read would leak whatever another
 * section is mid-edit on. */
test("a mode press is built from the read, not an open section's unsaved text", () => {
  const draft = draftOf({ northStar: "SECRET UNSAVED DRAFT" });
  const cell = selectorSettingsModeCell(draft, settings);
  expect(cell.pressed.northStar).toBe("ship the console");
  expect(cell.pressed.mode).toBe("Paused");
});

test("a dispatch press is built from the read, not an open section's unsaved text", () => {
  const draft = draftOf({ basePrompt: "SECRET UNSAVED DRAFT" });
  const cell = selectorSettingsDispatchCell(draft, settings);
  expect(cell.pressed.basePrompt).toBe("");
  expect(cell.pressed.dispatchMode).toBe("ApprovalRequired");
});

/** A limit typed with grouped digits is the same value as its bare digits. */
test("a limit accepts grouped digits and refuses anything else", () => {
  const grouped = selectorSettingsWrite(
    draftOf({
      limits: { ...readDrawn.limits, tokensPerDecision: "12,000" },
    }),
  );
  expect(grouped.overrides?.limits?.tokensPerDecision).toBe(12_000);

  const malformed = selectorSettingsWrite(
    draftOf({
      limits: { ...readDrawn.limits, tokensPerDecision: "12,00x" },
    }),
  );
  expect(malformed.overrides).toBeUndefined();
  expect(malformed.faults["limits.tokensPerDecision"]).toBe("Invalid");
});

/** The wire carries no installation limit or prose, so the fact these ask for
 * is what the read carried, not what the draft holds live. */
test("overridden-at-read reads the read side, not a live edit", () => {
  const draft = draftOf({ northStar: "typed but not saved" });
  expect(selectorSettingsTextOverriddenAtRead(draft, "northStar")).toBe(true);
  expect(selectorSettingsTextOverriddenAtRead(draft, "basePrompt")).toBe(false);
  expect(
    selectorSettingsLimitOverriddenAtRead(draft, "tokensPerDecision"),
  ).toBe(true);
  expect(
    selectorSettingsLimitOverriddenAtRead(draft, "millisecondsPerDecision"),
  ).toBe(false);
});
