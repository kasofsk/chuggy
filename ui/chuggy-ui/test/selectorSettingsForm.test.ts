/**
 * The thread settings draft's own decisions, with no renderer: what a write
 * carries, and what a refused write's conflict carries through to the section.
 */

import { expect, test } from "vitest";

import type { SelectorProjectSettingsResponse } from "../../../src/contract/responses.ts";
import {
  selectorSettingsConflictOf,
  selectorSettingsDraft,
  selectorSettingsModelTyped,
  selectorSettingsTextTyped,
  selectorSettingsRefusal,
  selectorSettingsTextOverriddenAtRead,
  selectorSettingsWrite,
} from "../app/core/selectorSettingsForm.ts";
import type {
  SelectorProjectOverrides,
  SelectorSettingsDraft,
  SelectorSettingsDrawn,
} from "../app/core/selectorSettingsForm.ts";
import { projectPartition } from "./projectFixture.ts";
import { copyTextEn } from "../app/copy/catalog.ts";

const readDrawn: SelectorSettingsDrawn = {
  northStar: "ship the console",
  threadStandingRules: "",
  models: { threadModel: "", threadEffort: "" },
};

function draftOf(
  drawn: Partial<SelectorSettingsDrawn> = {},
): SelectorSettingsDraft {
  return { ...readDrawn, ...drawn, revision: 12, read: readDrawn };
}

const settings: SelectorProjectSettingsResponse = {
  partition: projectPartition,
  revision: 12,
  overrides: { northStar: "ship the console" },
  effective: {
    northStar: "ship the console",
    threadStandingRules: "- You act through your owner's own commands.",
  },
};

/** The route replaces the whole set, so a box the edit never touched goes back
 * on the wire as read. */
test("an edit to one box writes every other override the read returned, as read", () => {
  const overrides: SelectorProjectOverrides = {
    northStar: "ship the console",
    threadStandingRules: "- Ask before deleting.",
    threadModel: "opus",
    threadEffort: "high",
  };
  const read = selectorSettingsDraft({ ...settings, overrides });
  const edited = selectorSettingsModelTyped(
    selectorSettingsTextTyped(read, "northStar", "ship the settings"),
    "threadEffort",
    "max",
  );
  expect(selectorSettingsWrite(edited)).toStrictEqual({
    overrides: {
      ...overrides,
      northStar: "ship the settings",
      threadEffort: "max",
    },
    faults: {},
  });
});

test("a model and an effort are written as the overrides they name, and an empty row as none", () => {
  const written = selectorSettingsWrite(
    draftOf({ models: { threadModel: "claude-opus-5-5", threadEffort: "" } }),
  );
  expect(written.faults).toEqual({});
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
      draftOf({ models: { ...readDrawn.models, threadModel: model } }),
    );
    expect(refused.overrides).toBeUndefined();
    const fault = refused.faults["threadModel"];
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
  expect(
    selectorSettingsTextOverriddenAtRead(draft, "threadStandingRules"),
  ).toBe(false);
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
