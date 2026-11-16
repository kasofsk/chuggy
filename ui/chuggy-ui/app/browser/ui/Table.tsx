/**
 * Comparable columns over many rows: the usage breakdowns, the attempts, the
 * turns.
 *
 * Total over a table with a caption and one without, each inside a scroller so
 * a wide table scrolls itself rather than the page. A scroller with more to
 * show says which side the more is on and is a stop for the keyboard; one that
 * holds its table whole is neither. The columns are the caller's own `thead`
 * and `tbody`, because a typed column model would restate the wire in a second
 * place and the wire is where a column comes from.
 *
 * A table that is stacked is the one exception: on a narrow container each row
 * is a card and each cell carries its column's label, so the columns are given
 * as data and every row is typed to hold one value for each. A card is headed
 * by the cell that names its row, drawn as its title, and ends in the row's
 * actions, whatever order the columns are given in. The display a card is
 * drawn with takes the table's roles away in some browsers, so they are
 * restated on every element a stacked table draws.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import "./Table.css";

export interface TableColumn<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly numeric?: boolean;
  /** The column whose cell names its row. */
  readonly rowHeader?: boolean;
  /** A column whose cells say what they are, like a press: its label is for
   * assistive technology only, and a card draws none. */
  readonly labelHidden?: boolean;
  /** The column of the row's presses: its label is hidden as `labelHidden`
   * hides one, it is drawn last, and in a card each press is a finger's
   * height. */
  readonly actions?: boolean;
  /** A column whose value is too wide to stand beside its label, which a
   * card sets under it. */
  readonly wide?: boolean;
  /** A column whose value is as short as its label, like a box: a card sets
   * it beside the next such value, its label over it, and keeps its place
   * where the row holds nothing in it. */
  readonly inline?: boolean;
  /** A class for the column's head alone, such as the width a fixed layout
   * gives the column. */
  readonly headClassName?: string;
}

export interface TableRow<Key extends string> {
  readonly key: string;
  readonly cells: Readonly<Record<Key, ReactNode>>;
  /** The cells that hold nothing for this row, which a card leaves out. */
  readonly empty?: readonly Key[];
  /** What stands under the row as part of it, such as the question one of
   * its presses asks: a line the table's width, and the foot of its card. */
  readonly below?: ReactNode;
}

type TableProps<Key extends string> =
  | { readonly caption?: string; readonly children: ReactNode }
  | {
      readonly caption?: string;
      readonly stacked: {
        readonly columns: readonly TableColumn<Key>[];
        readonly rows: readonly TableRow<Key>[];
        /** Drawn edge to edge in a card: every cell padded as the card is,
         * set on its first line's baseline, and wrapping. */
        readonly framed?: boolean;
      };
    };

/** The order a card reads in: what names the row, then the values, then the
 * row's actions. */
function tableColumnsOrdered<Key extends string>(
  columns: readonly TableColumn<Key>[],
): readonly TableColumn<Key>[] {
  const rank = (column: TableColumn<Key>): number =>
    column.rowHeader === true ? 0 : column.actions === true ? 2 : 1;
  return [...columns].sort((one, other) => rank(one) - rank(other));
}

export function Table<Key extends string>(props: TableProps<Key>): ReactNode {
  const { scroller, more } = useTableOverflow();
  const stacked = "stacked" in props ? props.stacked : undefined;
  const scrolls = more.start || more.end;
  return (
    <div
      ref={scroller}
      className={
        "tabular-scroll max-w-full overflow-x-auto" +
        (stacked === undefined ? "" : " tabular-stacking")
      }
      data-more-start={more.start ? "" : undefined}
      data-more-end={more.end ? "" : undefined}
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls && props.caption !== undefined ? "region" : undefined}
      aria-label={scrolls ? props.caption : undefined}
    >
      <table
        className={
          stacked === undefined
            ? "tabular"
            : stacked.framed === true
              ? "tabular tabular-stacked tabular-framed"
              : "tabular tabular-stacked"
        }
        role={stacked === undefined ? undefined : "table"}
      >
        {props.caption === undefined ? null : (
          <caption className="visually-hidden">{props.caption}</caption>
        )}
        {"children" in props ? (
          props.children
        ) : (
          <TableStackedBody
            columns={tableColumnsOrdered(props.stacked.columns)}
            rows={props.stacked.rows}
          />
        )}
      </table>
    </div>
  );
}

function TableStackedBody<Key extends string>(props: {
  readonly columns: readonly TableColumn<Key>[];
  readonly rows: readonly TableRow<Key>[];
}): ReactNode {
  return (
    <>
      <thead role="rowgroup">
        <tr role="row">
          {props.columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              role="columnheader"
              className={tableCellClassName(column, column.headClassName)}
            >
              {tableLabelHidden(column) ? (
                <span className="visually-hidden">{column.label}</span>
              ) : (
                column.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {props.rows.map((row) => (
          <Fragment key={row.key}>
            <tr role="row">
              {props.columns.map((column) => (
                <TableStackedCell
                  key={column.key}
                  column={column}
                  empty={row.empty?.includes(column.key) === true}
                >
                  {row.cells[column.key]}
                </TableStackedCell>
              ))}
            </tr>
            {row.below === undefined || row.below === null ? null : (
              <tr role="row" className="tabular-below">
                <td role="cell" colSpan={props.columns.length}>
                  {row.below}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </>
  );
}

function tableLabelHidden<Key extends string>(
  column: TableColumn<Key>,
): boolean {
  return column.labelHidden === true || column.actions === true;
}

function tableCellClassName<Key extends string>(
  column: TableColumn<Key>,
  own?: string,
): string | undefined {
  const named = [
    column.numeric === true ? "num" : undefined,
    column.actions === true ? "tabular-actions" : undefined,
    column.wide === true ? "tabular-wide" : undefined,
    column.inline === true ? "tabular-inline" : undefined,
    own,
  ].filter((name) => name !== undefined);
  return named.length === 0 ? undefined : named.join(" ");
}

/** A cell's label is drawn for the eye only: its column header already names
 * it to assistive technology, which would otherwise hear the label twice. The
 * cell that names its row draws none, since it is its card's title. */
function TableStackedCell<Key extends string>(props: {
  readonly column: TableColumn<Key>;
  readonly empty: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const className = tableCellClassName(props.column);
  const empty = props.empty ? "" : undefined;
  const content = (
    <>
      {tableLabelHidden(props.column) ||
      props.column.rowHeader === true ? null : (
        <span className="tabular-label" aria-hidden="true">
          {props.column.label}
        </span>
      )}
      <span className="tabular-value">{props.children}</span>
    </>
  );
  return props.column.rowHeader === true ? (
    <th scope="row" role="rowheader" className={className} data-empty={empty}>
      {content}
    </th>
  ) : (
    <td role="cell" className={className} data-empty={empty}>
      {content}
    </td>
  );
}

/** Whether the scroller holds more than it shows, before its start and past
 * its end, measured again whenever it scrolls or changes size. */
function useTableOverflow(): {
  readonly scroller: RefObject<HTMLDivElement | null>;
  readonly more: { readonly start: boolean; readonly end: boolean };
} {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const before = Math.abs(element.scrollLeft);
      const start = before > 0;
      const end = before + element.clientWidth < element.scrollWidth - 1;
      setMore((held) =>
        held.start === start && held.end === end ? held : { start, end },
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild !== null)
      observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  return { scroller, more };
}
