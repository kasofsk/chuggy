/**
 * The tickets the composer's `@` list offers, which are the tickets the
 * reader's own table has.
 *
 * IT IS THE TABLE'S OWN ENTRY, NOT A SECOND READ. The list is keyed by
 * `ticketFilterAll`, which is the key the Tickets screen holds its unfiltered
 * rows under, so opening the list costs a read only when nothing has read that
 * yet, paging the table deeper offers more tickets here, and a change frame
 * that rewrites a row rewrites it in both places at once.
 *
 * WHAT IT DOES NOT REACH IS NOT A FAULT IT HIDES. A project with more tickets
 * than have been paged in has tickets this list cannot offer, and the answer
 * for those is the number: a member who types one has already said which ticket
 * they mean, and the reference resolves against the ticket's own read rather
 * than against this list.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { conversationMentionItem } from "../../core/conversationMention.ts";
import type { ConversationMentionItem } from "../../core/conversationMention.ts";
import {
  ticketFilterAll,
  ticketFilterList,
} from "../../core/projectTableFilters.ts";
import { usePanelList } from "../api.ts";
import { ticketRowsRead } from "../ProjectTable.tsx";

export function useConversationMentions(
  partition: PartitionIdentity,
): readonly ConversationMentionItem[] {
  const client = useQueryClient();
  const state = usePanelList(
    ticketFilterList(partition, ticketFilterAll),
    (ports) => ticketRowsRead(client, ports, partition, ticketFilterAll),
  );
  /** The same array until the rows themselves change: the popover derives its
   * navigable list from this, and a fresh array on every render would put the
   * highlight back to the top under a reader's own arrow keys. */
  return useMemo(
    () =>
      state.state === "Ready"
        ? state.value.tickets.map(conversationMentionItem)
        : [],
    [state],
  );
}
