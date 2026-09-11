/**
 * The card every disclosure on this surface is: a header row that is the whole
 * trigger, and a body the reader opens. Radix `Collapsible` draws it, which is
 * where the rest of the console's disclosures are going.
 */

import { Collapsible } from "radix-ui";
import { useState } from "react";
import type { ReactNode } from "react";

import "./conversation.css";

/** A button carries the browser's own box until something takes it off, and
 * these triggers are rows rather than controls to press. */
export const conversationTriggerClassName =
  "conversation-trigger flex w-full min-w-0 items-center gap-2";

export function ConversationChevron(): ReactNode {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="conversation-chevron size-3 shrink-0"
    >
      <path
        d="M4 2 L8 6 L4 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ConversationCard(props: {
  readonly label: ReactNode;
  readonly glyph?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root
      className="bg-surface-1 border-edge rounded-3 flex flex-col gap-3 border p-3"
      open={open}
      onOpenChange={setOpen}
    >
      <Collapsible.Trigger
        className={`${conversationTriggerClassName} text-ink-3 text-sm`}
      >
        {props.glyph}
        <span className="min-w-0 grow">{props.label}</span>
        <ConversationChevron />
      </Collapsible.Trigger>
      <Collapsible.Content>{props.children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
