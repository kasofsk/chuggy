/**
 * The situation column's table of contents: one link per main-body section with
 * a one-figure summary, so the sidebar points at detail instead of holding it.
 *
 * Total over an entry with a figure, one with a note and one with neither. A
 * figure is a number the wire measured and a note is a count this page derived,
 * which is why they are two slots and not one. The entries are anchors rather
 * than tabs: a tab hides content, breaks find-in-page and cannot be linked to,
 * and the ledger below is the page — so this keeps one scroll and turns a
 * sticky aside into a way back up it.
 */

import type { ReactNode } from "react";

import type { Figure as FigureValue } from "../../core/figures.ts";
import { Figure } from "./Figure.tsx";

import "./SectionList.css";

export interface SectionEntry {
  readonly id: string;
  readonly label: string;
  readonly figure?: FigureValue | undefined;
  readonly note?: string | undefined;
}

export function SectionList(props: {
  readonly entries: readonly SectionEntry[];
}): ReactNode {
  return (
    <nav className="sections">
      {props.entries.map((entry) => (
        <a key={entry.id} href={`#${entry.id}`}>
          <span>{entry.label}</span>
          {entry.figure === undefined ? null : <Figure figure={entry.figure} />}
          {entry.note === undefined ? null : (
            <span className="sections-note">{entry.note}</span>
          )}
        </a>
      ))}
    </nav>
  );
}
