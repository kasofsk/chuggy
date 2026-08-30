/**
 * What an execution column says when a row has nothing joined to it.
 *
 * The two absences are different answers to different questions — this ticket
 * has never run, and this row is one the walk did not reach — and drawing them
 * the same way is the failure `ProjectTableRow.executionRead` exists to make
 * impossible, so the cell that reads it is held to telling them apart.
 */

import { expect, test } from "vitest";

import {
  cellAbsent,
  cellExecutionUnread,
  ticketRowExecutionCell,
  ticketRowSlotCell,
  ticketTitleUnset,
} from "../app/browser/TicketCells.tsx";
import { projectTableExecutionReads } from "../app/core/projectTableRows.ts";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";

function row(
  executionRead: ProjectTableRow["executionRead"],
  slot: ProjectTableRow["slot"] = undefined,
): ProjectTableRow {
  return {
    ticket: 4,
    phase: "Escalated",
    section: "NeedsYou",
    badge: "work failed",
    executionRead,
    slot,
    executionStatus: undefined,
    executionOutcome: undefined,
    runsOn: undefined,
    sequence: 9,
    activityAt: undefined,
  };
}

test("a row the walk did not reach says so rather than drawing a dash", () => {
  expect(ticketRowExecutionCell(row("IndexTruncated"), undefined)).toBe(
    cellExecutionUnread,
  );
  expect(ticketRowExecutionCell(row("IndexTruncated"), "Running")).toBe(
    cellExecutionUnread,
  );
});

test("a ticket that has never run draws the dash, and a joined one its value", () => {
  expect(ticketRowExecutionCell(row("NoneRegistered"), undefined)).toBe(
    cellAbsent,
  );
  expect(ticketRowExecutionCell(row("Joined"), "Running · Failed")).toBe(
    "Running · Failed",
  );
});

/** Derived from the roster rather than listed, so a read the row gains is a
 * read this case asks about. */
test("only the truncated read is drawn as unread", () => {
  const unread = projectTableExecutionReads.filter(
    (read) =>
      ticketRowExecutionCell(row(read), "Running") === cellExecutionUnread,
  );
  expect(unread).toStrictEqual(["IndexTruncated"]);
});

test("a ticket with neither an intent nor a configuration to fall back on reads as unset", () => {
  expect(ticketRowSlotCell(row("NoneRegistered"))).toBe(ticketTitleUnset);
});

test("a slot the walk did not reach says so rather than claiming unset", () => {
  expect(ticketRowSlotCell(row("IndexTruncated"))).toBe(cellExecutionUnread);
});

test("a slot with something to show draws it over either default", () => {
  const filled = row("IndexTruncated", {
    text: "ship the title",
    title: "ship the title",
  });
  expect(ticketRowSlotCell(filled)).toBe("ship the title");
});
