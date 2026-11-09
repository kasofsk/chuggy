/**
 * The selector settings draft's own decisions, with no renderer: what a strip
 * press writes, what a limit box parses to, and what a refused write's
 * conflict carries through to the section.
 */

import { expect, test } from "vitest";

import type { SelectorProjectSettingsResponse } from "../../../src/contract/responses.ts";
import {
  selectorSettingsConflictOf,
  selectorSettingsDispatchCell,
  selectorSettingsModeCell,
  selectorSettingsRefusal,
  selectorSettingsTextOverriddenAtRead,
  selectorSettingsWrite,
} from "../app/core/selectorSettingsForm.ts";
import type {
  SelectorSettingsDraft,
  SelectorSettingsDrawn,
} from "../app/core/selectorSettingsForm.ts";
import { leadPartition } from "./leadFixture.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

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
    autoCompactWindow: "",
  },
  models: { leadModel: "", leadEffort: "", threadModel: "", threadEffort: "" },
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
      autoCompactWindow: 200_000,
      concurrentDecisions: 2,
      selectionsPerMinute: 6,
    },
    installationLimits: {
      tokensPerDecision: 200_000,
      millisecondsPerDecision: 900_000,
      toolCallsPerDecision: 40,
      dispatchesPerDecision: 3,
      inputBytesPerDecision: 1_048_576,
      candidatePagesPerDecision: 4,
      autoCompactWindow: 200_000,
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

  for (const written of ["12,00x", "12,00", "1,2345"]) {
    const malformed = selectorSettingsWrite(
      draftOf({
        limits: { ...readDrawn.limits, tokensPerDecision: written },
      }),
    );
    expect(malformed.overrides).toBeUndefined();
    const fault = malformed.faults["limits.tokensPerDecision"];
    expect(fault === undefined ? undefined : copyTextEn(fault)).toBe("Invalid");
  }
});

test("a model and an effort are written as the overrides they name, and an empty row as none", () => {
  const written = selectorSettingsWrite(
    draftOf({
      models: {
        leadModel: "sonnet",
        leadEffort: "medium",
        threadModel: "claude-opus-5-5",
        threadEffort: "",
      },
    }),
  );
  expect(written.faults).toEqual({});
  expect(written.overrides?.leadModel).toBe("sonnet");
  expect(written.overrides?.leadEffort).toBe("medium");
  expect(written.overrides?.threadModel).toBe("claude-opus-5-5");
  expect(
    written.overrides !== undefined && "threadEffort" in written.overrides,
  ).toBe(false);
});

test("a model the wire refuses is marked with why", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["claude opus", "No spaces or control characters"],
    ["claude\topus", "No spaces or control characters"],
    ["-p", "Cannot start with -"],
    ["m".repeat(129), "At most 128 characters"],
  ];
  for (const [model, why] of cases) {
    const refused = selectorSettingsWrite(
      draftOf({ models: { ...readDrawn.models, leadModel: model } }),
    );
    expect(refused.overrides).toBeUndefined();
    const fault = refused.faults["leadModel"];
    expect(fault === undefined ? undefined : copyTextEn(fault)).toBe(why);
  }
});

test("an effort outside the five is refused", () => {
  const refused = selectorSettingsWrite(
    draftOf({ models: { ...readDrawn.models, threadEffort: "ultra" } }),
  );
  expect(refused.overrides).toBeUndefined();
  const fault = refused.faults["threadEffort"];
  expect(fault === undefined ? undefined : copyTextEn(fault)).toBe("Invalid");
});

/** The wire carries no installation prose, so a section's placeholder asks
 * what the read carried, not what the draft holds live. */
test("overridden-at-read reads the read side, not a live edit", () => {
  const draft = draftOf({ northStar: "typed but not saved" });
  expect(selectorSettingsTextOverriddenAtRead(draft, "northStar")).toBe(true);
  expect(selectorSettingsTextOverriddenAtRead(draft, "basePrompt")).toBe(false);
});

/** The route's own nit: `movedBy` reaches the section only through the
 * conflict's own read, and nothing else here would fail if it were dropped. */
test("a conflict carries who moved the revision, when the route names them", () => {
  const answered = selectorSettingsConflictOf({
    outcome: "Conflict",
    code: "SettingsRevisionConflict",
    body: {
      settings,
      movedBy: {
        administrator: { kind: "member", subject: "dave@vteng.io" },
        recordedAt: "2026-09-05T17:20:00.000Z",
      },
    },
  });
  if (answered === undefined) throw new Error("expected a conflict");
  expect(answered.movedBy?.administrator.subject).toBe("dave@vteng.io");
});

/** Revision zero has no history row, so a conflict against it names nobody. */
test("a conflict with no history row carries no mover", () => {
  const answered = selectorSettingsConflictOf({
    outcome: "Conflict",
    code: "SettingsRevisionConflict",
    body: { settings },
  });
  if (answered === undefined) throw new Error("expected a conflict");
  expect(answered.movedBy).toBeUndefined();
});

/** A refused write is drawn as one line, which is also what a reader who left
 * the page is told. */
test("a refusal is the conflict's revision, its mover, or the failure's word", () => {
  const nowMs = Date.parse("2026-09-05T18:00:00.000Z");
  const conflict = {
    outcome: "Conflict",
    code: "SettingsRevisionConflict",
  } as const;
  expect(
    selectorSettingsRefusal(
      { ...conflict, body: { settings } },
      nowMs,
      copyTextEn,
    ),
  ).toBe(`Conflict · ${String(settings.revision)}`);
  expect(
    selectorSettingsRefusal(
      {
        ...conflict,
        body: {
          settings,
          movedBy: {
            administrator: { kind: "member", subject: "dave@vteng.io" },
            recordedAt: "2026-09-05T17:20:00.000Z",
          },
        },
      },
      nowMs,
      copyTextEn,
    ),
  ).toMatch(/^Changed by dave@vteng\.io at \S/u);
  expect(
    selectorSettingsRefusal(
      { ...conflict, body: undefined },
      nowMs,
      copyTextEn,
    ),
  ).toBe("Refused");
});
