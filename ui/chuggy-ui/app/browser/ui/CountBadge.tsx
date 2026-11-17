/**
 * A number in a small rounded mark: how many of something a tab, a link or a
 * heading stands for, marked as a least where the read it came from was cut.
 *
 * The figure alone says nothing about what it counts, so the caller names it
 * whole, the figure and what it counts together, and that name is what
 * assistive technology reads; the drawn figure is hidden from it, so it is not
 * read twice.
 */

import type { ReactNode } from "react";

import "./CountBadge.css";

/** The count as its badge draws it. */
export function countBadgeFigure(count: number, cut?: boolean): string {
  return cut === true ? `${String(count)}+` : String(count);
}

export function CountBadge(props: {
  readonly count: number;
  readonly cut?: boolean | undefined;
  readonly name: string;
}): ReactNode {
  return (
    <span className="count-badge">
      <span aria-hidden="true">{countBadgeFigure(props.count, props.cut)}</span>
      <span className="visually-hidden">{props.name}</span>
    </span>
  );
}
