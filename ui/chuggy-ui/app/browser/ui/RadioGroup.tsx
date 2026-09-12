/**
 * One choice out of a short roster, every option on screen at once, over
 * Radix's radio group.
 *
 * A `Picker` hides its roster behind a trigger, which suits a long one; a
 * choice between two is read and made in the same motion instead. An option may
 * carry the line saying what choosing it does, and a roster holding one is drawn
 * as a column so each line sits under the label it belongs to.
 *
 * The line's id comes from `useId` and the option's position rather than its
 * value, so it is a single token whatever the roster is spelled in:
 * `aria-describedby` is an id-reference list, and a value with a space in it
 * would split into two references naming nothing.
 */

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import "./RadioGroup.css";

export interface RadioOption {
  readonly value: string;
  readonly text: string;
  readonly description?: string;
}

function RadioGroupOption(props: {
  readonly option: RadioOption;
  readonly itemId: string;
  readonly describedBy: string;
}): ReactNode {
  const description = props.option.description;
  return (
    <span
      className={
        description === undefined ? "flex items-center gap-2" : "radio-option"
      }
    >
      <RadioGroupPrimitive.Item
        id={props.itemId}
        value={props.option.value}
        className="radio-item"
        {...(description === undefined
          ? {}
          : { "aria-describedby": props.describedBy })}
      >
        <RadioGroupPrimitive.Indicator className="radio-mark" />
      </RadioGroupPrimitive.Item>
      <label htmlFor={props.itemId} className="text-md text-ink-2">
        {props.option.text}
      </label>
      {description === undefined ? null : (
        <span id={props.describedBy} className="radio-about text-sm text-ink-3">
          {description}
        </span>
      )}
    </span>
  );
}

export function RadioGroup(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly RadioOption[];
  readonly disabled?: boolean;
  readonly onChoose: (value: string) => void;
}): ReactNode {
  const group = useId();
  const described = props.options.some(
    (option) => option.description !== undefined,
  );
  return (
    <RadioGroupPrimitive.Root
      className={described ? "grid gap-2" : "flex items-center gap-4"}
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled ?? false}
      onValueChange={props.onChoose}
    >
      {props.options.map((option, at) => (
        <RadioGroupOption
          key={option.value}
          option={option}
          itemId={`${group}-${option.value}`}
          describedBy={`${group}-about-${String(at)}`}
        />
      ))}
    </RadioGroupPrimitive.Root>
  );
}
