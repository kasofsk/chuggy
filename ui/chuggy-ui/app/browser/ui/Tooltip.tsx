/**
 * Hover text a keyboard and a touch screen can also reach. It opens on hover
 * or on the trigger's focus, stays open while the pointer is over it, and
 * closes on Escape with focus left where it was. Absent text draws the child
 * alone, matching a `title` never set.
 *
 * `trigger` says what the child is, and has no default, so no caller makes a
 * keyboard stop by accident:
 * - `control`: the child is a button, link or input, or wraps one. Its own
 *   focus opens the text, which describes it; nothing is added to the tab order.
 * - `abbreviation`: the child shortens what the text spells out. It becomes
 *   focusable, and the text is its description.
 * - `decoration`: nothing becomes focusable; the text is also drawn visually
 *   hidden beside the child, for assistive technology.
 */

import type { ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy, CopyOrData } from "../../core/copy.ts";
import "./Tooltip.css";

export type TooltipTrigger = "control" | "abbreviation" | "decoration";

function TooltipCopy(props: { readonly copy: Copy }): ReactNode {
  return useCopyText()(props.copy);
}

function TooltipText(props: { readonly text: CopyOrData }): ReactNode {
  return typeof props.text === "string" ? (
    props.text
  ) : (
    <TooltipCopy copy={props.text} />
  );
}

export function Tooltip(props: {
  readonly text: CopyOrData | undefined;
  readonly trigger: TooltipTrigger;
  readonly children: ReactElement;
  readonly sideOffset?: number;
}): ReactElement {
  if (props.text === undefined) return props.children;
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root disableHoverableContent={false}>
        <TooltipPrimitive.Trigger
          asChild
          {...(props.trigger === "abbreviation" ? { tabIndex: 0 } : {})}
        >
          {props.children}
        </TooltipPrimitive.Trigger>
        {props.trigger === "decoration" ? (
          <span className="visually-hidden">
            <TooltipText text={props.text} />
          </span>
        ) : null}
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="tooltip"
            sideOffset={props.sideOffset ?? 6}
          >
            <TooltipText text={props.text} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
