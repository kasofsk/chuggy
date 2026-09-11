/**
 * A ticket named inside prose, drawn as the chip the rest of the console draws
 * a ticket as, and followed to the ticket's own screen.
 *
 * IT IS A `Pill` WEARING A LINK. A reference says the same three things a phase
 * chip says — a mark, a tone and a word — so it takes the same classes rather
 * than a second tone mapping of its own, and a roster the wire grows reaches it
 * through `phaseTone` like everything else.
 *
 * IT DRAWS AND PERFORMS NOTHING. The number is in the reference itself; the
 * title, the phase and where following it goes are `ticketReferenceHeld`'s, so
 * this runs no read and holds no router. With nothing held it draws the number
 * alone — the degradation the agent's own objectives promise, and the reason a
 * report mounts in a suite with no provider around it.
 *
 * The anchor carries a real `href` so the ticket can be opened in a tab or
 * copied, and the press is taken back for the shell's own navigation, which is
 * what keeps following a reference from reloading the console.
 */

import type { MouseEvent, ReactNode } from "react";

import { phaseTone } from "../../core/tones.ts";
import { useTicketReferenceHeld } from "./ticketReferenceHeld.tsx";
import type { TicketReferenceHeld } from "./ticketReferenceHeld.tsx";

import "./TicketReference.css";

/** The number as the console writes it everywhere else, so a reference and a
 * row name the same ticket the same way. */
function ticketReferenceWord(ticket: number): string {
  return `#${String(ticket)}`;
}

/** A press the shell can answer, which is every press but the ones a reader
 * means for their browser — a new tab, a new window, a download. */
function ticketReferenceTaken(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function TicketReferenceChip(props: {
  readonly ticket: number;
  readonly held: TicketReferenceHeld;
}): ReactNode {
  const ticket = props.ticket;
  const facts = props.held.factsOf(ticket);
  const tone = facts === undefined ? "neutral" : phaseTone(facts.phase);
  return (
    <a
      href={props.held.hrefOf(ticket)}
      className={`pill pill-${tone} ticket-reference`}
      onClick={(event) => {
        if (!ticketReferenceTaken(event)) return;
        event.preventDefault();
        props.held.open(ticket);
      }}
    >
      <i className="pill-mark" aria-hidden="true" />
      <span className="num">{ticketReferenceWord(ticket)}</span>
      {facts?.title === undefined ? null : (
        <span className="ticket-reference-title">{facts.title}</span>
      )}
      {facts === undefined ? null : (
        <span className="visually-hidden">{facts.phase}</span>
      )}
    </a>
  );
}

export function TicketReference(props: { readonly ticket: number }): ReactNode {
  const held = useTicketReferenceHeld();
  if (held === undefined)
    return <span className="num">{ticketReferenceWord(props.ticket)}</span>;
  return <TicketReferenceChip ticket={props.ticket} held={held} />;
}
