/**
 * How wide each column of a table is drawn: one of a few steps, chosen by what
 * is written in it.
 *
 * A COLUMN IS SIZED BY CHARACTERS, NOT BY ANYTHING MEASURED ON THE PAGE. What
 * a cell wants is a line long enough for its longest word and for all it holds
 * folded into a few lines, and a column is the step that the most any of its
 * cells wants falls in. So a column of `no` and `yes` is narrow under a header
 * of several words, which folds, and a column of sentences is wide. A word too
 * long for a phrase's line, a path or a name in code, has a step of its own
 * below the widest, which is for what folds into too many lines at any other.
 * The step is a class and the sheet gives each class its width, so nothing
 * here is a length and no markup carries a `style`.
 *
 * A COLUMN ONLY STEPS UP. A cell another has followed is read the same however
 * the text goes on, so the most any cell wants only grows as rows arrive, and
 * there are few steps to pass: a column changes that often at the very most,
 * and in a table whose rows are alike, only while its first row or two is
 * written.
 *
 * A CELL IS COUNTED ONLY WHERE IT COULD MOVE ITS COLUMN. Every cell of a table
 * is read at every frame it is written in, and counting each would cost a
 * table of thousands a frame's work for steps that almost never change: so a
 * cell whose source is no longer than the line of the step its column is at
 * is passed over, which is nearly all of them once a column has its step.
 *
 * THE CELL A TEXT ENDS IN IS NOT COUNTED UNTIL ITS STEP IS SURE. While more of
 * the text is coming that cell is still growing, and a column that stepped
 * with every few words of it would move the whole table as often. It is
 * counted once it has reached the widest step, which no more of it can change,
 * and otherwise once a pipe has closed it, another cell or block has begun, or
 * the text is whole: so a long cell steps its column once, and a text read
 * back whole is sized as it was when its last word was written.
 */

import type { MarkdownNodeOf } from "./markdownTree.ts";

type Table = MarkdownNodeOf<"table">;
type TableCell = MarkdownNodeOf<"tableCell">;

/** The classes a column at each step carries, narrowest first, which are all
 * that size it. */
export const markdownColumnClassNames = [
  "run-report-column run-report-column-mark",
  "run-report-column run-report-column-word",
  "run-report-column run-report-column-name",
  "run-report-column run-report-column-phrase",
  "run-report-column run-report-column-path",
  "run-report-column run-report-column-prose",
] as const;

/** The longest line, in characters, a cell may want and its column still be at
 * each of the steps a phrase's and narrower. */
export const markdownColumnLineMax: readonly number[] = [3, 7, 10, 13];

/** How many lines all a cell holds may fold into before its column is made
 * wider for it. */
export const markdownColumnLines = 5;

/** The widest step, which a cell reaches only by how much it holds. */
const prose = markdownColumnClassNames.length - 1;

/** As much of any node in a cell as is counted. */
interface Counted {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly Counted[];
}

interface Wanted {
  /** Everything counted so far, and the longest word among it. */
  total: number;
  longest: number;
  /** The word being counted, which a blank or a hyphen ends. */
  word: number;
  /** Blanks met since the last word, which count once another follows. */
  blanks: number;
}

/** One more character of a word, with the blanks before it. */
function lettered(wanted: Wanted): void {
  wanted.total += wanted.blanks + 1;
  wanted.blanks = 0;
  wanted.word += 1;
  if (wanted.word > wanted.longest) wanted.longest = wanted.word;
}

function counted(wanted: Wanted, value: string): void {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    const blank = code === 32 || code === 9 || code === 10;
    if (blank) wanted.blanks += 1;
    else lettered(wanted);
    if (blank || code === 45) wanted.word = 0;
  }
}

/** The step a line of so many characters falls in, a phrase's and narrower,
 * or the one past them. */
function markdownColumnStep(line: number): number {
  const step = markdownColumnLineMax.findIndex((most) => line <= most);
  return step < 0 ? markdownColumnLineMax.length : step;
}

/**
 * The step the cells drawn in one place of a row want: a row's last column
 * also holds every cell written past it. Code is drawn in a chip, whose edges
 * are counted as a character of its first word.
 */
function markdownCellsStep(cells: readonly TableCell[]): number {
  const wanted: Wanted = { total: 0, longest: 0, word: 0, blanks: 0 };
  cells.forEach((cell, at) => {
    if (at > 0) counted(wanted, " | ");
    const pending: Counted[] = [...cell.children].reverse();
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.type === "inlineCode") lettered(wanted);
      if (next.value !== undefined) counted(wanted, next.value);
      pending.push(...[...(next.children ?? [])].reverse());
    }
    wanted.word = 0;
  });
  const word = markdownColumnStep(wanted.longest);
  const folded = markdownColumnStep(
    Math.ceil(wanted.total / markdownColumnLines),
  );
  return Math.max(word, folded < markdownColumnLineMax.length ? folded : prose);
}

/**
 * Whether a cell is too short to take a column past the step it is at, said
 * without counting it: nothing a cell is counted as is longer than the source
 * its words were read from, and a cell that holds nothing wants nothing.
 */
function markdownCellWithin(cell: TableCell, step: number): boolean {
  if (step >= prose) return true;
  const first = cell.children[0]?.position?.start.offset;
  const last = cell.children.at(-1)?.position?.end.offset;
  if (first === undefined || last === undefined)
    return cell.children.length === 0;
  const phrase = markdownColumnLineMax.at(-1) ?? 0;
  const most = markdownColumnLineMax[step] ?? phrase * markdownColumnLines;
  return last - first <= most;
}

/**
 * Whether the pipe that ends a row has closed its last cell: the cell's source
 * then runs on past the last thing it holds by more than a blank. Where the
 * cell's words were read again apart from it, their places say nothing.
 */
function markdownCellClosed(cell: TableCell | undefined): boolean {
  const from = cell?.position?.start.offset;
  const end = cell?.position?.end.offset;
  const held = cell?.children.at(-1)?.position;
  if (from === undefined || end === undefined || held === undefined)
    return false;
  const first = held.start.offset;
  const last = held.end.offset;
  if (first === undefined || last === undefined) return false;
  return first > from && end - last > 1;
}

/**
 * The step of each of a table's columns, as many as its header has cells.
 * `open` says the text ends in the table while more of it is coming, and the
 * cell it ends in, until a pipe closes it, is counted only at the widest step.
 */
export function markdownColumnsStepped(
  table: Table,
  open: boolean,
): readonly number[] {
  const columns = table.children[0]?.children.length ?? 0;
  const steps = Array.from({ length: columns }, () => 0);
  table.children.forEach((row, line) => {
    const cells = row.children;
    const drawn = Math.min(cells.length, columns);
    const ending =
      open &&
      line === table.children.length - 1 &&
      !markdownCellClosed(cells.at(-1));
    for (let at = 0; at < drawn; at += 1) {
      const now = steps[at] ?? 0;
      const cell = cells[at];
      const more = at === columns - 1 && cells.length > columns;
      if (cell === undefined) continue;
      if (!more && markdownCellWithin(cell, now)) continue;
      const step = markdownCellsStep(more ? cells.slice(at) : [cell]);
      const unsure = ending && at === drawn - 1 && step < prose;
      if (!unsure && step > now) steps[at] = step;
    }
  });
  return steps;
}
