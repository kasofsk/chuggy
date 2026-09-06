/**
 * Hover text a keyboard and a touch screen can also reach: the child becomes
 * the trigger and is focusable, and the text portals in beside it on hover or
 * focus. Absent text draws the child alone, matching a `title` never set.
 */

import type { ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import "./Tooltip.css";

export function Tooltip(props: {
  readonly text: string | undefined;
  readonly children: ReactElement;
  readonly sideOffset?: number;
}): ReactElement {
  if (props.text === undefined) return props.children;
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild tabIndex={0}>
          {props.children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="tooltip"
            sideOffset={props.sideOffset ?? 6}
          >
            {props.text}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
