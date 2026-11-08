/**
 * Hover text a keyboard and a touch screen can also reach: the child becomes
 * the trigger and is focusable, and the text portals in beside it on hover or
 * focus. Absent text draws the child alone, matching a `title` never set.
 */

import type { ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy, CopyOrData } from "../../core/copy.ts";
import "./Tooltip.css";

function TooltipCopy(props: { readonly copy: Copy }): ReactNode {
  return useCopyText()(props.copy);
}

export function Tooltip(props: {
  readonly text: CopyOrData | undefined;
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
            {typeof props.text === "string" ? (
              props.text
            ) : (
              <TooltipCopy copy={props.text} />
            )}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
