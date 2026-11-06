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
import {
  ConversationTriggerItems,
  conversationTriggerListClass,
} from "./ConversationTriggerItems.tsx";

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
      className={conversationTriggerListClass}
    >
      <ComposerPrimitive.Unstable_TriggerPopover.Directive
        formatter={conversationMentionFormatter}
      />
      <ConversationTriggerItems />
    </ComposerPrimitive.Unstable_TriggerPopover>
  );
}
