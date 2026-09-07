/**
 * A single-choice group of buttons over Radix's toggle group: exactly one
 * item is checked, and pressing the checked item leaves it checked.
 */

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import "./ToggleGroup.css";

export function ToggleGroup(props: {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      className="toggle-group bg-surface-2 rounded-3 inline-flex gap-1 p-1"
      aria-label={props.label}
      value={props.value}
      onValueChange={(value) => {
        if (value !== "") props.onChange(value);
      }}
    >
      {props.options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option}
          value={option}
          className={buttonLookClassName({ size: "sm" })}
        >
          {option}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
