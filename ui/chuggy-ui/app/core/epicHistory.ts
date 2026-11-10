/**
 * An epic's history as its page draws it: what each revision changed, said in
 * one line, who made it, and the rows a page of revisions is drawn in, where a
 * run of one actor's small edits folds into one.
 *
 * A revision folds with its neighbours only where it does nothing but add or
 * remove tickets, and only with the neighbours on the page it arrived on.
 */

import type { EpicHistoryResponse } from "../../../../src/contract/responses.ts";
import type { EpicRevisionField } from "../../../../src/contract/epics.ts";
import type { Copy } from "./copy.ts";
import { creatorLabel } from "./labels.ts";
import type { Label } from "./labels.ts";

export type EpicRevisionRead = EpicHistoryResponse["revisions"][number];
type EpicRevisionActor = EpicRevisionRead["actor"];

/** The longest gap between two neighbours of one run that still folds. */
export const epicHistoryRunGapMsMax = 5 * 60 * 1_000;

/** One row of the history: its revisions, newest first, more than one where a
 * run was folded into it. */
export type EpicHistoryRow = readonly [
  EpicRevisionRead,
  ...(readonly EpicRevisionRead[]),
];

/** Who made a revision, drawn as the ticket list draws a ticket's creator. */
export function epicActorLabel(
  actor: EpicRevisionActor,
  emails: ReadonlyMap<string, string>,
): Label {
  return creatorLabel(actor.subject, emails);
}

/** Whether a revision does nothing but add or remove tickets. */
function epicHistoryRowsFoldable(revision: EpicRevisionRead): boolean {
  const { changes } = revision;
  return (
    changes.kind === "Revised" &&
    changes.fields.length === 0 &&
    changes.added.length + changes.removed.length > 0
  );
}

/** Whether `older`, the revision under `newer` on the page, joins its run. */
function epicHistoryRowsJoined(
  newer: EpicRevisionRead,
  older: EpicRevisionRead,
): boolean {
  const gapMs = Date.parse(newer.changedAt) - Date.parse(older.changedAt);
  return (
    epicHistoryRowsFoldable(newer) &&
    epicHistoryRowsFoldable(older) &&
    newer.actor.kind === older.actor.kind &&
    newer.actor.subject === older.actor.subject &&
    Number.isFinite(gapMs) &&
    gapMs >= 0 &&
    gapMs <= epicHistoryRunGapMsMax
  );
}

/** A page of revisions, newest first, as the rows it is drawn in. */
export function epicHistoryRows(
  revisions: readonly EpicRevisionRead[],
): readonly EpicHistoryRow[] {
  const rows: EpicRevisionRead[][] = [];
  let previous: EpicRevisionRead | undefined;
  for (const revision of revisions) {
    const row = rows.at(-1);
    if (
      row !== undefined &&
      previous !== undefined &&
      epicHistoryRowsJoined(previous, revision)
    )
      row.push(revision);
    else rows.push([revision]);
    previous = revision;
  }
  const drawn = rows.flat().length;
  if (drawn !== revisions.length)
    throw new Error(
      `${String(revisions.length)} revisions were drawn in rows holding ${String(drawn)}`,
    );
  return rows.map(([first, ...rest]) => {
    if (first === undefined) throw new Error("a history row holds a revision");
    return [first, ...rest];
  });
}

/** Tickets as `#12, #432–#444`, each run of consecutive numbers as its ends. */
export function epicTicketsRunsText(tickets: readonly number[]): string {
  const sorted = [...tickets].sort((left, right) => left - right);
  const runs: [number, number][] = [];
  for (const ticket of sorted) {
    const run = runs.at(-1);
    if (run !== undefined && ticket === run[1] + 1) run[1] = ticket;
    else if (run === undefined || ticket !== run[1])
      runs.push([ticket, ticket]);
  }
  return runs
    .map(([from, to]) =>
      from === to ? `#${String(from)}` : `#${String(from)}–#${String(to)}`,
    )
    .join(", ");
}

const epicRevisionFieldWords: Readonly<
  Record<Exclude<EpicRevisionField, "visibility">, Copy>
> = {
  title: { id: "epics-history-field-title" },
  summary: { id: "epics-history-field-summary" },
  description: { id: "epics-history-field-description" },
};

/** Words said in order, as one line joined by `join`. */
function epicHistoryJoined(
  said: readonly Copy[],
  join: (first: Copy, rest: Copy) => Copy,
): Copy | undefined {
  const [first, ...rest] = said;
  if (first === undefined) return undefined;
  const after = epicHistoryJoined(rest, join);
  return after === undefined ? first : join(first, after);
}

/** What tickets a revision or a run gained and lost, and which of its fields
 * it edited, in the line that says them. */
function epicHistoryChangesSaid(changed: {
  readonly added: readonly number[];
  readonly removed: readonly number[];
  readonly fields: readonly EpicRevisionField[];
  readonly visibility: EpicRevisionRead["visibility"];
}): Copy {
  const edited = changed.fields.flatMap((field) =>
    field === "visibility" ? [] : [epicRevisionFieldWords[field]],
  );
  const fields = epicHistoryJoined(edited, (first, rest) => ({
    id: "epics-history-list",
    args: { first, rest },
  }));
  const said: Copy[] = [
    ...(changed.added.length === 0
      ? []
      : [
          {
            id: "epics-history-added",
            args: { tickets: epicTicketsRunsText(changed.added) },
          } as const,
        ]),
    ...(changed.removed.length === 0
      ? []
      : [
          {
            id: "epics-history-removed",
            args: { tickets: epicTicketsRunsText(changed.removed) },
          } as const,
        ]),
    ...(fields === undefined
      ? []
      : [{ id: "epics-history-edited", args: { fields } } as const]),
    ...(changed.fields.includes("visibility")
      ? [
          changed.visibility === "Archived"
            ? ({ id: "epics-history-archived" } as const)
            : ({ id: "epics-history-reactivated" } as const),
        ]
      : []),
  ];
  return (
    epicHistoryJoined(said, (first, rest) => ({
      id: "epics-history-also",
      args: { first, rest },
    })) ?? { id: "epics-history-saved" }
  );
}

/** What one revision changed, in one short line. */
export function epicRevisionSaid(revision: EpicRevisionRead): Copy {
  const { changes } = revision;
  if (changes.kind === "Created") return { id: "epics-history-created" };
  return epicHistoryChangesSaid({
    ...changes,
    visibility: revision.visibility,
  });
}

/**
 * What a row's revisions changed together: a ticket one added and a later one
 * removed is neither, and the other way round the same. A row of one revision
 * says that revision.
 */
export function epicHistoryRowSaid(row: EpicHistoryRow): Copy {
  if (row.length === 1) return epicRevisionSaid(row[0]);
  const added = new Set<number>();
  const removed = new Set<number>();
  for (const revision of [...row].reverse()) {
    const { changes } = revision;
    if (changes.kind !== "Revised" || changes.fields.length > 0)
      throw new Error(
        `revision ${String(revision.revision)} edits more than tickets and was folded`,
      );
    for (const ticket of changes.added)
      if (!removed.delete(ticket)) added.add(ticket);
    for (const ticket of changes.removed)
      if (!added.delete(ticket)) removed.add(ticket);
  }
  return epicHistoryChangesSaid({
    added: [...added],
    removed: [...removed],
    fields: [],
    visibility: row[0].visibility,
  });
}
