/**
 * The project settings editor's draft: the project's overrides as the strings a
 * form holds, and the override set those strings become.
 *
 * AN EMPTY FIELD IS NO OVERRIDE AND NEVER A ZERO. The wire says a project takes
 * the installation default by omitting the field, so a cleared box is an
 * omission here and the effective value beside it is what the project then
 * runs under.
 *
 * THE WRITE REPLACES THE WHOLE OVERRIDE SET, so the three overrides this form
 * draws no box for — the two allowlists and the context age — are carried
 * through it unchanged rather than deleted by an edit to a box it draws.
 *
 * A BOX THE READER HAS TOUCHED IS THEIRS AND EVERY OTHER BOX FOLLOWS THE READ.
 * The draft holds what the read gave beside what is held, so the two can be
 * compared: when the settings move under an open form — a conflict, or a
 * refetch — an edited box keeps its text and an untouched one takes the value
 * that now stands. Carrying every drawn field forward instead would write this
 * reader's stale copy of another administrator's North Star back over it, under
 * a revision that by then matches, which is the one thing `expectedRevision`
 * exists to prevent.
 *
 * The wire's own parser decides what is writable. A field it rejects is named
 * by its path rather than judged again here, because a second account of what
 * the route accepts is the account that drifts.
 */

import type { z } from "zod";

import { selectorProjectOverridesSchema } from "../../../../src/contract/requests.ts";
import { selectorSettingsConflictResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  SelectorProjectSettingsResponse,
  SelectorSettingsConflictResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiResult } from "./apiRequest.ts";
import { bytesSetFigure, countFigure, spanSetFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";
import { panelReason } from "./freshness.ts";
import { selectorModeTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

export type SelectorProjectOverrides = z.infer<
  typeof selectorProjectOverridesSchema
>;

/** The limits one project may set for itself, which is every one the wire
 * admits in an override. */
export const selectorSettingsLimitNames = [
  "tokensPerDecision",
  "millisecondsPerDecision",
  "toolCallsPerDecision",
  "dispatchesPerDecision",
  "inputBytesPerDecision",
  "candidatePagesPerDecision",
] as const;

export type SelectorSettingsLimitName =
  (typeof selectorSettingsLimitNames)[number];

export type SelectorSettingsLimitDraft = Readonly<
  Record<SelectorSettingsLimitName, string>
>;

/**
 * The override fields this form draws a box for. What is carried instead is the
 * rest of what the read returned — the two allowlists and the context age.
 */
export const selectorSettingsEditedNames = [
  "northStar",
  "threadStandingRules",
  "basePrompt",
  "mode",
  "dispatchMode",
  "limits",
] as const;

/** The boxes this form draws, as the strings they hold. */
export interface SelectorSettingsDrawn {
  readonly northStar: string;
  readonly threadStandingRules: string;
  readonly basePrompt: string;
  readonly mode: string;
  readonly dispatchMode: string;
  readonly limits: SelectorSettingsLimitDraft;
}

/**
 * What the form holds, under the revision it was read at, beside the overrides
 * it does not draw and must not drop and the values the read gave for the ones
 * it does — which is how an edited box is told from an untouched one.
 */
export interface SelectorSettingsDraft extends SelectorSettingsDrawn {
  readonly revision: number;
  readonly carried: SelectorProjectOverrides;
  readonly read: SelectorSettingsDrawn;
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
    dispatchesPerDecision: named("dispatchesPerDecision"),
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

/** The boxes as the read gave them, an absent override being an empty one. */
function selectorSettingsDrawn(
  overrides: SelectorProjectOverrides,
): SelectorSettingsDrawn {
  return {
    northStar: overrides.northStar ?? "",
    threadStandingRules: overrides.threadStandingRules ?? "",
    basePrompt: overrides.basePrompt ?? "",
    mode: overrides.mode ?? "",
    dispatchMode: overrides.dispatchMode ?? "",
    limits: selectorSettingsLimitDraft(overrides.limits),
  };
}

/** The settings as the form holds them, an absent override being an empty box. */
export function selectorSettingsDraft(
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsDraft {
  const drawn = selectorSettingsDrawn(settings.overrides);
  return {
    ...drawn,
    revision: settings.revision,
    carried: selectorSettingsCarried(settings.overrides),
    read: drawn,
  };
}

function selectorSettingsLimitsRebased(
  draft: SelectorSettingsDraft,
  arriving: SelectorSettingsDrawn,
): SelectorSettingsLimitDraft {
  const rebased = (name: SelectorSettingsLimitName): string =>
    draft.limits[name] === draft.read.limits[name]
      ? arriving.limits[name]
      : draft.limits[name];
  return {
    tokensPerDecision: rebased("tokensPerDecision"),
    millisecondsPerDecision: rebased("millisecondsPerDecision"),
    toolCallsPerDecision: rebased("toolCallsPerDecision"),
    dispatchesPerDecision: rebased("dispatchesPerDecision"),
    inputBytesPerDecision: rebased("inputBytesPerDecision"),
    candidatePagesPerDecision: rebased("candidatePagesPerDecision"),
  };
}

/**
 * The draft under settings the route has since answered with: a box whose text
 * still equals what the read gave takes the arriving value, and one the reader
 * changed keeps theirs. The arriving values become the new comparison, so a box
 * the write accepted stops reading as edited.
 */
export function selectorSettingsRebased(
  draft: SelectorSettingsDraft,
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsDraft {
  const arriving = selectorSettingsDrawn(settings.overrides);
  const kept = (
    name:
      | "northStar"
      | "threadStandingRules"
      | "basePrompt"
      | "mode"
      | "dispatchMode",
  ) => (draft[name] === draft.read[name] ? arriving[name] : draft[name]);
  return {
    northStar: kept("northStar"),
    threadStandingRules: kept("threadStandingRules"),
    basePrompt: kept("basePrompt"),
    mode: kept("mode"),
    dispatchMode: kept("dispatchMode"),
    limits: selectorSettingsLimitsRebased(draft, arriving),
    revision: settings.revision,
    carried: selectorSettingsCarried(settings.overrides),
    read: arriving,
  };
}

/** Bare digits, or digits grouped in threes, as the number the wire reads;
 * `NaN` for anything else, so the wire's own schema is what refuses it. */
function selectorSettingsLimitNumber(written: string): number {
  return /^\d+$/.test(written) || /^\d{1,3}(,\d{3})+$/.test(written)
    ? Number(written.replaceAll(",", ""))
    : NaN;
}

function selectorSettingsLimits(
  limits: SelectorSettingsLimitDraft,
): Record<string, number> | undefined {
  const held: Record<string, number> = {};
  for (const name of selectorSettingsLimitNames) {
    const written = limits[name].trim();
    if (written === "") continue;
    held[name] = selectorSettingsLimitNumber(written);
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
    ...(draft.threadStandingRules.trim() === ""
      ? {}
      : { threadStandingRules: draft.threadStandingRules }),
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
      return "Time";
    case "toolCallsPerDecision":
      return "Tool calls";
    case "dispatchesPerDecision":
      return "Dispatches";
    case "inputBytesPerDecision":
      return "Input";
    case "candidatePagesPerDecision":
      return "Candidate pages";
  }
}

/**
 * What a limit reads as at rest, in the unit a person states it in. The box
 * beside it holds the wire's own unit instead, which is why
 * `selectorSettingsLimitUnitWord` is a second answer and not this one rounded.
 */
export function selectorSettingsLimitFigure(
  name: SelectorSettingsLimitName,
  value: number,
): Figure {
  switch (name) {
    case "tokensPerDecision":
      return countFigure(value, "tokens");
    case "millisecondsPerDecision":
      return spanSetFigure(value);
    case "toolCallsPerDecision":
      return countFigure(value, "calls");
    case "dispatchesPerDecision":
      return countFigure(value, "tickets");
    case "inputBytesPerDecision":
      return bytesSetFigure(value);
    case "candidatePagesPerDecision":
      return countFigure(value, "pages");
  }
}

/** The unit the box holds, which is the wire's own: a draft is raw digits, so
 * the suffix beside them has to say what the wire will read them as. */
export function selectorSettingsLimitUnitWord(
  name: SelectorSettingsLimitName,
): string {
  switch (name) {
    case "tokensPerDecision":
      return "tokens";
    case "millisecondsPerDecision":
      return "ms";
    case "toolCallsPerDecision":
      return "calls";
    case "dispatchesPerDecision":
      return "tickets";
    case "inputBytesPerDecision":
      return "bytes";
    case "candidatePagesPerDecision":
      return "pages";
  }
}

/** The prose overrides, each of which is one section of the page. */
export const selectorSettingsTextNames = [
  "northStar",
  "threadStandingRules",
  "basePrompt",
] as const;

export type SelectorSettingsTextName =
  (typeof selectorSettingsTextNames)[number];

/** A section is what one press of Edit opens, and only one is open at a time. */
export const selectorSettingsSectionNames = [
  ...selectorSettingsTextNames,
  "limits",
] as const;

export type SelectorSettingsSectionName =
  (typeof selectorSettingsSectionNames)[number];

/** What a section is called and, in one line, what setting it holds. */
export interface SelectorSettingsSection {
  readonly title: string;
  readonly about: string;
}

export function selectorSettingsSection(
  name: SelectorSettingsSectionName,
): SelectorSettingsSection {
  switch (name) {
    case "northStar":
      return {
        title: "North Star",
        about:
          "What this project is for. Every lead decision is judged against it.",
      };
    case "threadStandingRules":
      return {
        title: "Standing rules",
        about: "How threads act on this project.",
      };
    case "basePrompt":
      return {
        title: "Base prompt",
        about: "The lead's instructions at the start of every turn.",
      };
    case "limits":
      return { title: "Limits", about: "What one decision may spend." };
  }
}

/** One prose box under the text a reader typed into it. */
export function selectorSettingsTextTyped(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsTextName,
  text: string,
): SelectorSettingsDraft {
  switch (name) {
    case "northStar":
      return { ...draft, northStar: text };
    case "threadStandingRules":
      return { ...draft, threadStandingRules: text };
    case "basePrompt":
      return { ...draft, basePrompt: text };
  }
}

/** One limit box under the digits a reader typed into it. */
export function selectorSettingsLimitTyped(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsLimitName,
  digits: string,
): SelectorSettingsDraft {
  return { ...draft, limits: { ...draft.limits, [name]: digits } };
}

/** Whether the section stands on the installation's value rather than the
 * project's own, read from the draft so that clearing a box says so at once. */
export function selectorSettingsSectionInherited(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): boolean {
  if (name === "limits")
    return selectorSettingsLimitNames.every(
      (limit) => draft.limits[limit] === "",
    );
  return draft[name] === "";
}

/** The section as if the project had never set it, which is what Reset holds. */
export function selectorSettingsSectionCleared(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): SelectorSettingsDraft {
  if (name === "limits")
    return { ...draft, limits: selectorSettingsLimitDraft(undefined) };
  return selectorSettingsTextTyped(draft, name, "");
}

/** The section back as the read gave it, which is what Cancel holds. */
export function selectorSettingsSectionRestored(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): SelectorSettingsDraft {
  if (name === "limits") return { ...draft, limits: draft.read.limits };
  return selectorSettingsTextTyped(draft, name, draft.read[name]);
}

/** How many boxes of the section this draft would move, which is what its foot
 * says before a save the reader cannot see the whole of. */
export function selectorSettingsSectionChangedCount(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): number {
  if (name === "limits")
    return selectorSettingsLimitNames.filter(
      (limit) => draft.limits[limit] !== draft.read.limits[limit],
    ).length;
  return draft[name] === draft.read[name] ? 0 : 1;
}

/** Whether this draft moved this one limit, which is what marks its row. */
export function selectorSettingsLimitEdited(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsLimitName,
): boolean {
  return draft.limits[name] !== draft.read.limits[name];
}

/** Whether this limit's box currently holds an override: live, so a row
 * cleared by Reset reads as on the default at once rather than waiting for
 * the next read. */
export function selectorSettingsLimitOverridden(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsLimitName,
): boolean {
  return draft.limits[name] !== "";
}

/** The text sections' own answer to the same question. */
export function selectorSettingsTextOverriddenAtRead(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsTextName,
): boolean {
  return draft.read[name] !== "";
}

/**
 * One operational fact and the single press that changes it: what the project
 * runs under, whether that is its own or the installation's, and the draft the
 * press writes. There is no edit mode here — the press is the write.
 */
export interface SelectorSettingsStripCell {
  readonly name: string;
  readonly value: string;
  readonly tone: Tone | undefined;
  readonly inherited: boolean;
  readonly action: string;
  readonly pressed: SelectorSettingsDraft;
}

/** The draft a strip press writes from: the read's own boxes, not whatever an
 * open section's edit currently holds — a press here has nothing to do with
 * the section a reader may be mid-edit on. */
function selectorSettingsAtRest(
  draft: SelectorSettingsDraft,
): SelectorSettingsDraft {
  return { ...draft, ...draft.read };
}

/**
 * Whether the selector is deciding for this project. Resume clears the
 * project's override where the installation is running anyway, so a project
 * that was never paused of its own does not acquire an override by being
 * resumed; where the installation is paused it writes Running instead, because
 * clearing there would leave the project paused by inheritance.
 */
export function selectorSettingsModeCell(
  draft: SelectorSettingsDraft,
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsStripCell {
  const effective = settings.effective;
  const running = effective.mode === "Running";
  const resumed = effective.installationMode === "Running" ? "" : "Running";
  return {
    name: "Selector",
    value: effective.mode,
    tone: selectorModeTone(effective.mode),
    inherited: draft.mode === "",
    action: running ? "Pause" : "Resume",
    pressed: {
      ...selectorSettingsAtRest(draft),
      mode: running ? "Paused" : resumed,
    },
  };
}

/** Whether a proposal is dispatched or held for a reviewer. */
export function selectorSettingsDispatchCell(
  draft: SelectorSettingsDraft,
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsStripCell {
  const automatic = settings.effective.dispatchMode === "Automatic";
  return {
    name: "Dispatch",
    value: automatic ? "Automatic" : "Approval",
    tone: undefined,
    inherited: draft.dispatchMode === "",
    action: automatic ? "Require approval" : "Dispatch automatically",
    pressed: {
      ...selectorSettingsAtRest(draft),
      dispatchMode: automatic ? "ApprovalRequired" : "Automatic",
    },
  };
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
      readonly movedBy?: SelectorSettingsConflictResponse["movedBy"];
    }
  | { readonly saved: "Failed"; readonly reason: string };

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
    const read = selectorSettingsConflictResponseSchema.safeParse(result.body);
    if (read.success)
      return {
        saved: "Conflict",
        revision: read.data.settings.revision,
        settings: read.data.settings,
        ...(read.data.movedBy === undefined
          ? {}
          : { movedBy: read.data.movedBy }),
      };
  }
  return { saved: "Failed", reason: panelReason(result) };
}
