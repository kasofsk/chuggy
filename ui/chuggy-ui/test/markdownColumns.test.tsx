/**
 * The steps a table's columns are drawn at: what a cell is counted as, that a
 * column only ever steps up and how seldom, and that a table is sized the same
 * written a piece at a time, settled, and read whole.
 *
 * How wide a step is drawn is the sheet's to say, and `markdownReport.test.tsx`
 * holds the sheet to it. What is held here is which step a column is at.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  markdownColumnClassNames,
  markdownColumnLineMax,
  markdownColumnLines,
  markdownColumnsStepped,
} from "../app/browser/ui/markdownColumns.ts";
import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import { markdownBlocksParsed } from "../app/browser/ui/markdownTree.ts";
import { prefixes } from "./markdownShape.ts";

afterEach(cleanup);

const [mark, word, name, phrase, path, prose] = [0, 1, 2, 3, 4, 5];

/** The steps of the first table a text holds, read whole. */
function steps(text: string): readonly number[] {
  const table = markdownBlocksParsed(text).find(
    (block) => block.type === "table",
  );
  if (table?.type !== "table") throw new Error("no table is read");
  return markdownColumnsStepped(table, false);
}

/** The step one cell puts its column at, under a header that asks for none. */
function stepOf(cell: string): number | undefined {
  return steps(`| a |\n| --- |\n| ${cell} |`)[0];
}

const services = [
  "The three services:",
  "",
  "| Service | Language | Purpose |",
  "| --- | --- | --- |",
  "| Server | TypeScript | Holds the journal and decides every transition a ticket makes, one project at a time |",
  "| Console | TypeScript | Draws the tickets, the threads and the runs, and sends what a member decides back to the server |",
  "| Fabric | Go | Runs the work a ticket asks for in a pod of its own and reports what happened, deciding nothing |",
  "| Runner | Rust | Runs the same work on a member's own machine, under that member's own login |",
].join("\n");
const counts = [
  "| Language | Files | Tests |",
  "| --- | --- | --- |",
  "| Python | 212 | yes |",
  "| Rust | 48 | yes |",
  "| TypeScript | 1,179 | yes |",
  "| Go | 7 | no |",
].join("\n");
const gates = [
  "| Gate | Runs in the hook | Needs a server | Exit when it cannot run | What it checks | Where its rule is written |",
  "| --- | --- | --- | --- | --- | --- |",
  "| `check-boundaries` | no | no | 2 | the module graph against `.dependency-cruiser.cjs` | its own header |",
  "| `check-postgres` | no | PostgreSQL | 2 | the durable authority against a real server | its own header |",
  "| `check-figures` | yes | no | 2 | no comment states a quantity a reader has to trust | its own header |",
  "| `check-model` | no | no | 2 | the Quint model, its refinement and its suites | `model/` |",
].join("\n");
const lateRow = 20;
const late = [
  "| Ticket | State | Note |",
  "| --- | --- | --- |",
  ...Array.from({ length: 30 }, (_unused, at) =>
    at === lateRow - 1
      ? "| 20 | Held | The finalizer could not reach the forge for longer than its dwell allows, so the ticket escalated and waits for a member to say whether to try again |"
      : `| ${String(at + 1)} | Done | landed |`,
  ),
].join("\n");
const endsLongest = [
  "| Gate | Verdict |",
  "| --- | --- |",
  "| `check-figures` | clean |",
  "| `check-paths` | clean |",
  "| `check-model` | PostgreSQL |",
].join("\n");
const edgeless = [
  "Gate | Verdict",
  "--- | ---",
  "`check-figures` | clean",
  "`check-paths` | a finding",
  "`check-model` | could not run",
].join("\n");

describe("the step a cell puts its column at", () => {
  test("is one of the steps the sheet has a class for, at the lines these are", () => {
    expect(markdownColumnClassNames).toEqual(
      ["mark", "word", "name", "phrase", "path", "prose"].map(
        (step) => `run-report-column run-report-column-${step}`,
      ),
    );
    expect(markdownColumnLineMax).toEqual([3, 7, 10, 13]);
    expect(markdownColumnLines).toBe(5);
  });

  test.each([
    ["no", mark],
    ["212", mark],
    ["**yes**", mark],
    ["2026", word],
    ["Console", word],
    ["Language", name],
    ["PostgreSQL", name],
    ["Description", phrase],
    ["Authorization", phrase],
    ["characteristic", path],
    ["a word of forty letters is no wider: pneumonoultramicroscopic", path],
  ])("of the one word %s is by that word's length", (cell, step) => {
    expect(stepOf(cell)).toBe(step);
  });

  test.each([
    ["Exit when it cannot run", word],
    ["Python + Rust", word],
    ["Credential-free", phrase],
    ["[docs](https://example.com/a/long/path/that/is/not/drawn)", word],
    [`${"ab ".repeat(21)}ab`, phrase],
    [`${"ab ".repeat(21)}abc`, prose],
  ])(
    "of the words %s is by its longest and by how many lines they fold into",
    (cell, step) => {
      expect(stepOf(cell)).toBe(step);
    },
  );

  test.each([
    ["`ab`", mark],
    ["`a.b`", word],
    ["`model/`", word],
    ["`check-boundaries`", name],
    ["`arb-recorder`", name],
    ["`arbbot.record`", path],
  ])(
    "of the code %s counts the chip's edges, and breaks at a hyphen",
    (cell, step) => {
      expect(stepOf(cell)).toBe(step);
    },
  );
});

describe("the step a column is at", () => {
  test("is the most any cell of the column wants, the header among them", () => {
    expect(steps(services)).toEqual([word, name, prose]);
    expect(steps(counts)).toEqual([name, word, word]);
    expect(steps(gates)).toEqual([name, word, name, word, phrase, word]);
    expect(steps("| Authorization | b |\n| --- | --- |\n| x | y |")).toEqual([
      phrase,
      mark,
    ]);
  });

  test("counts the cells written past the header's last with the last, and nothing for a cell a row has not", () => {
    const folded = "one | two | three four five six seven eight nine ten";
    expect(
      steps(`| a | b |\n| --- | --- |\n| x | ${folded} eleven twelve |`),
    ).toEqual([mark, prose]);
    expect(steps("| a | b |\n| --- | --- |\n| Console |")).toEqual([
      word,
      mark,
    ]);
  });
});

interface Moment {
  /** The body rows a table had, and the step each of its columns was at. */
  readonly rows: number;
  readonly steps: readonly number[];
}

function stepsDrawn(root: Element): readonly number[] {
  const classNames: readonly string[] = markdownColumnClassNames;
  return Array.from(root.querySelectorAll("col"), (col) =>
    classNames.indexOf(col.className),
  );
}

interface Written {
  /** Every moment a table was drawn at while its text was written, then the
   * text settled, then the same text drawn from nothing. */
  readonly moments: readonly Moment[];
  readonly settled: readonly number[];
  readonly whole: readonly number[];
}

function written(text: string, stride: number): Written {
  const view = render(<MarkdownReport text="" bare writing />);
  const moments: Moment[] = [];
  for (const prefix of prefixes(text, stride)) {
    view.rerender(<MarkdownReport text={prefix} bare writing />);
    if (view.container.querySelector("table") !== null)
      moments.push({
        rows: view.container.querySelectorAll("tbody tr").length,
        steps: stepsDrawn(view.container),
      });
  }
  view.rerender(<MarkdownReport text={text} bare />);
  const settled = stepsDrawn(view.container);
  cleanup();
  const whole = stepsDrawn(
    render(<MarkdownReport text={text} bare />).container,
  );
  cleanup();
  return { moments, settled, whole };
}

/** The moments at which one column stepped, as the body rows the table had. */
function changes(moments: readonly Moment[], column: number): number[] {
  return moments.flatMap((moment, at) => {
    const before = moments[at - 1]?.steps[column];
    return before !== undefined && before !== moment.steps[column]
      ? [moment.rows]
      : [];
  });
}

const tables: readonly (readonly [string, string])[] = [
  ["three columns, one of prose", services],
  ["three short columns", counts],
  ["six columns, four of them short", gates],
  ["a table whose long cell arrives late", late],
  ["a table that ends in the longest cell of a column", endsLongest],
  ["a table whose rows have no pipes at their edges", edgeless],
];

describe("a table's columns, while it is written", () => {
  test.each(tables)("%s: a column only steps up", (_name, text) => {
    for (const stride of [1, 3]) {
      const { moments } = written(text, stride);
      expect(moments.length).toBeGreaterThan(10);
      moments.forEach((moment, at) => {
        const before = moments[at - 1]?.steps ?? [];
        expect(moment.steps.length).toBeGreaterThanOrEqual(before.length);
        before.forEach((step, column) => {
          expect(moment.steps[column]).toBeGreaterThanOrEqual(step);
        });
        expect(moment.steps).not.toContain(-1);
      });
    }
  });

  test.each(tables.slice(0, 5))(
    "%s: written to its end it is at the steps it settles at, which are the steps it is read whole at",
    (_name, text) => {
      for (const stride of [1, 3]) {
        const { moments, settled, whole } = written(text, stride);
        expect(moments.at(-1)?.steps).toEqual(settled);
        expect(settled).toEqual(whole);
        expect(whole).toEqual(steps(text));
      }
    },
  );

  test("a row with no pipe at its end is counted when the text is whole, and is then as it is read whole", () => {
    const text = "a | b\n--- | ---\nx | TypeScript";
    const { moments, settled, whole } = written(text, 1);
    expect(moments.at(-1)?.steps).toEqual([mark, mark]);
    expect(settled).toEqual([mark, name]);
    expect(whole).toEqual(settled);
  });

  test.each(tables)(
    "%s: no column changes more often than there are steps to pass",
    (_name, text) => {
      const { moments } = written(text, 1);
      const most = markdownColumnClassNames.length - 1;
      (moments.at(-1)?.steps ?? []).forEach((_step, column) => {
        expect(changes(moments, column).length).toBeLessThanOrEqual(most);
      });
    },
  );

  test.each(tables.slice(0, 3))(
    "%s: its rows are alike, and nothing steps after its second",
    (_name, text) => {
      const { moments } = written(text, 1);
      const rows = (moments.at(-1)?.steps ?? []).flatMap((_step, column) =>
        changes(moments, column),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(Math.max(...rows)).toBeLessThanOrEqual(2);
    },
  );

  test("a long cell that arrives late steps its column once, while it is written, and no other", () => {
    const { moments } = written(late, 1);
    const stepped = (column: number): number[] =>
      changes(moments, column).filter((row) => row > 0);
    expect(stepped(0)).toEqual([]);
    expect(stepped(1)).toEqual([]);
    expect(stepped(2)).toEqual([lateRow]);
    expect(moments.at(-1)?.steps).toEqual([word, word, prose]);
  });
});

/** The steps a text's table is drawn at while more of the text is coming. */
function open(text: string): readonly number[] {
  const drawn = stepsDrawn(
    render(<MarkdownReport text={text} bare writing />).container,
  );
  cleanup();
  return drawn;
}

describe("the cell a text ends in", () => {
  const head = "| a | b |\n| --- | --- |\n";

  test("is not counted while it is short of the widest step and nothing has closed it", () => {
    expect(open(`${head}| x | TypeScri`)).toEqual([mark, mark]);
    expect(open(`${head}| x | TypeScript`)).toEqual([mark, mark]);
    expect(open(`${head}| x | ${"ab ".repeat(21)}ab`)).toEqual([mark, mark]);
    expect(open(`${head}| Console`)).toEqual([mark, mark]);
  });

  test("is counted once the pipe that ends its row has closed it, or another cell has begun", () => {
    expect(open(`${head}| x | TypeScript |`)).toEqual([mark, name]);
    expect(open(`${head}| x | TypeScript |\n`)).toEqual([mark, name]);
    expect(open(`${head}| x | TypeScript |\n| y`)).toEqual([mark, name]);
    expect(open(`${head}| Console | y`)).toEqual([word, mark]);
    expect(open("| a | Language |")).toEqual([mark, name]);
  });

  test("is counted as soon as it reaches the widest step, and at no step short of it", () => {
    expect(open(`${head}| x | ${"ab ".repeat(21)}abc`)).toEqual([mark, prose]);
    expect(open(`${head}| x | characteristic`)).toEqual([mark, mark]);
    expect(open(`${head}| x | characteristic |`)).toEqual([mark, path]);
  });

  test("is not counted for a blank it ends in, which the pipe after it takes back", () => {
    expect(open(`${head}| x | ${"ab ".repeat(22)}`)).toEqual([mark, mark]);
    expect(open(`${head}| x | ${"ab ".repeat(22)}|`)).toEqual([mark, phrase]);
  });

  test("is counted once the text goes on past the table", () => {
    expect(open(`${head}| x | TypeScript\n\nAnd then`)).toEqual([mark, name]);
  });
});
