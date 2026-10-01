/**
 * A roster with a box above it that narrows it: the query is held here, the
 * rows it keeps are drawn by the caller, and a query keeping none of them is
 * one retired line rather than an empty list.
 *
 * Rows are kept by the text the caller says each one draws, and nothing else.
 * The box takes the caret when it mounts and shows its label until something
 * is typed. In a parent of bounded height the roster gives way and its rows
 * scroll under the box, so the box stays in view however long the roster is;
 * their scroller is inset as the dialog's is so a focused row's ring is not
 * clipped.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { rosterSearchFilter } from "../../core/rosterSearch.ts";
import { EmptyState } from "./EmptyState.tsx";
import { Input } from "./Input.tsx";

export function SearchableRoster<Row>(props: {
  readonly label: string;
  readonly rows: readonly Row[];
  readonly textOf: (row: Row) => string;
  readonly keyOf: (row: Row) => string;
  readonly renderRow: (row: Row) => ReactNode;
}): ReactNode {
  const [query, setQuery] = useState("");
  const kept = rosterSearchFilter(props.rows, query, props.textOf);
  return (
    <div className="grid min-h-0 shrink grid-rows-[auto_minmax(0,1fr)] gap-2">
      <Input
        label={props.label}
        placeholder={props.label}
        value={query}
        onChange={setQuery}
        autoFocus
      />
      {kept.length === 0 && props.rows.length > 0 ? (
        <EmptyState variant="inline" label="No match" />
      ) : (
        <ul className="-m-1 grid content-start gap-1 overflow-y-auto p-1">
          {kept.map((row) => (
            <li key={props.keyOf(row)}>{props.renderRow(row)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
