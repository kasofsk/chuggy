/**
 * Why a chat's own page draws no composer under its conversation: the thread
 * takes no more messages, whoever's it is, or it is another member's, which
 * the reader reads and never writes to. A thread of the reader's own that
 * still takes messages has no such reason, and its composer says what else
 * stands in its way, a chat host away among it.
 */

import type { ThreadResponse } from "../../../../src/contract/responses.ts";
import type { ThreadStanding } from "../../../../src/contract/rosters.ts";
import type { Copy } from "./copy.ts";
import { threadStandingLabel, threadTakesMessages } from "./threads.ts";

export type ThreadPageUnavailable =
  | { readonly unavailable: "Standing"; readonly standing: ThreadStanding }
  | { readonly unavailable: "NotMine" };

export function threadPageUnavailable(
  thread: Pick<ThreadResponse, "state" | "mine">,
): ThreadPageUnavailable | undefined {
  if (!threadTakesMessages(thread))
    return { unavailable: "Standing", standing: thread.state };
  return thread.mine ? undefined : { unavailable: "NotMine" };
}

/** The line that says which, before the way forward the page links. */
export function threadPageUnavailableLine(
  unavailable: ThreadPageUnavailable,
): Copy {
  switch (unavailable.unavailable) {
    case "Standing":
      return {
        id: "chat-page-standing",
        args: { standing: threadStandingLabel(unavailable.standing) },
      };
    case "NotMine":
      return { id: "chat-page-not-mine" };
  }
}
