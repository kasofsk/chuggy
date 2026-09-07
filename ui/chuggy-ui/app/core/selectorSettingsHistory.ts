/**
 * What each recorded revision of the selector settings changed, derived from
 * the override sets the history read already carries.
 *
 * THE DIFF IS NOT ON THE WIRE AND MUST NOT BE STORED. The history gives every
 * revision's whole override set, so what one revision moved is the difference
 * between it and the one before — standing rule 3, and the reason no server
 * change is needed to say `Base prompt, Tokens` beside a row.
 *
 * THE OLDEST ROW OF A PAGE HAS NO PREDECESSOR HERE. The read is a page and the
 * revision before its last one may simply not have been fetched, so that row's
 * changes are absent rather than a diff against nothing — which would claim the
 * revision set every override the project has.
 *
 * An absent override is drawn as the installation's value rather than as blank,
 * because a field going back to the default is a change like any other and a
 * blank half reads as "unchanged".
 */

import type { SelectorSettingsHistoryResponse } from "../../../../src/contract/responses.ts";
import { groupedDigits } from "./figures.ts";
import {
  selectorSettingsLimitLabel,
  selectorSettingsLimitNames,
  selectorSettingsTextNames,
} from "./selectorSettingsForm.ts";
import type { SelectorProjectOverrides } from "./selectorSettingsForm.ts";

export type SelectorSettingsRevisionRead =
  SelectorSettingsHistoryResponse["revisions"][number];

/** The word a field that carries no override is drawn as, on both sides. */
export const selectorSettingsHistoryDefaultWord = "Default";

/** One field one revision moved, as the two texts a row draws. */
export interface SelectorSettingsFieldChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly mono: boolean;
}

/** One recorded revision beside what it moved, or that this read cannot say. */
export interface SelectorSettingsRevisionDiff {
  readonly revision: SelectorSettingsRevisionRead;
  readonly changes: readonly SelectorSettingsFieldChange[] | undefined;
}

/** How one override field is drawn on either side of an arrow. */
interface SelectorSettingsHistoryField {
  readonly label: string;
  readonly text: string;
  readonly mono: boolean;
}

function selectorSettingsHistoryTexts(
  overrides: SelectorProjectOverrides,
): readonly SelectorSettingsHistoryField[] {
  const held: SelectorSettingsHistoryField[] = [];
  for (const name of selectorSettingsTextNames)
    held.push({
      label: selectorSettingsHistoryTextLabel(name),
      text: overrides[name] ?? selectorSettingsHistoryDefaultWord,
      mono: name === "basePrompt",
    });
  return held;
}

function selectorSettingsHistoryTextLabel(
  name: (typeof selectorSettingsTextNames)[number],
): string {
  switch (name) {
    case "northStar":
      return "North Star";
    case "threadStandingRules":
      return "Standing rules";
    case "basePrompt":
      return "Base prompt";
  }
}

/** Every override field of one revision, flat, so two revisions compare field
 * by field rather than by a shape one of them may not have. */
function selectorSettingsHistoryFields(
  overrides: SelectorProjectOverrides,
): readonly SelectorSettingsHistoryField[] {
  const absent = selectorSettingsHistoryDefaultWord;
  const limits = selectorSettingsLimitNames.map((name) => ({
    label: selectorSettingsLimitLabel(name),
    text: selectorSettingsHistoryNumber(overrides.limits?.[name]),
    mono: false,
  }));
  return [
    ...selectorSettingsHistoryTexts(overrides),
    { label: "Mode", text: overrides.mode ?? absent, mono: false },
    { label: "Dispatch", text: overrides.dispatchMode ?? absent, mono: false },
    ...limits,
    {
      label: "Models",
      text: selectorSettingsHistoryList(overrides.modelAllowlist),
      mono: false,
    },
    {
      label: "Tools",
      text: selectorSettingsHistoryList(overrides.toolAllowlist),
      mono: false,
    },
    {
      label: "Context age",
      text: selectorSettingsHistoryNumber(overrides.operationalContextMaxAgeMs),
      mono: false,
    },
  ];
}

function selectorSettingsHistoryNumber(value: number | undefined): string {
  return value === undefined
    ? selectorSettingsHistoryDefaultWord
    : groupedDigits(value);
}

function selectorSettingsHistoryList(
  value: readonly string[] | undefined,
): string {
  if (value === undefined) return selectorSettingsHistoryDefaultWord;
  return value.length === 0 ? "None" : value.join(", ");
}

/**
 * The first line the two texts differ on, so a prompt of many paragraphs is
 * read as the sentence that moved rather than as two walls. A text that grew or
 * shrank differs first at the line one of them does not have, which is drawn as
 * nothing on that side.
 */
export function selectorSettingsHistoryDiffered(
  before: string,
  after: string,
): { readonly before: string; readonly after: string } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  for (let line = 0; line < lineCount; line += 1) {
    const beforeLine = beforeLines[line] ?? "";
    const afterLine = afterLines[line] ?? "";
    if (beforeLine !== afterLine)
      return { before: beforeLine, after: afterLine };
  }
  return { before, after };
}

function selectorSettingsHistoryChanges(
  overrides: SelectorProjectOverrides,
  previous: SelectorProjectOverrides,
): readonly SelectorSettingsFieldChange[] {
  const was = selectorSettingsHistoryFields(previous);
  const changes: SelectorSettingsFieldChange[] = [];
  selectorSettingsHistoryFields(overrides).forEach((field, at) => {
    const before = was[at]?.text ?? selectorSettingsHistoryDefaultWord;
    if (before === field.text) return;
    const lines = selectorSettingsHistoryDiffered(before, field.text);
    changes.push({
      label: field.label,
      before: lines.before,
      after: lines.after,
      mono: field.mono,
    });
  });
  return changes;
}

/**
 * Each revision of the read beside what it moved. The read is newest first, so
 * a revision's predecessor is the row after it, and the last row has none.
 */
export function selectorSettingsHistoryDiffs(
  revisions: readonly SelectorSettingsRevisionRead[],
): readonly SelectorSettingsRevisionDiff[] {
  return revisions.map((revision, at) => {
    const previous = revisions[at + 1];
    return {
      revision,
      changes:
        previous === undefined
          ? undefined
          : selectorSettingsHistoryChanges(
              revision.overrides,
              previous.overrides,
            ),
    };
  });
}
