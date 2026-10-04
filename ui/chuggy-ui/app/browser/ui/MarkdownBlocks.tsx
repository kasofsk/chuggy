/**
 * The blocks `markdownTree.ts` reads a text into, drawn as what each is.
 *
 * NO MARK EVER BECOMES RAW HTML. Every node is its own React element, so a
 * text is never a place its writer's words could inject a script into the
 * screen reading them, and nothing here sets a `style`: a column's alignment
 * and everything else that varies is a class.
 *
 * A BLOCK DRAWN ONCE IS NOT DRAWN AGAIN. A block is drawn from the node it was
 * read into and from nothing else that changes, so one a reading has settled
 * is skipped for as long as it is the same node — which is what an answer
 * being written needs of everything above its last block.
 *
 * A LIST IS DRAWN THE SAME WHETHER ITS LINES ARE CLOSE OR SPACED. Each line's
 * words are a paragraph either way, because a list becomes spaced the moment
 * its writer leaves a blank line in it, and one that changed its elements or
 * its setting then would move everything already written in it.
 *
 * A TABLE'S COLUMNS ARE AS MANY AS ITS HEADER HAS, EACH A `col` OF ONE STEP.
 * The step is the one `markdownColumns.ts` puts the column at for what is
 * written in it, said in the `col`'s class and nowhere else, and the sheet
 * gives each step a width under a fixed layout: so a cell filling makes its
 * row taller, a column moves only when it steps, and the turn settling or the
 * stored answer read back draws the same table, because all three draw this.
 * Beside the table is a row of empty boxes of the same classes, which is what
 * the sheet holds the table's least width to.
 *
 * EVERY CELL A WRITER WROTE IS DRAWN. A table is as long and as wide as
 * `markdownGuard.ts` let its text be, and a row with more cells than its
 * header has columns keeps them in its last one, each after the pipe it was
 * written behind.
 *
 * THE MARK IS ON THE LAST THING WRITTEN, WHEREVER THAT IS. `mark` follows the
 * last block down to the paragraph, the cell or the line of code the text ends
 * in, so a caller that pulses it pulses the place the next word will land.
 */

import { Fragment, memo } from "react";
import type { ReactNode } from "react";

import { ticketReferenceSplit } from "../../../../../src/contract/ticketReference.ts";
import { MarkdownCode } from "./MarkdownCode.tsx";
import {
  markdownColumnClassNames,
  markdownColumnsStepped,
} from "./markdownColumns.ts";
import type {
  MarkdownBlock,
  MarkdownInline,
  MarkdownNodeOf,
} from "./markdownTree.ts";
import { TicketReference } from "./TicketReference.tsx";

type List = MarkdownNodeOf<"list">;
type ListItem = MarkdownNodeOf<"listItem">;
type Table = MarkdownNodeOf<"table">;
type TableRow = MarkdownNodeOf<"tableRow">;

/** How deep blocks or marks may sit inside each other and still be drawn as
 * what they are; past it they are drawn as their words. */
export const markdownDepthMax = 16;

/** The class the last thing written carries while more is coming. */
export const markdownMarkClassName = "run-report-mark";

function marked(mark: boolean): string | undefined {
  return mark ? markdownMarkClassName : undefined;
}

/**
 * Whether a block ends in something the mark can be put on, which is every
 * block but one ending in a rule: a rule has no words for a next one to follow.
 */
export function markdownMarkCarried(block: MarkdownBlock): boolean {
  let last: MarkdownBlock | ListItem | undefined = block;
  for (let depth = 0; depth <= markdownDepthMax; depth += 1) {
    if (last === undefined) return true;
    if (last.type === "thematicBreak") return false;
    if (last.type === "list") last = last.children.at(-1);
    else if (last.type === "listItem" || last.type === "blockquote")
      last = last.children.at(-1);
    else return true;
  }
  return true;
}

/** Everything a node says, without the marks it says it in. */
function markdownWords(
  node: MarkdownBlock | MarkdownInline | ListItem,
): string {
  const pending: unknown[] = [node];
  const words: string[] = [];
  while (pending.length > 0) {
    const next = pending.pop() as {
      readonly value?: string;
      readonly children?: readonly unknown[];
    };
    if (next.value !== undefined) words.push(next.value);
    if (next.children !== undefined)
      for (let at = next.children.length - 1; at >= 0; at -= 1)
        pending.push(next.children[at]);
  }
  return words.join("");
}

/** A run of plain words: a writer's own newline breaks the line, and a ticket
 * named in them is the chip the rest of the console draws one as. */
function MarkdownWords(props: {
  readonly text: string;
  readonly linked: boolean;
}): ReactNode {
  const broken = (text: string): ReactNode =>
    text.split("\n").map((line, at) => (
      <Fragment key={at}>
        {at > 0 ? <br /> : null}
        {line}
      </Fragment>
    ));
  if (props.linked) return broken(props.text);
  return ticketReferenceSplit(props.text).map((segment, at) =>
    segment.kind === "Text" ? (
      <Fragment key={at}>{broken(segment.text)}</Fragment>
    ) : (
      <TicketReference key={at} ticket={segment.ticket} />
    ),
  );
}

interface MarkdownInlineProps {
  readonly nodes: readonly MarkdownInline[];
  readonly depth: number;
  /** Whether these runs are a link's own words, which name no ticket. */
  readonly linked: boolean;
}

function MarkdownInlineView(props: {
  readonly node: MarkdownInline;
  readonly depth: number;
  readonly linked: boolean;
}): ReactNode {
  const node = props.node;
  if (props.depth > markdownDepthMax) return markdownWords(node);
  const held = (
    nodes: readonly MarkdownInline[],
    linked = props.linked,
  ): ReactNode => (
    <MarkdownInlineRun nodes={nodes} depth={props.depth + 1} linked={linked} />
  );
  if (node.type === "text")
    return <MarkdownWords text={node.value} linked={props.linked} />;
  if (node.type === "emphasis") return <em>{held(node.children)}</em>;
  if (node.type === "strong") return <strong>{held(node.children)}</strong>;
  if (node.type === "delete") return <del>{held(node.children)}</del>;
  if (node.type === "inlineCode") return <code>{node.value}</code>;
  if (node.type === "break") return <br />;
  if (node.type !== "link") return markdownWords(node);
  return (
    <a href={node.url} target="_blank" rel="noreferrer">
      {held(node.children, true)}
    </a>
  );
}

/** A block's runs, each drawn as the mark it is. */
export function MarkdownInlineRun(props: MarkdownInlineProps): ReactNode {
  return props.nodes.map((node, at) => (
    <MarkdownInlineView
      key={at}
      node={node}
      depth={props.depth}
      linked={props.linked}
    />
  ));
}

interface MarkdownBlockProps {
  readonly block: MarkdownBlock;
  readonly depth: number;
  /** Whether the text ends in this block while more of it is coming. */
  readonly mark: boolean;
}

function MarkdownHeading(props: {
  readonly level: number;
  readonly className: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const { className, children } = props;
  switch (props.level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
    case 5:
      return <h5 className={className}>{children}</h5>;
    default:
      return <h6 className={className}>{children}</h6>;
  }
}

/** The blocks one block holds, the mark going to the last of them. */
function MarkdownHeld(props: {
  readonly blocks: readonly MarkdownBlock[];
  readonly depth: number;
  readonly mark: boolean;
}): ReactNode {
  return props.blocks.map((block, at) => (
    <MarkdownBlockView
      key={at}
      block={block}
      depth={props.depth + 1}
      mark={props.mark && at === props.blocks.length - 1}
    />
  ));
}

function MarkdownListItem(props: {
  readonly item: ListItem;
  readonly depth: number;
  readonly mark: boolean;
}): ReactNode {
  const item = props.item;
  const task = item.checked === true || item.checked === false;
  const empty = item.children.length === 0;
  return (
    <li
      className={
        [
          task ? "run-report-task" : "",
          props.mark && empty ? markdownMarkClassName : "",
        ]
          .join(" ")
          .trim() || undefined
      }
    >
      {task ? (
        <input
          type="checkbox"
          checked={item.checked === true}
          disabled
          readOnly
        />
      ) : null}
      <MarkdownHeld
        blocks={item.children}
        depth={props.depth}
        mark={props.mark}
      />
    </li>
  );
}

function MarkdownList(props: {
  readonly list: List;
  readonly depth: number;
  readonly mark: boolean;
}): ReactNode {
  const list = props.list;
  const items = list.children.map((item, at) => (
    <MarkdownListItem
      key={at}
      item={item}
      depth={props.depth + 1}
      mark={props.mark && at === list.children.length - 1}
    />
  ));
  if (list.ordered !== true) return <ul>{items}</ul>;
  return <ol start={list.start ?? 1}>{items}</ol>;
}

const markdownAlignClassNames = {
  left: "run-report-align-left",
  center: "run-report-align-center",
  right: "run-report-align-right",
};

/** What one cell of a row holds: its own runs, and in the row's last column
 * the runs of every cell written past it, each behind its pipe. */
function MarkdownCellRuns(props: {
  readonly cells: TableRow["children"];
  readonly at: number;
  readonly columns: number;
  readonly depth: number;
}): ReactNode {
  const runs = (nodes: readonly MarkdownInline[]): ReactNode => (
    <MarkdownInlineRun nodes={nodes} depth={props.depth} linked={false} />
  );
  const own = runs(props.cells[props.at]?.children ?? []);
  if (props.at < props.columns - 1 || props.cells.length <= props.columns)
    return own;
  return (
    <>
      {own}
      {props.cells.slice(props.columns).map((cell, at) => (
        <Fragment key={at}>
          {" | "}
          {runs(cell.children)}
        </Fragment>
      ))}
    </>
  );
}

/** One row's cells, as many as the header has columns. */
function MarkdownTableRow(props: {
  readonly table: Table;
  readonly row: TableRow | undefined;
  readonly columns: number;
  readonly header: boolean;
  readonly depth: number;
  readonly mark: boolean;
}): ReactNode {
  const cells = props.row?.children ?? [];
  const last = Math.max(Math.min(cells.length, props.columns) - 1, 0);
  return (
    <tr>
      {Array.from({ length: props.columns }, (_unused, at) => {
        const side = props.table.align?.[at] ?? undefined;
        const className =
          [
            side === undefined ? "" : markdownAlignClassNames[side],
            props.mark && at === last ? markdownMarkClassName : "",
          ]
            .join(" ")
            .trim() || undefined;
        const held = (
          <MarkdownCellRuns
            cells={cells}
            at={at}
            columns={props.columns}
            depth={props.depth}
          />
        );
        return props.header ? (
          <th key={at} className={className}>
            {held}
          </th>
        ) : (
          <td key={at} className={className}>
            {held}
          </td>
        );
      })}
    </tr>
  );
}

function MarkdownTable(props: {
  readonly table: Table;
  readonly depth: number;
  readonly mark: boolean;
}): ReactNode {
  const [header, ...body] = props.table.children;
  const columns = header?.children.length ?? 0;
  const steps = markdownColumnsStepped(props.table, props.mark);
  const classNames = steps.map((step) => markdownColumnClassNames[step]);
  const row = (held: TableRow | undefined, at: number): ReactNode => (
    <MarkdownTableRow
      key={at}
      table={props.table}
      row={held}
      columns={columns}
      header={at === -1}
      depth={props.depth}
      mark={props.mark && at === body.length - 1}
    />
  );
  return (
    <div className="run-report-table">
      <div className="run-report-table-fit">
        <div className="run-report-table-floor" aria-hidden="true">
          {classNames.map((className, at) => (
            <span key={at} className={className} />
          ))}
        </div>
        <table>
          <colgroup>
            {classNames.map((className, at) => (
              <col key={at} className={className} />
            ))}
          </colgroup>
          <thead>{row(header, -1)}</thead>
          <tbody>{body.map(row)}</tbody>
        </table>
      </div>
    </div>
  );
}

function MarkdownBlockView(props: MarkdownBlockProps): ReactNode {
  const { block, depth, mark } = props;
  if (depth > markdownDepthMax)
    return <p className={marked(mark)}>{markdownWords(block)}</p>;
  const words = (nodes: readonly MarkdownInline[]): ReactNode => (
    <MarkdownInlineRun nodes={nodes} depth={0} linked={false} />
  );
  if (block.type === "paragraph")
    return <p className={marked(mark)}>{words(block.children)}</p>;
  if (block.type === "heading")
    return (
      <MarkdownHeading level={block.depth} className={marked(mark)}>
        {words(block.children)}
      </MarkdownHeading>
    );
  if (block.type === "list")
    return <MarkdownList list={block} depth={depth} mark={mark} />;
  if (block.type === "blockquote")
    return (
      <blockquote className={marked(mark && block.children.length === 0)}>
        <MarkdownHeld blocks={block.children} depth={depth} mark={mark} />
      </blockquote>
    );
  if (block.type === "code")
    return <MarkdownCode code={block} className={marked(mark)} />;
  if (block.type === "table")
    return <MarkdownTable table={block} depth={depth} mark={mark} />;
  if (block.type === "thematicBreak") return <hr />;
  return <p className={marked(mark)}>{markdownWords(block)}</p>;
}

/** One block of a text, skipped for as long as it is the same node. */
export const MarkdownBlockDrawn = memo(MarkdownBlockView);
