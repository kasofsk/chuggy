/**
 * What a conversation says aloud as it changes, to a reader who cannot watch
 * it: given what it held and what it holds now, the lines to say, or nothing.
 *
 * A REPLY IS SAID TWICE AND NO MORE: once, that it is being written, when the
 * first of it reaches the page, and once whole, when its turn settles. Nothing
 * in between is said, however many fragments arrive, and a turn heard to end
 * is not yet settled, since how it ended is the mailbox's to say.
 *
 * THE WORK IS SAID AS ITS LINE, never its body: each stretch of work between
 * two texts is the one line its card is closed to, and the texts are said as
 * they were written.
 *
 * ONLY WHAT ARRIVES AT THE FOOT IS NEWS. An exchange is told apart by the name
 * it keeps while the transcript comes to hold its turn. One the column did not
 * hold that stands above the newest it did is history read in above, and says
 * nothing; a column that held nothing, or holds nothing it held, is being read
 * rather than grown, and says nothing either.
 */

import {
  conversationExchangeBegun,
  conversationExchangeNamed,
  conversationExchangeParts,
  conversationExchangeQuiet,
  conversationFailureLabel,
  conversationWorkLabel,
} from "./conversation.ts";
import type { ConversationExchange } from "./conversation.ts";
import type { CopyOrData } from "./copy.ts";
import { conversationStandingArm } from "./tones.ts";

/** The lines one change says, in the order they are said. */
export type ConversationAnnouncement = readonly CopyOrData[];

/** Whether an exchange's reply is being written: its turn has begun and has
 * not been heard to end. */
function conversationAnnouncedReplying(
  exchange: ConversationExchange | undefined,
): boolean {
  if (exchange === undefined) return false;
  const standing = exchange.standing.standing;
  if (standing !== "Running" && standing !== "Open") return false;
  return (
    conversationExchangeBegun(exchange) && !conversationExchangeQuiet(exchange)
  );
}

/** Whether an exchange's turn has settled, which is when its reply is whole. */
function conversationAnnouncedSettled(
  exchange: ConversationExchange | undefined,
): boolean {
  if (exchange === undefined) return false;
  const standing = exchange.standing.standing;
  return (
    standing !== "Running" && standing !== "Open" && standing !== "Markers"
  );
}

/** A settled reply, whole: each text, each stretch of work as its line, and
 * the word it settled on where that is anything but answered. */
function conversationAnnouncedWhole(
  exchange: ConversationExchange,
): ConversationAnnouncement {
  const standing = exchange.standing;
  if (standing.standing === "Markers") return [];
  const lines: CopyOrData[] = conversationExchangeParts(exchange).map((part) =>
    part.part === "Text" ? part.text : conversationWorkLabel(part.steps),
  );
  if (standing.standing === "Failed" && standing.failure !== undefined)
    lines.push(conversationFailureLabel(standing.failure));
  else if (standing.standing !== "Answered" || lines.length === 0)
    lines.push(
      conversationStandingArm(standing, conversationExchangeBegun(exchange))
        .word,
    );
  return lines;
}

/** What one exchange at the foot says, given what the column held of it. */
function conversationAnnouncedExchange(
  before: ConversationExchange | undefined,
  exchange: ConversationExchange,
): ConversationAnnouncement {
  if (conversationAnnouncedSettled(before)) return [];
  if (conversationAnnouncedSettled(exchange))
    return conversationAnnouncedWhole(exchange);
  if (
    conversationAnnouncedReplying(exchange) &&
    !conversationAnnouncedReplying(before)
  )
    return [{ id: "conversation-announced-replying" }];
  return [];
}

/**
 * The lines a conversation says as it goes from `previous` to `next`, or
 * nothing. `previous` is undefined on the column's first draw and while it is
 * being read, which says nothing.
 */
export function conversationAnnounced(
  previous: readonly ConversationExchange[] | undefined,
  next: readonly ConversationExchange[],
): ConversationAnnouncement | undefined {
  if (previous === undefined || previous.length === 0) return undefined;
  const held = new Map(
    previous.map((exchange) => [conversationExchangeNamed(exchange), exchange]),
  );
  const newestHeld = next.findLastIndex((exchange) =>
    held.has(conversationExchangeNamed(exchange)),
  );
  if (newestHeld === -1) return undefined;
  const lines = next.flatMap((exchange, index) => {
    const before = held.get(conversationExchangeNamed(exchange));
    if (before === undefined && index < newestHeld) return [];
    return conversationAnnouncedExchange(before, exchange);
  });
  return lines.length === 0 ? undefined : lines;
}
