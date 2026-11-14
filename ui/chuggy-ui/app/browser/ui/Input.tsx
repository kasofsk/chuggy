/**
 * One line a reader types into, in a box of the console's own: a label the box
 * carries, the unit it is read in as a suffix, and the refusal state as an
 * attribute.
 *
 * The unit sits beside the value rather than in the label because a number and
 * what it counts are read together, and a reader typing digits into a box has
 * to see which digits the wire will take.
 *
 * Total over a box that takes typing and one that is read only: a value a
 * reader selects and copies and cannot change, which is why that form takes
 * no `onChange`.
 *
 * The label is the box's `aria-label` where a visible one has no room, and is
 * drawn over the box by `FormField` with `labelShown`.
 */

import type { ReactNode } from "react";

import { FormFieldControl } from "./FormField.tsx";
import type { FormFieldBinding, FormFieldLabelling } from "./FormField.tsx";

import "./Input.css";

/** What a box does with typing: hands it to its caller, or takes none. */
type InputTyping =
  | { readonly readOnly?: false; readonly onChange: (value: string) => void }
  | { readonly readOnly: true };

type InputProps = InputTyping & {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly placeholder?: string;
  readonly numeric?: boolean;
  readonly invalid?: boolean;
  /** Drawn, with what it holds, but taking nothing typed. */
  readonly disabled?: boolean | undefined;
  readonly describedBy?: string;
  readonly autoFocus?: boolean;
};

export function Input(props: InputProps & FormFieldLabelling): ReactNode {
  return (
    <FormFieldControl {...props}>
      {(binding) => <InputBox props={props} binding={binding} />}
    </FormFieldControl>
  );
}

function InputBox(input: {
  readonly props: InputProps;
  readonly binding: FormFieldBinding;
}): ReactNode {
  const { props, binding } = input;
  const typed = props.readOnly === true ? undefined : props.onChange;
  return (
    <span
      className="input"
      data-numeric={props.numeric === true ? "" : undefined}
      data-invalid={binding.invalid ? "" : undefined}
    >
      <input
        className="input-box"
        id={binding.id}
        aria-label={binding.id === undefined ? props.label : undefined}
        aria-invalid={binding.invalid}
        aria-describedby={binding.describedBy}
        aria-required={binding.required ? true : undefined}
        inputMode={props.numeric === true ? "numeric" : undefined}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        readOnly={typed === undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => {
          typed?.(event.target.value);
        }}
      />
      {props.unit === undefined ? null : (
        <span className="input-unit">{props.unit}</span>
      )}
    </span>
  );
}
