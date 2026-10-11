/**
 * A drawn list of invite links as a case reads it, the same for a workspace's
 * and the site's: its rows, what each column of one draws, its statuses, the
 * revocations it offers, and the question one waits on.
 */

import { fireEvent, screen, within } from "@testing-library/react";

import { instantText } from "../../app/core/figures.ts";
import { turned } from "../screenHarness.tsx";

export function linksTable(): HTMLElement {
  return screen.getByRole("table", { name: "Invite links" });
}

/** The table's rows under its head, a link each and under one the row its revocation asks in. */
export function linkRows(): readonly HTMLElement[] {
  return within(linksTable()).getAllByRole("row").slice(1);
}

export function linkHeadings(): readonly string[] {
  return within(linksTable())
    .getAllByRole("columnheader")
    .map((heading) => heading.textContent);
}

/** What each column of one row draws, by the column's own heading. */
export function linkCells(
  row: HTMLElement,
): Readonly<Record<string, HTMLElement>> {
  const headings = linkHeadings();
  const drawn = [
    within(row).getByRole("rowheader"),
    ...within(row).getAllByRole("cell"),
  ];
  return Object.fromEntries(
    drawn.map((cell, index) => [headings[index] ?? "", cell]),
  );
}

/** What one column draws down the table, a row a link. */
export function linkColumn(heading: string): readonly (string | undefined)[] {
  return linkRows().map((row) => linkCells(row)[heading]?.textContent);
}

export function linkStatuses(): readonly (string | undefined)[] {
  return linkRows().map(
    (row) => linkCells(row)["Status"]?.querySelector(".pill")?.textContent,
  );
}

/** An instant as a row draws it now. */
export function linkWhen(atMs: number): string {
  return instantText(new Date(atMs), new Date());
}

/** Each row that offers its link's revocation, as its text. */
export function linkRevocations(): readonly (string | null)[] {
  return within(linksTable())
    .queryAllByRole("button", { name: "Revoke" })
    .map((button) => button.closest("tr")?.textContent ?? null);
}

/** The words each row carries for when it is stacked, in the row's order. */
export function linkStackedLabels(): readonly (readonly string[])[] {
  return linkRows().map((row) =>
    Array.from(row.querySelectorAll(".people-stacked-label")).map(
      (label) => label.textContent,
    ),
  );
}

export function revocationQuestion(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Revoke link" });
}

/** Whether the cell the question stands in runs the table's whole width. */
export function revocationQuestionSpans(): boolean {
  return revocationQuestion()?.closest("td")?.colSpan === linkHeadings().length;
}

/** One row's Revoke pressed, which asks and sends nothing. */
export async function revocationAsked(row: number): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(linkRows()[row] ?? linksTable()).getByRole("button"),
    );
  });
}

/** The first link's Revoke pressed and its question confirmed. */
export async function revokedFirst(): Promise<void> {
  await revocationAsked(0);
  const asked = revocationQuestion();
  if (asked === null) throw new Error("nothing asked");
  await turned(() => {
    fireEvent.click(within(asked).getByRole("button", { name: "Revoke" }));
  });
}
