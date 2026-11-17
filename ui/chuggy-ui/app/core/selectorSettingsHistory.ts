/**
 * What each recorded revision of the selector settings changed, derived from
 * the override sets the history read already carries.
 *
 * THE DIFF IS NOT ON THE WIRE AND MUST NOT BE STORED. The history gives every
 * revision's whole override set, so what one revision moved is the difference
 * between it and the one before — standing rule 3, and the reason no server
 * change is needed to say `North Star, Chat model` beside a row.
 *
 * THE OLDEST ROW OF A PAGE HAS NO PREDECESSOR HERE. The read is a page and the
 * revision before its last one may simply not have been fetched, so that row's
 * changes are absent rather than a diff against nothing — which would claim the
 * revision set every override the project has.
 *
 * An absent override is drawn as `Default` rather than as blank, because a
 * field going back to the default is a change like any other and a blank
 * half reads as "unchanged".
 */

import type { SelectorSettingsHistoryResponse } from "../../../../src/contract/responses.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import {
  selectorSettingsEffortLabel,
  selectorSettingsModelLabel,
  selectorSettingsTextNames,
} from "./selectorSettingsForm.ts";
import type { SelectorProjectOverrides } from "./selectorSettingsForm.ts";

export type SelectorSettingsRevisionRead =
  SelectorSettingsHistoryResponse["revisions"][number];

/** The word a field that carries no override is drawn as, on both sides. */
export const selectorSettingsHistoryDefaultWord: Copy = {
  id: "settings-threads-default",
};

/** One field one revision moved, as the two texts a row draws: a word for a
 * value the console names, or the value itself, which is data. */
export interface SelectorSettingsFieldChange {
  readonly label: Copy;
  readonly before: CopyOrData;
  readonly after: CopyOrData;
}

/** One recorded revision beside what it moved, or that this read cannot say. */
export interface SelectorSettingsRevisionDiff {
  readonly revision: SelectorSettingsRevisionRead;
  readonly changes: readonly SelectorSettingsFieldChange[] | undefined;
}

/** How one override field is drawn on either side of an arrow. */
interface SelectorSettingsHistoryField {
  readonly label: Copy;
  readonly text: CopyOrData;
}

/** Whether two sides draw the same: the same word, or the same data. */
function selectorSettingsHistorySame(
  before: CopyOrData,
  after: CopyOrData,
): boolean {
  if (typeof before === "string" || typeof after === "string")
    return before === after;
  return before.id === after.id;
}

function selectorSettingsHistoryTexts(
  overrides: SelectorProjectOverrides,
): readonly SelectorSettingsHistoryField[] {
  const held: SelectorSettingsHistoryField[] = [];
  for (const name of selectorSettingsTextNames)
    held.push({
      label: selectorSettingsHistoryTextLabel(name),
      text: overrides[name] ?? selectorSettingsHistoryDefaultWord,
    });
  return held;
}

function selectorSettingsHistoryTextLabel(
  name: (typeof selectorSettingsTextNames)[number],
): Copy {
  switch (name) {
    case "northStar":
      return { id: "settings-threads-section-north-star-title" };
    case "threadStandingRules":
      return { id: "settings-threads-section-standing-rules-title" };
  }
}

/** Every drawn field of one revision, flat, so two revisions compare field
 * by field rather than by a shape one of them may not have. */
function selectorSettingsHistoryFields(
  overrides: SelectorProjectOverrides,
): readonly SelectorSettingsHistoryField[] {
  return [
    ...selectorSettingsHistoryTexts(overrides),
    ...selectorSettingsHistoryModels(overrides),
  ];
}

/** The model and effort rows, a model drawn as the name it is and an effort as its word. */
function selectorSettingsHistoryModels(
  overrides: SelectorProjectOverrides,
): readonly SelectorSettingsHistoryField[] {
  const absent = selectorSettingsHistoryDefaultWord;
  const model = (name: "threadModel"): SelectorSettingsHistoryField => ({
    label: selectorSettingsModelLabel(name),
    text: overrides[name] ?? absent,
  });
  const effort = (name: "threadEffort"): SelectorSettingsHistoryField => {
    const held = overrides[name];
    return {
      label: selectorSettingsModelLabel(name),
      text: held === undefined ? absent : selectorSettingsEffortLabel(held),
    };
  };
  return [model("threadModel"), effort("threadEffort")];
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
    if (selectorSettingsHistorySame(before, field.text)) return;
    const lines =
      typeof before === "string" && typeof field.text === "string"
        ? selectorSettingsHistoryDiffered(before, field.text)
        : { before, after: field.text };
    changes.push({
      label: field.label,
      before: lines.before,
      after: lines.after,
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
