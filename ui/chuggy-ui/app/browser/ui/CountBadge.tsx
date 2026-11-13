/**
 * A number in a small rounded mark: how many of something a tab, a link or a
 * heading stands for.
 *
 * The figure alone says nothing about what it counts, so the caller names it
 * whole, the figure and what it counts together, and that name is what
 * assistive technology reads; the drawn figure is hidden from it, so it is not
 * read twice.
 */

import type { ReactNode } from "react";

import "./CountBadge.css";

export function CountBadge(props: {
  readonly count: number;
  readonly name: string;
}): ReactNode {
  return (
    <span className="count-badge">
      <span aria-hidden="true">{props.count}</span>
      <span className="visually-hidden">{props.name}</span>
    </span>
  );
}
