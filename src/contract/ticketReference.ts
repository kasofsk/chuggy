/**
 * How a ticket is named inside a thread's prose, by the member typing it and by
 * the agent answering alike.
 *
 * IT IS THE CONTRACT BECAUSE EVERY SIDE WRITES IT. The console serializes a
 * mention into this form, the console's own reader splits a turn on it to draw
 * the widget, and the objectives a thread is opened with state it to the agent
 * so the agent writes the same thing back. A copy of the grammar on any one of
 * those sides is a grammar that goes wrong the day another is reworded —
 * silently, because a reference that fails to parse draws as the literal
 * brackets a reader was never meant to see.
 *
 * IT IS DELIBERATELY NOT MARKDOWN. A worker's report is marked-up text and a
 * member's message is not, so a form that survives both has to be one neither
 * of them already gives a meaning: `[[…]]` is inert in the reports this tree
 * renders, where a bare `#15` is a heading and a `[15](…)` is a link.
 *
 * The form is read more loosely than it is written. An agent that writes
 * `[[Ticket: 15]]` meant the reference, and drawing brackets at a reader
 * because a model chose a capital would be a fault nobody could see the cause
 * of, so case and the spaces inside the braces are forgiven and one spelling
 * goes out.
 */

/**
 * The most digits a referenced ticket number may carry, which is every digit a
 * safe integer can have. A longer run names no ticket any journal could hold
 * and is left as the text it is, rather than read as a number that would round.
 */
export const ticketReferenceDigitsMax = 16;

/**
 * The grammar, written once: `[[ticket:15]]`, forgiving case and inner space.
 * A ticket number is positive, so the leading digit is not a zero and neither
 * `[[ticket:0]]` nor `[[ticket:015]]` is a reference.
 */
const ticketReferenceSource = `\\[\\[\\s*ticket\\s*:\\s*([1-9]\\d{0,${String(ticketReferenceDigitsMax - 1)}})\\s*\\]\\]`;

/** A fresh matcher for each read, because a global pattern carries its own
 * `lastIndex` and a shared one would answer differently on a second call. */
function ticketReferenceMatcher(): RegExp {
  return new RegExp(ticketReferenceSource, "giu");
}

/** One piece of a turn's prose: the words as they stand, or a ticket named. */
export type TicketReferenceSegment =
  | { readonly kind: "Text"; readonly text: string }
  | { readonly kind: "Ticket"; readonly ticket: number };

/** The one spelling that goes out, which is what a mention inserts and what the
 * agent is asked for. */
export function ticketReferenceSerialize(ticket: number): string {
  return `[[ticket:${String(ticket)}]]`;
}

/**
 * Whether the prose names any ticket at all, judged by the same reading
 * `ticketReferenceSplit` gives it so the two can never answer differently. A
 * caller that only asks this pays for no array.
 */
export function ticketReferenceNames(text: string): boolean {
  for (const match of text.matchAll(ticketReferenceMatcher()))
    if (ticketReferenceNumbered(match[1]) !== undefined) return true;
  return false;
}

/** The number a matched run of digits names, or nothing where it is past what a
 * journal could hold and reading it would round. */
function ticketReferenceNumbered(
  digits: string | undefined,
): number | undefined {
  if (digits === undefined) return undefined;
  const ticket = Number(digits);
  return Number.isSafeInteger(ticket) ? ticket : undefined;
}

/**
 * The prose as alternating words and references, with no empty run between two
 * adjacent references and the whole text as one segment where it names none.
 */
export function ticketReferenceSplit(
  text: string,
): readonly TicketReferenceSegment[] {
  const segments: TicketReferenceSegment[] = [];
  let consumed = 0;
  for (const match of text.matchAll(ticketReferenceMatcher())) {
    const ticket = ticketReferenceNumbered(match[1]);
    if (ticket === undefined) continue;
    if (match.index > consumed)
      segments.push({ kind: "Text", text: text.slice(consumed, match.index) });
    segments.push({ kind: "Ticket", ticket });
    consumed = match.index + match[0].length;
  }
  if (consumed < text.length)
    segments.push({ kind: "Text", text: text.slice(consumed) });
  return segments;
}

/**
 * What a thread is told about the form, in the objectives it is opened with. It
 * names the console's own behaviour rather than asking for a style, because an
 * agent writes the form when it knows what the form does.
 */
export const ticketReferenceInstruction = `Name a ticket as ${ticketReferenceSerialize(15)} — the double brackets, the word ticket, and the number — wherever you mean ticket 15, including in a sentence and in a list. The console draws that as the ticket's number, title and phase, and as a link its reader can follow; a bare number or a "#15" draws as the characters you typed. Name a ticket you have not filed or read this way too: a reference to a ticket that has since gone draws as the number alone, which is what your owner should see.`;
