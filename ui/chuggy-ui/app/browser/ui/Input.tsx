/**
 * One line a reader types into, in a box of the console's own: a label the box
 * carries, the unit it is read in as a suffix, and the refusal state as an
 * attribute.
 *
 * The unit sits beside the value rather than in the label because a number and
 * what it counts are read together, and a reader typing digits into a box has
 * to see which digits the wire will take.
 */

import type { ReactNode } from "react";

import "./Input.css";

export function Input(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly unit?: string;
  readonly placeholder?: string;
  readonly numeric?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
}): ReactNode {
  return (
    <span
      className="input"
      data-numeric={props.numeric === true ? "" : undefined}
      data-invalid={props.invalid === true ? "" : undefined}
    >
      <input
        className="input-box"
        aria-label={props.label}
        aria-invalid={props.invalid ?? false}
        aria-describedby={props.describedBy}
        inputMode={props.numeric === true ? "numeric" : undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {props.unit === undefined ? null : (
        <span className="input-unit">{props.unit}</span>
      )}
    </span>
  );
}
