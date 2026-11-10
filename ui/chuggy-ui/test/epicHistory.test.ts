/**
 * An epic's history in rows: what each revision changed in one line, who made
 * it, and the runs of one actor's small edits folded into one row.
 */

import { expect, test } from "vitest";

import type { EpicRevisionField } from "../../../src/contract/epics.ts";

import { copyTextEn } from "../app/copy/catalog.ts";
import {
  epicActorLabel,
  epicHistoryRowSaid,
  epicHistoryRows,
  epicRevisionSaid,
} from "../app/core/epicHistory.ts";
import type { EpicRevisionRead } from "../app/core/epicHistory.ts";
import { instantSpanFigure } from "../app/core/figures.ts";

const minuteMs = 60_000;
const startMs = Date.parse("2026-10-01T02:41:00Z");

function revised(
  revision: number,
  changes: {
    readonly fields?: readonly EpicRevisionField[];
    readonly added?: readonly number[];
    readonly removed?: readonly number[];
  },
  options: {
    readonly subject?: string;
    readonly atMinute?: number;
    readonly visibility?: "Active" | "Archived";
  } = {},
): EpicRevisionRead {
  return {
    revision,
    changedAt: new Date(
      startMs + (options.atMinute ?? revision) * minuteMs,
    ).toISOString(),
    actor: { kind: "user", subject: options.subject ?? "dana" },
    title: "Billing",
    visibility: options.visibility ?? "Active",
    changes: {
      kind: "Revised",
      fields: [...(changes.fields ?? [])],
      added: [...(changes.added ?? [])],
      removed: [...(changes.removed ?? [])],
    },
  };
}

const created: EpicRevisionRead = {
  revision: 1,
  changedAt: new Date(startMs).toISOString(),
  actor: { kind: "user", subject: "dana" },
  title: "Billing",
  visibility: "Active",
  changes: { kind: "Created" },
};

function said(revision: EpicRevisionRead): string {
  return copyTextEn(epicRevisionSaid(revision));
}

test("a revision says Created, Added, Removed, Edited, Archived or Reactivated, and Saved where it changed nothing", () => {
  expect(said(created)).toBe("Created");
  expect(said(revised(2, { added: [445] }))).toBe("Added #445");
  expect(said(revised(2, { removed: [12] }))).toBe("Removed #12");
  expect(said(revised(2, { fields: ["title", "description"] }))).toBe(
    "Edited title, description",
  );
  expect(
    said(revised(2, { fields: ["visibility"] }, { visibility: "Archived" })),
  ).toBe("Archived");
  expect(
    said(revised(2, { fields: ["visibility"] }, { visibility: "Active" })),
  ).toBe("Reactivated");
  expect(said(revised(2, {}))).toBe("Saved");
});

test("consecutive tickets are said as a range, and the rest one by one", () => {
  expect(
    said(
      revised(2, {
        added: [
          432, 433, 434, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444,
        ],
      }),
    ),
  ).toBe("Added #432–#444");
  expect(said(revised(2, { added: [3, 5, 6, 7, 9] }))).toBe(
    "Added #3, #5–#7, #9",
  );
});

test("several changes in one revision are joined with a dot", () => {
  expect(
    said(
      revised(
        2,
        { fields: ["summary", "visibility"], added: [4], removed: [9] },
        { visibility: "Archived" },
      ),
    ),
  ).toBe("Added #4 · Removed #9 · Edited summary · Archived");
});

test("who is drawn by the email the people name, and otherwise by the subject shortened", () => {
  const emails = new Map([["dana", "dana@example.com"]]);
  const issuer = "https://issuer.example/";
  const principal = (subject: string) =>
    `${String(issuer.length)}:${issuer}${subject}`;
  expect(
    epicActorLabel({ kind: "user", subject: principal("dana") }, emails),
  ).toEqual({ text: "dana@example.com", title: principal("dana") });
  expect(
    epicActorLabel({ kind: "user", subject: principal("bo") }, emails).text,
  ).toBe("bo");
  expect(
    epicActorLabel({ kind: "user", subject: principal("x".repeat(40)) }, emails)
      .text,
  ).toBe(`${"x".repeat(12)}…${"x".repeat(6)}`);
});

function rowsOf(revisions: readonly EpicRevisionRead[]): number[][] {
  return epicHistoryRows(revisions).map((row) =>
    row.map((revision) => revision.revision),
  );
}

test("one actor's run of ticket edits within the gap folds into one row saying what it did together", () => {
  const run = [
    revised(4, { added: [434] }),
    revised(3, { added: [433] }),
    revised(2, { added: [432] }),
  ];
  const rows = epicHistoryRows([...run, created]);
  expect(rows.map((row) => row.map((each) => each.revision))).toEqual([
    [4, 3, 2],
    [1],
  ]);
  const [folded] = rows;
  if (folded === undefined) throw new Error("a folded row");
  expect(copyTextEn(epicHistoryRowSaid(folded))).toBe("Added #432–#434");
});

test("a run's ticket added then removed is said as neither", () => {
  const [row] = epicHistoryRows([
    revised(4, { removed: [7] }),
    revised(3, { added: [8] }),
    revised(2, { added: [7] }),
  ]);
  if (row === undefined) throw new Error("a folded row");
  expect(row).toHaveLength(3);
  expect(copyTextEn(epicHistoryRowSaid(row))).toBe("Added #8");
});

test("a revision editing anything but tickets breaks a run and stands alone", () => {
  expect(
    rowsOf([
      revised(4, { added: [434] }),
      revised(3, { fields: ["title"], added: [433] }),
      revised(2, { added: [432] }),
    ]),
  ).toEqual([[4], [3], [2]]);
});

test("two actors' runs do not fold together", () => {
  expect(
    rowsOf([
      revised(5, { added: [5] }, { subject: "eve" }),
      revised(4, { added: [4] }, { subject: "eve" }),
      revised(3, { added: [3] }),
      revised(2, { added: [2] }),
    ]),
  ).toEqual([
    [5, 4],
    [3, 2],
  ]);
});

test("neighbours further apart than the gap do not fold", () => {
  expect(
    rowsOf([
      revised(3, { added: [3] }, { atMinute: 20 }),
      revised(2, { added: [2] }, { atMinute: 14 }),
    ]),
  ).toEqual([[3], [2]]);
  expect(
    rowsOf([
      revised(3, { added: [3] }, { atMinute: 19 }),
      revised(2, { added: [2] }, { atMinute: 14 }),
    ]),
  ).toEqual([[3, 2]]);
});

test("a span of one day says the day once, and of two says each", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const span = instantSpanFigure(
    new Date(2026, 9, 1, 2, 41).toISOString(),
    new Date(2026, 9, 1, 2, 46).toISOString(),
    at(new Date(2026, 9, 1, 12, 0).toISOString()),
  );
  expect(span.kind === "Instant" ? span.text : undefined).toBe("02:41–02:46");
  const across = instantSpanFigure(
    new Date(2026, 8, 30, 23, 58).toISOString(),
    new Date(2026, 9, 1, 0, 2).toISOString(),
    at(new Date(2026, 9, 1, 12, 0).toISOString()),
  );
  expect(
    across.kind === "Instant" && typeof across.text !== "string"
      ? copyTextEn(across.text)
      : undefined,
  ).toBe("Sep 30 23:58–00:02");
});
