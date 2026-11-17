/**
 * A ticket creation's or edit's submit thrown as its refusal, which is how the
 * console's write hook is told one made nothing. Apart from the motions in
 * `ticketCreationRun.ts`, which answer how a submit ended as a value, so a
 * caller that is no console screen reaches them without the console's writes.
 */

import { ConsoleWriteRefused } from "./consoleWrite.ts";
import type {
  TicketCreationUnmade,
  TicketUpdateUnmade,
} from "./ticketCreationRun.ts";

/** A creation's submit thrown as its refusal: the sentence its screen draws,
 * beside how it ended, which holds the draft the next submit goes back to,
 * and the failure that ended it, the held draft's read or its release. */
export class TicketCreationRefused extends ConsoleWriteRefused {
  readonly ended: TicketCreationUnmade;

  constructor(sentence: string, ended: TicketCreationUnmade) {
    super(
      sentence,
      ended.created === "Refused"
        ? (ended.unread ?? ended.released)
        : undefined,
    );
    this.ended = ended;
  }
}

/** An edit's submit thrown as its refusal, beside how it ended and the
 * failure its release was answered with. */
export class TicketUpdateRefused extends ConsoleWriteRefused {
  readonly ended: TicketUpdateUnmade;

  constructor(sentence: string, ended: TicketUpdateUnmade) {
    super(sentence, ended.created === "Refused" ? ended.released : undefined);
    this.ended = ended;
  }
}
