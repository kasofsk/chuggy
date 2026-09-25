/**
 * A roster with a box above it that narrows it: the query is held here, the
 * rows it keeps are drawn by the caller, and a query keeping none of them is
 * one retired line rather than an empty list.
 *
 * Rows are kept by the text the caller says each one draws, and nothing else.
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
    <div className="grid gap-2">
      <Input label={props.label} value={query} onChange={setQuery} />
      {kept.length === 0 && props.rows.length > 0 ? (
        <EmptyState variant="inline" label="No match" />
      ) : (
        <ul className="grid gap-1">
          {kept.map((row) => (
            <li key={props.keyOf(row)}>{props.renderRow(row)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
