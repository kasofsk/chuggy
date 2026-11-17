/**
 * Hover text a keyboard and a touch screen can also reach. It opens on hover
 * or on the trigger's focus, stays open while the pointer is over it, and
 * closes on Escape with focus left where it was. Absent text draws the child
 * alone, matching a `title` never set.
 *
 * `trigger` says what the child is, and has no default, so no caller makes a
 * keyboard stop by accident:
 * - `control`: the child is a button, link or input, or wraps one. Its own
 *   focus opens the text; nothing is added to the tab order. The text
 *   describes the child, so it describes the control only where the child is
 *   the control.
 * - `abbreviation`: the child shortens what the text spells out. It becomes
 *   focusable, the text is its description, and pressing it opens the text,
 *   which is how a touch screen, where nothing hovers, reaches it. Inside a
 *   link or button a press is theirs, and opens nothing.
 * - `decoration`: nothing becomes focusable; the text is also drawn visually
 *   hidden beside the child, for assistive technology.
 */

import { useState } from "react";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy, CopyOrData } from "../../core/copy.ts";
import "./Tooltip.css";

export type TooltipTrigger = "control" | "abbreviation" | "decoration";

/** The trigger for a child wrapping a control that may be disabled: a
 * disabled control takes no focus, so its wrapper does instead. */
export function tooltipTriggerWrapping(disabled: boolean): TooltipTrigger {
  return disabled ? "abbreviation" : "control";
}

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

/** A press on an abbreviation opens its text, unless the press belongs to a
 * link or button around it; the press is kept from Radix, which closes on it. */
function tooltipAbbreviationPressed(
  event: MouseEvent<HTMLElement>,
  onOpen: () => void,
): void {
  if (event.currentTarget.closest("a[href], button") !== null) return;
  event.preventDefault();
  onOpen();
}

function TooltipShown(props: {
  readonly text: CopyOrData;
  readonly trigger: TooltipTrigger;
  readonly children: ReactElement;
  readonly sideOffset: number | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root
        disableHoverableContent={false}
        open={open}
        onOpenChange={setOpen}
      >
        <TooltipPrimitive.Trigger
          asChild
          {...(props.trigger === "abbreviation"
            ? {
                tabIndex: 0,
                onClick: (event: MouseEvent<HTMLElement>) => {
                  tooltipAbbreviationPressed(event, () => {
                    setOpen(true);
                  });
                },
              }
            : {})}
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

export function Tooltip(props: {
  readonly text: CopyOrData | undefined;
  readonly trigger: TooltipTrigger;
  readonly children: ReactElement;
  readonly sideOffset?: number;
}): ReactElement {
  if (props.text === undefined) return props.children;
  return (
    <TooltipShown
      text={props.text}
      trigger={props.trigger}
      sideOffset={props.sideOffset}
    >
      {props.children}
    </TooltipShown>
  );
}
