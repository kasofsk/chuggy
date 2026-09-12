/**
 * What the composer's `@` list offers, and how a pick is written into the
 * message.
 *
 * THE FORMATTER IS THE WHOLE OF THE COUPLING. `@assistant-ui/react` owns the
 * popover, the filtering, the keyboard and the replacement, and asks this only
 * two things: what a picked item is written as, and how to read a written one
 * back. Both answers are the contract's `ticketReference`, so what a member
 * picks out of the list is character for character what an agent is asked to
 * write and what the reader draws a widget from.
 *
 * A TICKET IS FOUND BY NUMBER OR BY TITLE, AND THE TWO ARE ONE QUERY. A member
 * typing `@ticket 15` is naming a number and one typing `@ticket fix the
 * thing` is naming a title, so the list does not ask which was meant: a query
 * is matched against both, and a run of digits matches a number that starts
 * with it as well as a title that contains it.
 *
 * WHAT IS NOT LOADED IS NOT OFFERED. The listing this draws from is the rows
 * the reader's own table has paged in, so a project past that has tickets the
 * list cannot show. An exact number is the exception and always stands, because
 * a member who typed a number has already said which ticket they mean and the
 * reference resolves against a read rather than against this list.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import {
  ticketReferenceSerialize,
  ticketReferenceSplit,
} from "../../../../src/contract/ticketReference.ts";

/** The kind a mention carries, which is also the word a member may type after
 * the `@` to mean this kind and nothing else. */
export const conversationMentionKind = "ticket";

/** One offered ticket, in the shape the popover takes. */
export interface ConversationMentionItem {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description: string | undefined;
}

/** The number as the console writes it everywhere, which is what a member reads
 * in the list and what they typed to find it. */
function conversationMentionLabel(ticket: number): string {
  return `#${String(ticket)}`;
}

/** One ticket as the list offers it: the number leads, because that is what a
 * reference is, and the title is what a member is searching by. */
export function conversationMentionItem(
  ticket: TicketResponse,
): ConversationMentionItem {
  return {
    id: String(ticket.ticket),
    type: conversationMentionKind,
    label: conversationMentionLabel(ticket.ticket),
    description: ticket.title ?? ticket.phase,
  };
}

/**
 * The query left once the kind has been named, and nothing where the typing so
 * far is still spelling the kind out. A member part way through `@tic` is
 * filtering nothing yet, and offering them every ticket at that moment is the
 * same list as offering them none.
 */
export function conversationMentionQuery(typed: string): string {
  const trimmed = typed.trimStart();
  const lowered = trimmed.toLowerCase();
  if (!lowered.startsWith(conversationMentionKind))
    return conversationMentionKind.startsWith(lowered) ? "" : trimmed;
  return trimmed.slice(conversationMentionKind.length).trim();
}

/**
 * Whether one offered ticket answers the query, by the number it carries or by
 * the words of the title it is described with. The words need not be
 * neighbours, because a member half remembering a title types the words they
 * remember and not the ones between them.
 */
export function conversationMentionMatches(
  item: ConversationMentionItem,
  query: string,
): boolean {
  if (query === "") return true;
  const lowered = query.toLowerCase();
  if (item.id.startsWith(lowered)) return true;
  const written = `${item.label} ${item.description ?? ""}`.toLowerCase();
  return lowered
    .split(/\s+/u)
    .filter((term) => term !== "")
    .every((term) => written.includes(term));
}

/** The offered tickets that answer the query, in the order the listing gave
 * them. */
export function conversationMentionFiltered(
  items: readonly ConversationMentionItem[],
  query: string,
): readonly ConversationMentionItem[] {
  return items.filter((item) => conversationMentionMatches(item, query));
}

/**
 * The most a query may run to before the `@` that opened it is taken to have
 * been a stray one. It bounds a list that would otherwise stay open over a
 * whole paragraph, because this list's queries hold spaces and so cannot end at
 * the first one.
 */
export const conversationMentionQueryCharsMax = 64;

/** What the popover replaces and what it searches on, or nothing where the
 * caret is not inside a mention at all. */
export interface ConversationMentionMatch {
  readonly query: string;
  readonly offset: number;
  readonly endOffset: number;
}

/**
 * Where the mention the caret sits in began, reading back over the spaces the
 * library's own matcher stops at — a title is several words, so a query ending
 * at the first space could never name one — and ending instead at a line break
 * and at the bound above, so an `@` typed in the ordinary course of a sentence
 * stops offering tickets a paragraph later.
 *
 * A CARET ON THE TRIGGER IS OUTSIDE THE MENTION, WHICH IS HOW ESCAPE CLOSES:
 * the library answers escape by moving the caret back to the `@` and asking
 * again, and its own matcher refuses that position only incidentally, because
 * it stops at the first space and a caret on an `@` has nothing behind it to
 * find — this one reads back over spaces and would find an earlier `@` in the
 * same line, reopening the list over a query nobody typed.
 */
export function conversationMentionMatch(
  text: string,
  triggerChar: string,
  cursorPosition: number,
): ConversationMentionMatch | null {
  if (text.startsWith(triggerChar, cursorPosition)) return null;
  const before = text.slice(0, cursorPosition);
  for (let at = before.length - triggerChar.length; at >= 0; at -= 1) {
    const query = before.slice(at + triggerChar.length);
    if (query.length > conversationMentionQueryCharsMax) return null;
    if (query.includes("\n")) return null;
    if (!before.startsWith(triggerChar, at)) continue;
    const leading = at === 0 ? undefined : before[at - 1];
    if (leading !== undefined && !/\s/u.test(leading)) continue;
    return { query, offset: at, endOffset: cursorPosition };
  }
  return null;
}

/**
 * The formatter the popover writes and reads a pick with, which is the
 * contract's own form on both sides. The parse is what lets the composer draw a
 * reference already in the box as the ticket it names rather than as brackets.
 */
export const conversationMentionFormatter = {
  serialize(item: { readonly id: string }): string {
    return ticketReferenceSerialize(Number(item.id));
  },
  parse(text: string) {
    return ticketReferenceSplit(text).map((segment) =>
      segment.kind === "Text"
        ? ({ kind: "text", text: segment.text } as const)
        : ({
            kind: "mention",
            type: conversationMentionKind,
            label: conversationMentionLabel(segment.ticket),
            id: String(segment.ticket),
          } as const),
    );
  },
};
