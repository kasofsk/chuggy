/**
 * What a ticket's page draws of where each action its repository declares
 * stands for the commit the ticket landed at: one line an action, in the order
 * the read gives them, or no row at all.
 *
 * THE RESPONSE'S FIELDS ARE READ HERE AND NOWHERE ELSE. Every part of the page
 * is handed lines, so a field the read renames or drops is one module's
 * change; the five marks themselves are worded and toned in `tones.ts`, where
 * every roster of the wire's is.
 *
 * A ROW IS DRAWN FOR A LINE TO SHOW OR FOR A READ THAT DID NOT ANSWER, AND FOR
 * NOTHING ELSE. A ticket that landed nowhere answers no action, which the
 * contract holds, and so does a repository that declares none; a read still
 * out for the first time has nothing to say either way. So no line is no row,
 * and the row arrives with its first answer.
 *
 * A REPORTER'S WORDS ARE CARRIED AS THE TEXT THEY ARE. `detail` and `link` are
 * whatever a reporter sent, bounded by the API and parsed by the contract; the
 * link is offered under the host it names, which is where a press will go.
 * The detail is carried for a failure alone.
 *
 * THE READ IS ASKED AGAIN ON A CLOCK, because no frame says a report arrived.
 */

import type { TicketActionReachResponse } from "../../../../src/contract/actionReach.ts";
import type { PanelState } from "./freshness.ts";
import { commitLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { actionReachArm } from "./tones.ts";
import type { ActionReach } from "./tones.ts";

type TicketDeliveryAction = TicketActionReachResponse["actions"][number];

/**
 * How often the read is asked again while a page draws it: the wait the server
 * keeps before asking again of a commit it could not weigh. An `Unknown` is
 * not settled for that long, since one left by a read cut short is cleared by
 * whichever read comes next.
 */
export const ticketDeliveryPolledMs = 30_000;

/** The part under a ticket's own key the read is kept at, which no frame names. */
export function ticketDeliveryResource(ticket: number): string {
  return `${String(ticket)}/action-reach`;
}

/** Where a reporter says more is read, and the host that address names. */
export interface TicketDeliveryLink {
  readonly href: string;
  readonly host: string;
}

/** One declared action as the row draws it. */
export interface TicketDeliveryLine {
  readonly action: string;
  readonly name: string;
  readonly reach: ActionReach;
  /** The commit of the report the mark was read from, absent where it was read from none. */
  readonly commit: Label | undefined;
  readonly detail: string | undefined;
  readonly link: TicketDeliveryLink | undefined;
}

export type TicketDeliveryState = PanelState<readonly TicketDeliveryLine[]>;

function ticketDeliveryLink(
  link: string | undefined,
): TicketDeliveryLink | undefined {
  return link === undefined
    ? undefined
    : { href: link, host: new URL(link).host };
}

function ticketDeliveryLine(action: TicketDeliveryAction): TicketDeliveryLine {
  const observation = action.observation;
  return {
    action: action.action,
    name: action.name,
    reach: action.reach,
    commit: observation === null ? undefined : commitLabel(observation.commit),
    detail: action.reach === "Failed" ? action.observation.detail : undefined,
    link: ticketDeliveryLink(observation?.link),
  };
}

/** One line per action the read answered, in the read's own order. */
export function ticketDeliveryLines(
  reach: TicketActionReachResponse,
): readonly TicketDeliveryLine[] {
  return reach.actions.map(ticketDeliveryLine);
}

/** The read's state with its answer turned into the lines the page draws. */
export function ticketDeliveryRead(
  state: PanelState<TicketActionReachResponse>,
): TicketDeliveryState {
  return state.state === "Ready"
    ? { ...state, value: ticketDeliveryLines(state.value) }
    : state;
}

/** Whether the row is drawn: for a line to show, or for a read that did not answer. */
export function ticketDeliveryDrawn(state: TicketDeliveryState): boolean {
  switch (state.state) {
    case "Pending":
      return false;
    case "Absent":
    case "Failed":
      return true;
    case "Ready":
      return state.value.length > 0;
  }
}

/** What a closed row says of a read that did not answer. */
const ticketDeliveryUnread = "Not read";

/** The marks in the order a reader needs them: what went wrong, what cannot be said, what is still to come, what is done. */
const ticketDeliveryConcern: Readonly<Record<ActionReach, number>> = {
  Failed: 0,
  RolledBack: 1,
  Unknown: 2,
  NotYet: 3,
  Reached: 4,
};

/** How many lines stand at each mark, as one counted word a mark. */
function ticketDeliveryCounts(lines: readonly TicketDeliveryLine[]): string {
  const counted = new Map<ActionReach, number>();
  for (const line of lines)
    counted.set(line.reach, (counted.get(line.reach) ?? 0) + 1);
  return [...counted]
    .sort(
      ([left], [right]) =>
        ticketDeliveryConcern[left] - ticketDeliveryConcern[right],
    )
    .map(([reach, count]) => `${String(count)} ${actionReachArm(reach).word}`)
    .join(" · ");
}

/** What the closed row says on the right, and nothing where no row is drawn. */
export function ticketDeliverySummary(
  state: TicketDeliveryState,
): string | undefined {
  if (!ticketDeliveryDrawn(state)) return undefined;
  return state.state === "Ready"
    ? ticketDeliveryCounts(state.value)
    : ticketDeliveryUnread;
}
