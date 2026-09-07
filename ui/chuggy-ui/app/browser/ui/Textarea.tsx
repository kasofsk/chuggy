/**
 * The box a passage is written in, grown to the text it holds and stopping at
 * the height a quoted block stops at, where it scrolls instead.
 *
 * `rows` is the fallback for a browser without `field-sizing`, so a box that
 * cannot grow still opens taller than one line rather than at the browser's own
 * default of two.
 */

import type { ReactNode } from "react";

import "./Textarea.css";

/** How tall the box opens where it cannot grow with its text. */
export const textareaRowsLeast = 6;

export function Textarea(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly mono?: boolean;
  readonly invalid?: boolean;
}): ReactNode {
  return (
    <textarea
      className="textarea"
      data-mono={props.mono === true ? "" : undefined}
      rows={textareaRowsLeast}
      aria-label={props.label}
      aria-invalid={props.invalid ?? false}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
    />
  );
}
