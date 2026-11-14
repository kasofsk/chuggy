/**
 * A plain choice in a form: the browser's own `select`, drawn in the box an
 * `Input` is drawn in, so the platform's own list opens under a finger and a
 * keyboard. `Picker` is for a choice made outside a form.
 *
 * Named by its `aria-label`, or by a label drawn over it with `labelShown`.
 */

import type { ReactNode } from "react";

import { FormFieldControl } from "./FormField.tsx";
import type { FormFieldLabelling } from "./FormField.tsx";

import "./Select.css";

export interface SelectOption {
  readonly value: string;
  readonly text: string;
}

export function Select(
  props: {
    readonly label: string;
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly onChange: (value: string) => void;
    readonly invalid?: boolean;
    readonly disabled?: boolean;
    readonly describedBy?: string;
  } & FormFieldLabelling,
): ReactNode {
  return (
    <FormFieldControl {...props}>
      {(binding) => (
        <select
          className="select"
          id={binding.id}
          data-invalid={binding.invalid ? "" : undefined}
          aria-label={binding.id === undefined ? props.label : undefined}
          aria-invalid={binding.invalid}
          aria-describedby={binding.describedBy}
          aria-required={binding.required ? true : undefined}
          disabled={props.disabled}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </select>
      )}
    </FormFieldControl>
  );
}
