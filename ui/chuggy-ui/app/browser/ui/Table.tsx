/**
 * Comparable columns over many rows: the usage breakdowns, the attempts, the
 * turns.
 *
 * Total over a table with a caption and one without, each inside a scroller so
 * a wide table scrolls itself rather than the page. The columns are the
 * caller's own `thead` and `tbody`, because a typed column model would restate
 * the wire in a second place and the wire is where a column comes from.
 */

import type { ReactNode } from "react";

import "./Table.css";

export function Table(props: {
  readonly caption?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="table-scroll">
      <table className="table">
        {props.caption === undefined ? null : (
          <caption className="visually-hidden">{props.caption}</caption>
        )}
        {props.children}
      </table>
    </div>
  );
}
