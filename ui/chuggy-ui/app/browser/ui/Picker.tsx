/**
 * One choice out of a short roster, drawn as a menu of radio items, and any
 * action that belongs beside the roster under it. The trigger is no wider
 * than its place and clips the chosen text to that, so a hint is how a caller
 * keeps the whole of it reachable.
 *
 * `modal={false}` keeps `react-remove-scroll` out of the tree: it appends a
 * `<style>` element the served `style-src 'self'` refuses.
 */

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import { buttonLookClassName } from "./Button.tsx";
import { MenuContent, menuItemClassName } from "./Menu.tsx";
import { Tooltip } from "./Tooltip.tsx";

import "./Picker.css";

export interface PickerOption {
  readonly value: string;
  readonly text: string;
}

/** An item under the roster that does something rather than choosing a value. */
export interface PickerAction {
  readonly text: string;
  readonly onSelect: () => void;
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
  /** What hovering or focusing the trigger reveals. */
  readonly hint?: string | undefined;
  readonly actions?: readonly PickerAction[];
}): ReactNode {
  const chosen = props.options.find(
    (candidate) => candidate.value === props.value,
  );
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip text={props.hint}>
        <DropdownMenu.Trigger
          className={`${buttonLookClassName({ size: "sm" })} min-w-0 max-w-full`}
        >
          <span className="visually-hidden">{props.label}</span>{" "}
          <span className="min-w-0 truncate">
            {chosen?.text ?? props.placeholder ?? props.value}
          </span>
        </DropdownMenu.Trigger>
      </Tooltip>
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
          {props.actions === undefined || props.actions.length === 0 ? null : (
            <>
              {props.options.length === 0 ? null : (
                <DropdownMenu.Separator className="bg-edge my-1 h-px" />
              )}
              {props.actions.map((action) => (
                <DropdownMenu.Item
                  key={action.text}
                  className={menuItemClassName}
                  onSelect={action.onSelect}
                >
                  <span className="picker-gutter" />
                  {action.text}
                </DropdownMenu.Item>
              ))}
            </>
          )}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
