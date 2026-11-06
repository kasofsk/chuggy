/**
 * The options of a list a character opens over the composer, each its label
 * and what it is, which the `@` and `/` lists draw alike.
 */

import { ComposerPrimitive } from "@assistant-ui/react";
import type { ReactNode } from "react";

import "./conversation.css";

/** The list's own box, which stands over the thread above the composer. */
export const conversationTriggerListClass =
  "conversation-trigger-list bg-surface-1 border-edge rounded-2 flex flex-col overflow-y-auto border";

export function ConversationTriggerItems(): ReactNode {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(found) =>
        found.map((item, index) => (
          <ComposerPrimitive.Unstable_TriggerPopoverItem
            key={item.id}
            item={item}
            index={index}
            className="conversation-trigger-item flex min-w-0 items-baseline gap-2 border-0 px-3 py-2 text-left"
          >
            <span className="num text-ink-1">{item.label}</span>
            <span className="text-ink-3 min-w-0 flex-1 truncate text-sm">
              {item.description}
            </span>
          </ComposerPrimitive.Unstable_TriggerPopoverItem>
        ))
      }
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  );
}
