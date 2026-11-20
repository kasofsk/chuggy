/**
 * One setting on or off, over Radix's switch: the track a press moves, the
 * label beside it, and the line under it saying what turning it on does.
 *
 * What is on is the caller's own state, so a press asks and the caller
 * answers, as a checkbox's does.
 */

import { Switch as SwitchPrimitive } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import "./Switch.css";

export function Switch(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** What it does, read with its name. */
  readonly about?: ReactNode;
  readonly disabled?: boolean;
}): ReactNode {
  const id = useId();
  const aboutId = useId();
  return (
    <span className="grid gap-1">
      <span className="inline-flex items-center gap-2">
        <SwitchPrimitive.Root
          id={id}
          className="switch"
          checked={props.checked}
          disabled={props.disabled ?? false}
          onCheckedChange={props.onChange}
          {...(props.about === undefined
            ? {}
            : { "aria-describedby": aboutId })}
        >
          <SwitchPrimitive.Thumb className="switch-thumb" />
        </SwitchPrimitive.Root>
        <label htmlFor={id} className="text-md text-ink-2">
          {props.label}
        </label>
      </span>
      {props.about === undefined ? null : (
        <span id={aboutId} className="grid gap-1 text-xs text-ink-3">
          {props.about}
        </span>
      )}
    </span>
  );
}
