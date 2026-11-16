/**
 * What a row or a cell of a stacked table says between columns: its text
 * without the labels a card draws for the eye, which the column heads already
 * say and which a wide table hides.
 */

export function tableText(drawn: Element): string {
  const copy = drawn.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  for (const label of copy.querySelectorAll(".tabular-label")) label.remove();
  return copy.textContent;
}

export interface TableCard {
  /** What the cell naming the row says, which titles its card. */
  readonly title: string;
  /** Each other cell's label as its card draws it, in the card's order, and
   * `undefined` for a cell drawn with none. */
  readonly labels: readonly (string | undefined)[];
  /** Whether the card's last cell is the row's actions. */
  readonly actionsLast: boolean;
}

/** Each row of a stacked table as its card reads, or a throw where the table
 * is not stacked or a row is not headed by the cell naming it. */
export function tableCards(table: HTMLElement): readonly TableCard[] {
  if (!table.classList.contains("tabular-stacked"))
    throw new Error("the table is not stacked");
  return Array.from(
    table.querySelectorAll(":scope > tbody > tr:not(.tabular-below)"),
    (row) => {
      const [first, ...rest] = Array.from(row.children);
      if (first?.getAttribute("role") !== "rowheader")
        throw new Error("a row is not headed by the cell naming it");
      if (first.querySelector(".tabular-label") !== null)
        throw new Error("a row's title draws a label");
      return {
        title: tableText(first),
        labels: rest.map(
          (cell) => cell.querySelector(".tabular-label")?.textContent,
        ),
        actionsLast:
          rest.at(-1)?.classList.contains("tabular-actions") === true,
      };
    },
  );
}
