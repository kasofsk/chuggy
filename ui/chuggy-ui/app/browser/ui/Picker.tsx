/**
 * One choice out of a short roster, drawn as a menu of radio items.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import { MenuContent, menuItemClassName } from "./Menu.tsx";

import "./Picker.css";

export interface PickerOption {
  readonly value: string;
  readonly text: string;
}

export function Picker(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly PickerOption[];
  readonly onChoose: (value: string) => void;
  readonly sideOffset?: number;
  /** What the trigger says while the held value is none of the options, so a
   * choice nobody has made yet reads as one rather than as a blank control. */
  readonly placeholder?: string;
}): ReactNode {
  const chosen = props.options.find(
    (candidate) => candidate.value === props.value,
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={buttonLookClassName({ size: "sm" })}>
        <span className="visually-hidden">{props.label}</span>
        {` ${chosen?.text ?? props.placeholder ?? props.value}`}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent sideOffset={props.sideOffset ?? 4}>
          <DropdownMenu.RadioGroup
            value={props.value}
            onValueChange={props.onChoose}
          >
            {props.options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                className={menuItemClassName}
                value={option.value}
              >
                <span className="picker-gutter">
                  <DropdownMenu.ItemIndicator className="picker-mark" />
                </span>
                {option.text}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
