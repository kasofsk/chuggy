/**
 * One thing held or not, changed by a press: a box and the label beside it,
 * over Radix's checkbox.
 *
 * Total over a box with its label drawn and a bare one the label only names,
 * which is how a grid whose row and column already say what a cell is keeps
 * every box named. What is checked is the caller's own state, so a press asks
 * and the caller answers: a box that changed itself would show a change
 * nothing had made.
 */

import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import "./Checkbox.css";

function CheckboxMark(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="checkbox-mark">
      <path
        d="M2.5 6.5 L5 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Checkbox(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Drawn, and checked where it is, but never changed by a press. */
  readonly disabled?: boolean;
  /** The label names the box and is not drawn beside it. */
  readonly bare?: boolean;
}): ReactNode {
  const id = useId();
  const bare = props.bare === true;
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      className="checkbox"
      checked={props.checked}
      disabled={props.disabled ?? false}
      onCheckedChange={(checked) => {
        props.onChange(checked === true);
      }}
      {...(bare ? { "aria-label": props.label } : {})}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <CheckboxMark />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (bare) return box;
  return (
    <span className="inline-flex items-center gap-2">
      {box}
      <label
        htmlFor={id}
        className={`text-md ${props.disabled === true ? "text-ink-3" : "text-ink-2"}`}
      >
        {props.label}
      </label>
    </span>
  );
}
