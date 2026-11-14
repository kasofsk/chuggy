/**
 * A control with its label drawn over it: the label bound to the control by
 * `htmlFor`, an optional hint and an optional error under it, both bound by
 * `aria-describedby`, and an error that also sets `aria-invalid`.
 *
 * The control is a render prop, so the box keeps its own markup and only
 * takes the ids and states the field hands it. A required field marks its
 * label with a word rather than a colour; the word is hidden from assistive
 * technology because the control already says so through `aria-required`, and
 * a label read as "Title Required" would be a second name for the box.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";

import "./FormField.css";

/** What a field hands the control it draws. No id where no label is drawn, so
 * the control names itself with its own `aria-label`. */
export interface FormFieldBinding {
  readonly id: string | undefined;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}

/** The parts a field draws beside its label, for a control in visible-label
 * mode to pass through. */
export interface FormFieldParts {
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
}

/**
 * How a control is named: by an `aria-label` alone, where a visible label has
 * no room, or by a label drawn over it.
 */
export type FormFieldLabelling =
  | { readonly labelShown?: false }
  | ({ readonly labelShown: true } & FormFieldParts);

/** The ids of what describes a control, joined, or none where nothing does. */
export function formFieldDescribedBy(
  ids: readonly (string | undefined)[],
): string | undefined {
  const present = ids.filter((id) => id !== undefined && id !== "");
  return present.length === 0 ? undefined : present.join(" ");
}

export function FormField(
  props: FormFieldParts & {
    readonly label: string;
    /** An id the caller already describes the control with. */
    readonly describedBy?: string | undefined;
    readonly invalid?: boolean | undefined;
    readonly children: (binding: FormFieldBinding) => ReactNode;
  },
): ReactNode {
  const text = useCopyText();
  const id = useId();
  const hintId = props.hint === undefined ? undefined : `${id}-hint`;
  const errorId = props.error === undefined ? undefined : `${id}-error`;
  const required = props.required === true;
  return (
    <div className="form-field">
      <label className="form-field-label" htmlFor={id}>
        {props.label}
        {required ? (
          <span className="form-field-required" aria-hidden="true">
            {text({ id: "ui-required" })}
          </span>
        ) : null}
      </label>
      {props.children({
        id,
        describedBy: formFieldDescribedBy([props.describedBy, hintId, errorId]),
        invalid: errorId !== undefined || props.invalid === true,
        required,
      })}
      {hintId === undefined ? null : (
        <p id={hintId} className="form-field-hint">
          {props.hint}
        </p>
      )}
      {errorId === undefined ? null : (
        <p id={errorId} className="form-field-error">
          {props.error}
        </p>
      )}
    </div>
  );
}

/**
 * A control named either way `FormFieldLabelling` offers: drawn bare, naming
 * itself, or inside a `FormField`.
 */
export function FormFieldControl(
  props: FormFieldLabelling & {
    readonly label: string;
    readonly describedBy?: string | undefined;
    readonly invalid?: boolean | undefined;
    readonly children: (binding: FormFieldBinding) => ReactNode;
  },
): ReactNode {
  if (props.labelShown !== true) {
    return props.children({
      id: undefined,
      describedBy: props.describedBy,
      invalid: props.invalid === true,
      required: false,
    });
  }
  return (
    <FormField
      label={props.label}
      describedBy={props.describedBy}
      invalid={props.invalid}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      {...(props.error === undefined ? {} : { error: props.error })}
      {...(props.required === undefined ? {} : { required: props.required })}
    >
      {props.children}
    </FormField>
  );
}
