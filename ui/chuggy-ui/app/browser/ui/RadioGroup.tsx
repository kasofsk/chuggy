/**
 * One choice out of a short roster, every option on screen at once, over
 * Radix's radio group.
 *
 * A `Picker` hides its roster behind a trigger, which suits a long one; a
 * choice between two is read and made in the same motion instead.
 */

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import "./RadioGroup.css";

export interface RadioOption {
  readonly value: string;
  readonly text: string;
}

export function RadioGroup(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly RadioOption[];
  readonly onChoose: (value: string) => void;
}): ReactNode {
  const group = useId();
  return (
    <RadioGroupPrimitive.Root
      className="flex items-center gap-4"
      aria-label={props.label}
      value={props.value}
      onValueChange={props.onChoose}
    >
      {props.options.map((option) => (
        <span key={option.value} className="flex items-center gap-2">
          <RadioGroupPrimitive.Item
            id={`${group}-${option.value}`}
            value={option.value}
            className="radio-item"
          >
            <RadioGroupPrimitive.Indicator className="radio-mark" />
          </RadioGroupPrimitive.Item>
          <label
            htmlFor={`${group}-${option.value}`}
            className="text-md text-ink-2"
          >
            {option.text}
          </label>
        </span>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
