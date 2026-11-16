/**
 * The project settings editor's draft: the project's overrides as the strings a
 * form holds, and the override set those strings become.
 *
 * AN EMPTY FIELD IS NO OVERRIDE AND NEVER A ZERO. The wire says a project takes
 * the installation default by omitting the field, so a cleared box is an
 * omission here and the effective value beside it is what the project then
 * runs under.
 *
 * THE WRITE REPLACES THE WHOLE OVERRIDE SET, so every override the read
 * returned is written back. The draft holds more than the settings page draws —
 * the base prompt, the limits, the mode, the dispatch mode and the lead's model
 * and effort as read — and the two allowlists and the context age are carried
 * through it unchanged, so an edit to a box the page draws deletes none of them.
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

import {
  sessionEfforts,
  sessionModelUnflagged,
  sessionModelUnspaced,
} from "../../../../src/contract/http.ts";
import type { SessionEffort } from "../../../../src/contract/http.ts";
import { selectorProjectOverridesSchema } from "../../../../src/contract/requests.ts";
import { selectorSettingsConflictResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  SelectorProjectSettingsResponse,
  SelectorSettingsConflictResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData, CopyText } from "./copy.ts";
import { groupedDigits, instantFigure } from "./figures.ts";
import { failureWords } from "./failureWords.ts";

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
  "autoCompactWindow",
] as const;

export type SelectorSettingsLimitName =
  (typeof selectorSettingsLimitNames)[number];

export type SelectorSettingsLimitDraft = Readonly<
  Record<SelectorSettingsLimitName, string>
>;

/** The model and effort overrides the draft holds. */
export const selectorSettingsModelNames = [
  "leadModel",
  "leadEffort",
  "threadModel",
  "threadEffort",
] as const;

export type SelectorSettingsModelName =
  (typeof selectorSettingsModelNames)[number];

export type SelectorSettingsModelDraft = Readonly<
  Record<SelectorSettingsModelName, string>
>;

/** What a thread runs on, each one row of the Models section. */
export const selectorSettingsModelRowNames = [
  "threadModel",
  "threadEffort",
] as const;

export type SelectorSettingsModelRowName =
  (typeof selectorSettingsModelRowNames)[number];

/** The aliases a model row offers; any other name Claude Code takes is typed. */
export const selectorSettingsModelAliases = [
  "opus",
  "sonnet",
  "haiku",
] as const;

/** Whether a row names a model, which is typed, or an effort, which is chosen. */
export function selectorSettingsModelRowIsEffort(
  name: SelectorSettingsModelRowName,
): boolean {
  switch (name) {
    case "threadModel":
      return false;
    case "threadEffort":
      return true;
  }
}

/**
 * The override fields the draft holds as strings. What is carried instead is the
 * rest of what the read returned — the two allowlists and the context age.
 */
export const selectorSettingsEditedNames = [
  "northStar",
  "threadStandingRules",
  "basePrompt",
  "mode",
  "dispatchMode",
  "limits",
  ...selectorSettingsModelNames,
] as const;

/** The override fields the draft holds, as the strings they hold. */
export interface SelectorSettingsDrawn {
  readonly northStar: string;
  readonly threadStandingRules: string;
  readonly basePrompt: string;
  readonly mode: string;
  readonly dispatchMode: string;
  readonly limits: SelectorSettingsLimitDraft;
  readonly models: SelectorSettingsModelDraft;
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
    autoCompactWindow: named("autoCompactWindow"),
  };
}

function selectorSettingsModelDraft(
  overrides: SelectorProjectOverrides,
): SelectorSettingsModelDraft {
  return {
    leadModel: overrides.leadModel ?? "",
    leadEffort: overrides.leadEffort ?? "",
    threadModel: overrides.threadModel ?? "",
    threadEffort: overrides.threadEffort ?? "",
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
    models: selectorSettingsModelDraft(overrides),
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
    autoCompactWindow: rebased("autoCompactWindow"),
  };
}

function selectorSettingsModelsRebased(
  draft: SelectorSettingsDraft,
  arriving: SelectorSettingsDrawn,
): SelectorSettingsModelDraft {
  const rebased = (name: SelectorSettingsModelName): string =>
    draft.models[name] === draft.read.models[name]
      ? arriving.models[name]
      : draft.models[name];
  return {
    leadModel: rebased("leadModel"),
    leadEffort: rebased("leadEffort"),
    threadModel: rebased("threadModel"),
    threadEffort: rebased("threadEffort"),
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
    models: selectorSettingsModelsRebased(draft, arriving),
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
  readonly faults: Readonly<Record<string, Copy>>;
}

/** The word a refused field is marked with, said once so every field says it. */
export const selectorSettingsFaultWord: Copy = {
  id: "settings-threads-fault-invalid",
};

/** What a refused field is marked with: the bound it crossed where the wire's
 * schema names one it includes, the rule a model name broke, and the fault word
 * otherwise. */
function selectorSettingsFaultText(issue: z.core.$ZodIssue): Copy {
  if (issue.code === "too_small" && issue.inclusive === true)
    return {
      id: "settings-threads-fault-at-least",
      args: { min: groupedDigits(Number(issue.minimum)) },
    };
  if (issue.code === "too_big" && issue.inclusive === true)
    return issue.origin === "string"
      ? {
          id: "settings-threads-fault-at-most-characters",
          args: { max: groupedDigits(Number(issue.maximum)) },
        }
      : {
          id: "settings-threads-fault-at-most",
          args: { max: groupedDigits(Number(issue.maximum)) },
        };
  if (issue.code === "invalid_format" && issue.format === "regex") {
    if (issue.pattern === sessionModelUnflagged.toString())
      return { id: "settings-threads-fault-model-flag" };
    if (issue.pattern === sessionModelUnspaced.toString())
      return { id: "settings-threads-fault-model-spaced" };
  }
  return selectorSettingsFaultWord;
}

/** The model and effort rows the draft holds, an empty row being no override. */
function selectorSettingsModels(
  models: SelectorSettingsModelDraft,
): Partial<Record<SelectorSettingsModelName, string>> {
  const held: Partial<Record<SelectorSettingsModelName, string>> = {};
  for (const name of selectorSettingsModelNames)
    if (models[name] !== "") held[name] = models[name];
  return held;
}

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
    ...selectorSettingsModels(draft.models),
  };
  const read = selectorProjectOverridesSchema.safeParse(built);
  if (read.success) return { overrides: read.data, faults: {} };
  const faults: Record<string, Copy> = {};
  for (const issue of read.error.issues)
    faults[issue.path.join(".")] = selectorSettingsFaultText(issue);
  return { overrides: undefined, faults };
}

/** The name a model or effort row is drawn under. */
export function selectorSettingsModelLabel(
  name: SelectorSettingsModelRowName,
): Copy {
  switch (name) {
    case "threadModel":
      return { id: "settings-threads-model-thread-model" };
    case "threadEffort":
      return { id: "settings-threads-model-thread-effort" };
  }
}

/** What one effort reads as. */
export function selectorSettingsEffortLabel(effort: SessionEffort): Copy {
  switch (effort) {
    case "low":
      return { id: "settings-threads-effort-low" };
    case "medium":
      return { id: "settings-threads-effort-medium" };
    case "high":
      return { id: "settings-threads-effort-high" };
    case "xhigh":
      return { id: "settings-threads-effort-xhigh" };
    case "max":
      return { id: "settings-threads-effort-max" };
  }
}

/** What a row reads as at rest: the name or the effort it holds, or Default. */
export function selectorSettingsModelValue(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsModelRowName,
): CopyOrData {
  const value = draft.read.models[name];
  if (value === "") return { id: "settings-threads-default" };
  const effort = sessionEfforts.find((candidate) => candidate === value);
  return effort === undefined ? value : selectorSettingsEffortLabel(effort);
}

/** One model or effort row under what a reader typed or chose, empty being Default. */
export function selectorSettingsModelTyped(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsModelRowName,
  value: string,
): SelectorSettingsDraft {
  return { ...draft, models: { ...draft.models, [name]: value } };
}

/** Whether this draft moved this one model or effort row, which is what marks it. */
export function selectorSettingsModelEdited(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsModelRowName,
): boolean {
  return draft.models[name] !== draft.read.models[name];
}

/** The prose overrides, each of which is one section of the page. */
export const selectorSettingsTextNames = [
  "northStar",
  "threadStandingRules",
] as const;

export type SelectorSettingsTextName =
  (typeof selectorSettingsTextNames)[number];

/** A section is what one press of Edit opens, and only one is open at a time. */
export const selectorSettingsSectionNames = [
  ...selectorSettingsTextNames,
  "models",
] as const;

export type SelectorSettingsSectionName =
  (typeof selectorSettingsSectionNames)[number];

/** What a section is called and, in one line, what setting it holds. */
export interface SelectorSettingsSection {
  readonly title: Copy;
  readonly about: Copy;
}

export function selectorSettingsSection(
  name: SelectorSettingsSectionName,
): SelectorSettingsSection {
  switch (name) {
    case "northStar":
      return {
        title: { id: "settings-threads-section-north-star-title" },
        about: { id: "settings-threads-section-north-star-about" },
      };
    case "threadStandingRules":
      return {
        title: { id: "settings-threads-section-standing-rules-title" },
        about: { id: "settings-threads-section-standing-rules-about" },
      };
    case "models":
      return {
        title: { id: "settings-threads-section-models-title" },
        about: { id: "settings-threads-section-models-about" },
      };
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
  }
}

/** Whether the section stands on the installation's value rather than the
 * project's own, read from the draft so that clearing a box says so at once. */
export function selectorSettingsSectionInherited(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): boolean {
  if (name === "models")
    return selectorSettingsModelRowNames.every(
      (model) => draft.models[model] === "",
    );
  return draft[name] === "";
}

/** The section as if the project had never set it, which is what Reset holds. */
export function selectorSettingsSectionCleared(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): SelectorSettingsDraft {
  if (name === "models")
    return {
      ...draft,
      models: { ...draft.models, threadModel: "", threadEffort: "" },
    };
  return selectorSettingsTextTyped(draft, name, "");
}

/** The section back as the read gave it, which is what Cancel holds. */
export function selectorSettingsSectionRestored(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): SelectorSettingsDraft {
  if (name === "models") return { ...draft, models: draft.read.models };
  return selectorSettingsTextTyped(draft, name, draft.read[name]);
}

/** How many boxes of the section this draft would move, which is what its foot
 * says before a save the reader cannot see the whole of. */
export function selectorSettingsSectionChangedCount(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsSectionName,
): number {
  if (name === "models")
    return selectorSettingsModelRowNames.filter((model) =>
      selectorSettingsModelEdited(draft, model),
    ).length;
  return draft[name] === draft.read[name] ? 0 : 1;
}

/** Whether this text section held an override as of the last read. */
export function selectorSettingsTextOverriddenAtRead(
  draft: SelectorSettingsDraft,
  name: SelectorSettingsTextName,
): boolean {
  return draft.read[name] !== "";
}

/** The settings a write lost its fence to, and who moved them where the route
 * names them; nothing for any other refusal. */
export function selectorSettingsConflictOf(
  failure: ApiFailure | undefined,
): SelectorSettingsConflictResponse | undefined {
  if (failure?.outcome !== "Conflict") return undefined;
  const read = selectorSettingsConflictResponseSchema.safeParse(failure.body);
  return read.success ? read.data : undefined;
}

/** Who moved the revision a write lost its fence to, and when, as one line. */
function selectorSettingsMovedByText(
  movedBy: NonNullable<SelectorSettingsConflictResponse["movedBy"]>,
  nowMs: number,
  text: CopyText,
): string {
  const at = instantFigure(movedBy.recordedAt, nowMs);
  return text({
    id: "settings-threads-conflict-moved-by",
    args: {
      subject: movedBy.administrator.subject,
      time: at.kind === "Instant" ? at.text : "—",
    },
  });
}

/**
 * The line a refused write is drawn as. A conflict is drawn as the revision
 * that moved, or who moved it, and is never retried, because the settings
 * behind it are somebody else's write.
 */
export function selectorSettingsRefusal(
  failure: ApiFailure,
  nowMs: number,
  text: CopyText,
): string {
  const conflict = selectorSettingsConflictOf(failure);
  if (conflict === undefined) return text(failureWords(failure).word);
  if (conflict.movedBy === undefined)
    return text({
      id: "settings-threads-conflict-revision",
      args: { revision: String(conflict.settings.revision) },
    });
  return selectorSettingsMovedByText(conflict.movedBy, nowMs, text);
}
