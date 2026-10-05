/**
 * What the suites of a turn that is out share: the turn itself as a page hands
 * it to the surface, and the reading of everything on the surface that moves.
 */

import type { ConversationExchange } from "../app/core/conversation.ts";

/** A turn a runner has and nothing has come of, with whatever a case says has. */
export function running(
  exchange: Partial<ConversationExchange>,
): ConversationExchange {
  return {
    id: "turn-1",
    turn: "turn-1",
    ask: { ask: "Message", text: "where does 41 stand" },
    work: [],
    standing: { standing: "Running", state: "Claimed" },
    before: [],
    ...exchange,
  };
}

/** Everything on a conversation that is moving, each named by what it is: the
 * engine where an answer is about to be, the mark at the end of text being
 * written, the glyph on the line under an answer, and the glyph on the line of
 * a part of the work. */
export function moving(container: HTMLElement): readonly string[] {
  const named = (selector: string, name: string): readonly string[] =>
    Array.from(container.querySelectorAll(selector), () => name);
  return [
    ...named(".conversation-waiting-engine", "engine"),
    ...named(".conversation-writing .run-report-mark", "mark"),
    ...named(".conversation-meta .conversation-glyph-live", "glyph"),
    ...named(".conversation-work-line .conversation-glyph-live", "card"),
  ];
}
