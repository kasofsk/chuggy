/**
 * The list an `@` opens over the composer, and what picking out of it writes.
 *
 * EVERYTHING BUT THE MATCHING IS THE LIBRARY'S. The popover, the caret
 * tracking, the arrow keys, the tab and enter that take the highlighted item,
 * the escape that closes, and the replacement of the typed span are all
 * `@assistant-ui/react`'s, and this supplies only the three things it cannot
 * know: which tickets exist, which of them a query answers, and what a pick is
 * written as.
 *
 * THE MATCHER IS OVERRIDDEN BECAUSE A TITLE HAS SPACES IN IT. The library's own
 * reads back from the caret to the first whitespace, which is right for a
 * handle and wrong for `@ticket fix the thing` — so `conversationMentionMatch`
 * takes its place, and carries the bound that stops a stray `@` offering
 * tickets for the rest of the paragraph.
 */

import { ComposerPrimitive } from "@assistant-ui/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  conversationMentionFiltered,
  conversationMentionFormatter,
  conversationMentionMatch,
  conversationMentionQuery,
} from "../../core/conversationMention.ts";
import type { ConversationMentionItem } from "../../core/conversationMention.ts";

import "./conversation.css";

/** The character that opens the list, which is also what a member deletes to
 * close it. */
const conversationMentionChar = "@";

export function ConversationMentions(props: {
  readonly items: readonly ConversationMentionItem[];
}): ReactNode {
  const items = props.items;
  const adapter = useMemo(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (typed: string) =>
        conversationMentionFiltered(items, conversationMentionQuery(typed)),
    }),
    [items],
  );
  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      char={conversationMentionChar}
      matcher={conversationMentionMatch}
      adapter={adapter}
      className="conversation-mentions bg-surface-1 border-edge rounded-2 flex flex-col overflow-y-auto border"
    >
      <ComposerPrimitive.Unstable_TriggerPopover.Directive
        formatter={conversationMentionFormatter}
      />
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {(found) =>
          found.map((item, index) => (
            <ComposerPrimitive.Unstable_TriggerPopoverItem
              key={item.id}
              item={item}
              index={index}
              className="conversation-mention flex min-w-0 items-baseline gap-2 border-0 px-3 py-2 text-left"
            >
              <span className="num text-ink-1">{item.label}</span>
              <span className="text-ink-3 min-w-0 flex-1 truncate text-sm">
                {item.description}
              </span>
            </ComposerPrimitive.Unstable_TriggerPopoverItem>
          ))
        }
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </ComposerPrimitive.Unstable_TriggerPopover>
  );
}
