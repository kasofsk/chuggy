/**
 * The project settings editor's draft: the project's overrides as the strings a
 * form holds, and the override set those strings become.
 *
 * AN EMPTY FIELD IS NO OVERRIDE. The wire says a project takes the default by
 * omitting the field, so a cleared box is an omission here and the effective
 * value beside it is what the project then runs under.
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

/** The model and effort overrides the draft holds, each one row of the Models section. */
export const selectorSettingsModelRowNames = [
  "threadModel",
  "threadEffort",
] as const;

export type SelectorSettingsModelRowName =
  (typeof selectorSettingsModelRowNames)[number];

export type SelectorSettingsModelDraft = Readonly<
  Record<SelectorSettingsModelRowName, string>
>;

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

/** The override fields the draft holds, as the strings they hold. */
export interface SelectorSettingsDrawn {
  readonly northStar: string;
  readonly threadStandingRules: string;
  readonly models: SelectorSettingsModelDraft;
}

/**
 * What the form holds, under the revision it was read at, beside the values
 * the read gave, which is how an edited box is told from an untouched one.
 */
export interface SelectorSettingsDraft extends SelectorSettingsDrawn {
  readonly revision: number;
  readonly read: SelectorSettingsDrawn;
}

/** The boxes as the read gave them, an absent override being an empty one. */
function selectorSettingsDrawn(
  overrides: SelectorProjectOverrides,
): SelectorSettingsDrawn {
  return {
    northStar: overrides.northStar ?? "",
    threadStandingRules: overrides.threadStandingRules ?? "",
    models: {
      threadModel: overrides.threadModel ?? "",
      threadEffort: overrides.threadEffort ?? "",
    },
  };
}

/** The settings as the form holds them, an absent override being an empty box. */
export function selectorSettingsDraft(
  settings: SelectorProjectSettingsResponse,
): SelectorSettingsDraft {
  const drawn = selectorSettingsDrawn(settings.overrides);
  return { ...drawn, revision: settings.revision, read: drawn };
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
  const kept = (name: "northStar" | "threadStandingRules") =>
    draft[name] === draft.read[name] ? arriving[name] : draft[name];
  const model = (name: SelectorSettingsModelRowName) =>
    draft.models[name] === draft.read.models[name]
      ? arriving.models[name]
      : draft.models[name];
  return {
    northStar: kept("northStar"),
    threadStandingRules: kept("threadStandingRules"),
    models: {
      threadModel: model("threadModel"),
      threadEffort: model("threadEffort"),
    },
    revision: settings.revision,
    read: arriving,
  };
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
): Partial<Record<SelectorSettingsModelRowName, string>> {
  const held: Partial<Record<SelectorSettingsModelRowName, string>> = {};
  for (const name of selectorSettingsModelRowNames)
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
  const built = {
    ...(draft.northStar.trim() === "" ? {} : { northStar: draft.northStar }),
    ...(draft.threadStandingRules.trim() === ""
      ? {}
      : { threadStandingRules: draft.threadStandingRules }),
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

/** Whether the section stands on the default rather than the
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
