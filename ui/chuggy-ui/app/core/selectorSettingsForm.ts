/**
 * The North Star editor's draft: the project's overrides as the strings a form
 * holds, and the override set those strings become.
 *
 * AN EMPTY FIELD IS NO OVERRIDE AND NEVER A ZERO. The wire says a project takes
 * the installation default by omitting the field, so a cleared box is an
 * omission here and the effective value beside it is what the project then
 * runs under.
 *
 * THE WRITE REPLACES THE WHOLE OVERRIDE SET, so an override the form draws no
 * box for is carried through it unchanged. The fields this form owns are named
 * once below and everything else the read returned rides along, which is what
 * keeps an allowlist nobody can see here from being deleted by an edit to the
 * North Star.
 *
 * The wire's own parser decides what is writable. A field it rejects is named
 * by its path rather than judged again here, because a second account of what
 * the route accepts is the account that drifts.
 */

import { z } from "zod";

import { selectorProjectOverridesSchema } from "../../../../src/contract/requests.ts";
import { selectorProjectSettingsResponseSchema } from "../../../../src/contract/responses.ts";
import type { SelectorProjectSettingsResponse } from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

export type SelectorProjectOverrides = z.infer<
  typeof selectorProjectOverridesSchema
>;

/** The limits one project may set for itself, which is every one the wire
 * admits in an override. */
export const selectorSettingsLimitNames = [
  "tokensPerDecision",
  "millisecondsPerDecision",
  "toolCallsPerDecision",
  "inputBytesPerDecision",
  "candidatePagesPerDecision",
] as const;

export type SelectorSettingsLimitName =
  (typeof selectorSettingsLimitNames)[number];

export type SelectorSettingsLimitDraft = Readonly<
  Record<SelectorSettingsLimitName, string>
>;

/**
 * The override fields this form draws a box for. Everything else the read
 * returned is carried, so a field the wire grows is preserved by a console that
 * has never heard of it.
 */
export const selectorSettingsEditedNames = [
  "northStar",
  "basePrompt",
  "mode",
  "dispatchMode",
  "limits",
] as const;

/** What the form holds, under the revision it was read at, beside the overrides
 * it does not draw and must not drop. */
export interface SelectorSettingsDraft {
  readonly revision: number;
  readonly northStar: string;
  readonly basePrompt: string;
  readonly mode: string;
  readonly dispatchMode: string;
  readonly limits: SelectorSettingsLimitDraft;
  readonly carried: SelectorProjectOverrides;
}

function selectorSettingsLimitDraft(
  limits: SelectorProjectOverrides["limits"],
): SelectorSettingsLimitDraft {
  const named = (name: SelectorSettingsLimitName): string => {
    const value = limits?.[name];
    return value === undefined ? "" : String(value);
  };
  return {
    tokensPerDecision: named("tokensPerDecision"),
    millisecondsPerDecision: named("millisecondsPerDecision"),
    toolCallsPerDecision: named("toolCallsPerDecision"),
    inputBytesPerDecision: named("inputBytesPerDecision"),
    candidatePagesPerDecision: named("candidatePagesPerDecision"),
  };
}

/** Everything the read returned that this form draws no box for. */
function selectorSettingsCarried(
  overrides: SelectorProjectOverrides,
): SelectorProjectOverrides {
  const carried = { ...overrides };
  for (const name of selectorSettingsEditedNames) delete carried[name];
  return carried;
}

/** The settings as the form holds them, an absent override being an empty box. */
export function selectorSettingsDraft(
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsDraft {
  const overrides = settings.overrides;
  return {
    revision: settings.revision,
    northStar: overrides.northStar ?? "",
    basePrompt: overrides.basePrompt ?? "",
    mode: overrides.mode ?? "",
    dispatchMode: overrides.dispatchMode ?? "",
    limits: selectorSettingsLimitDraft(overrides.limits),
    carried: selectorSettingsCarried(overrides),
  };
}

/** The draft under a revision the route has since answered with, keeping what
 * the reader has typed and taking everything they did not. */
export function selectorSettingsRebased(
  draft: SelectorSettingsDraft,
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsDraft {
  return {
    ...draft,
    revision: settings.revision,
    carried: selectorSettingsCarried(settings.overrides),
  };
}

function selectorSettingsLimits(
  limits: SelectorSettingsLimitDraft,
): Record<string, number> | undefined {
  const held: Record<string, number> = {};
  for (const name of selectorSettingsLimitNames) {
    const written = limits[name].trim();
    if (written === "") continue;
    held[name] = Number(written);
  }
  return Object.keys(held).length === 0 ? undefined : held;
}

/** The draft as the body the route takes, or the fields the wire refused. */
export interface SelectorSettingsWrite {
  readonly overrides: SelectorProjectOverrides | undefined;
  readonly faults: Readonly<Record<string, string>>;
}

/** The word a refused field is marked with, said once so every field says it. */
export const selectorSettingsFaultWord = "Invalid";

/**
 * The override set the draft stands for, read by the wire's own schema. A field
 * the schema refuses is named by its own path, so the box that is wrong is the
 * box that is marked.
 */
export function selectorSettingsWrite(
  draft: SelectorSettingsDraft,
): SelectorSettingsWrite {
  const limits = selectorSettingsLimits(draft.limits);
  const built = {
    ...draft.carried,
    ...(draft.northStar.trim() === "" ? {} : { northStar: draft.northStar }),
    ...(draft.basePrompt.trim() === "" ? {} : { basePrompt: draft.basePrompt }),
    ...(draft.mode === "" ? {} : { mode: draft.mode }),
    ...(draft.dispatchMode === "" ? {} : { dispatchMode: draft.dispatchMode }),
    ...(limits === undefined ? {} : { limits }),
  };
  const read = selectorProjectOverridesSchema.safeParse(built);
  if (read.success) return { overrides: read.data, faults: {} };
  const faults: Record<string, string> = {};
  for (const issue of read.error.issues)
    faults[issue.path.join(".")] = selectorSettingsFaultWord;
  return { overrides: undefined, faults };
}

/** The name a limit is drawn under, which is the noun and not the wire's key. */
export function selectorSettingsLimitLabel(
  name: SelectorSettingsLimitName,
): string {
  switch (name) {
    case "tokensPerDecision":
      return "Tokens";
    case "millisecondsPerDecision":
      return "Milliseconds";
    case "toolCallsPerDecision":
      return "Tool calls";
    case "inputBytesPerDecision":
      return "Input bytes";
    case "candidatePagesPerDecision":
      return "Candidate pages";
  }
}

/**
 * Where the last write stands, which is the one line the form says. Both
 * answers that moved the revision carry the settings behind it, because the
 * read the page holds is now stale and the next write has to be made against
 * what the route just said is there.
 */
export type SelectorSettingsSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | {
      readonly saved: "Written";
      readonly revision: number;
      readonly settings: SelectorProjectSettingsResponse;
    }
  | {
      readonly saved: "Conflict";
      readonly revision: number;
      readonly settings: SelectorProjectSettingsResponse;
    }
  | { readonly saved: "Failed"; readonly reason: string };

/** What a revision conflict carries beside its code: the settings that moved. */
const selectorSettingsConflictSchema = z.object({
  settings: selectorProjectSettingsResponseSchema,
});

/**
 * What the write answered. A conflict is drawn as the revision that moved and
 * is never retried, because the settings behind it are somebody else's write.
 */
export function selectorSettingsAnswered(
  result: ApiResult<SelectorProjectSettingsResponse>,
): SelectorSettingsSaved {
  if (result.outcome === "Ok")
    return {
      saved: "Written",
      revision: result.value.revision,
      settings: result.value,
    };
  if (result.outcome === "Conflict") {
    const read = selectorSettingsConflictSchema.safeParse(result.body);
    if (read.success)
      return {
        saved: "Conflict",
        revision: read.data.settings.revision,
        settings: read.data.settings,
      };
  }
  return { saved: "Failed", reason: panelReason(result) };
}
