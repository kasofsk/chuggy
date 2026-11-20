/**
 * One named thing a row holds, never a state: a holder, a member, a tag.
 *
 * Total over a chip that stands and one that can be taken away. The second
 * ends in a round button whose whole accessible name is its caller's, since
 * only the caller knows what the chip is removed from. The name clips inside
 * the chip, so one too long for its row never widens it.
 */

import type { ReactNode } from "react";

import "./Chip.css";

/** The chip's look as a class name, for a link drawn as one. */
export const chipClassName = "chip";

export interface ChipRemoval {
  readonly name: string;
  readonly disabled?: boolean;
  readonly onRemove: () => void;
}

function ChipCross(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="chip-cross">
      <path
        d="M3 3 L9 9 M9 3 L3 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Chip(props: {
  readonly children: ReactNode;
  readonly removal?: ChipRemoval | undefined;
}): ReactNode {
  const removal = props.removal;
  return (
    <span className={chipClassName}>
      <span className="chip-label">{props.children}</span>
      {removal === undefined ? null : (
        <button
          type="button"
          className="chip-remove"
          disabled={removal.disabled ?? false}
          onClick={removal.onRemove}
        >
          <span className="visually-hidden">{removal.name}</span>
          <ChipCross />
        </button>
      )}
    </span>
  );
}
