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
 * as data and every row is typed to hold one value for each. The display a
 * card is drawn with takes the table's roles away in some browsers, so they are
 * restated on every element a stacked table draws.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import "./Table.css";

export interface TableColumn<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly numeric?: boolean;
  /** The column whose cell names its row. */
  readonly rowHeader?: boolean;
}

export interface TableRow<Key extends string> {
  readonly key: string;
  readonly cells: Readonly<Record<Key, ReactNode>>;
}

type TableProps<Key extends string> =
  | { readonly caption?: string; readonly children: ReactNode }
  | {
      readonly caption?: string;
      readonly stacked: {
        readonly columns: readonly TableColumn<Key>[];
        readonly rows: readonly TableRow<Key>[];
      };
    };

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
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? props.caption : undefined}
    >
      <table
        className={
          stacked === undefined ? "tabular" : "tabular tabular-stacked"
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
            columns={props.stacked.columns}
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
              className={column.numeric === true ? "num" : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {props.rows.map((row) => (
          <tr key={row.key} role="row">
            {props.columns.map((column) => (
              <TableStackedCell key={column.key} column={column}>
                {row.cells[column.key]}
              </TableStackedCell>
            ))}
          </tr>
        ))}
      </tbody>
    </>
  );
}

/** A cell's label is drawn for the eye only: its column header already names
 * it to assistive technology, which would otherwise hear the label twice. */
function TableStackedCell<Key extends string>(props: {
  readonly column: TableColumn<Key>;
  readonly children: ReactNode;
}): ReactNode {
  const className = props.column.numeric === true ? "num" : undefined;
  const content = (
    <>
      <span className="tabular-label" aria-hidden="true">
        {props.column.label}
      </span>
      <span className="tabular-value">{props.children}</span>
    </>
  );
  return props.column.rowHeader === true ? (
    <th scope="row" role="rowheader" className={className}>
      {content}
    </th>
  ) : (
    <td role="cell" className={className}>
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
