import {
  ticketHomeInitial,
  ticketHomeNext,
  ticketHomeReceived,
  ticketHomeRefresh,
} from "../app/ticketHome.js";

/** @typedef {import("../app/ticketHome.js").TicketHomeRead} TicketHomeRead */
/** @typedef {import("../app/ticketHome.js").TicketHomeState} TicketHomeState */
/** @typedef {import("../app/protocol.js").Partition} Partition */

/** @param {TicketHomeController} controller @param {TicketHomeRead} read */
async function ticketHomeRead(controller, read) {
  controller.state.tickets = read.state;
  controller.onChanged();
  const outcome = await controller.send(read.request);
  controller.state.tickets = ticketHomeReceived(read.state, outcome);
  controller.onChanged();
}

/**
 * @param {TicketHomeController} controller
 * @param {(token: string, partition: Partition) => TicketHomeRead | undefined} makeRead
 */
async function ticketHomeStart(controller, makeRead) {
  const token = await controller.session.accessToken();
  if (token === undefined || controller.state.partition === undefined) return;
  const read = makeRead(token, controller.state.partition);
  if (read !== undefined) await ticketHomeRead(controller, read);
}

/**
 * @typedef {{ session: { accessToken: () => Promise<string | undefined> },
 *   send: (request: import("../app/protocol.js").ApiRequest) => Promise<import("../app/protocol.js").ApiOutcome>,
 *   onChanged: () => void,
 *   onTicket: (ticket: number) => void,
 *   onNewTicket: () => void,
 *   state: { partition: Partition | undefined, tickets: TicketHomeState } }} TicketHomeController
 */

/** @param {Pick<TicketHomeController, "session" | "send" | "onChanged" | "onTicket" | "onNewTicket">} parts */
export function createTicketHome(parts) {
  /** @type {TicketHomeController} */
  const controller = {
    ...parts,
    state: {
      partition: undefined,
      tickets: {
        state: /** @type {const} */ ("Loading"),
        held: undefined,
        load: /** @type {const} */ ("Initial"),
      },
    },
  };
  return {
    state: controller.state,
    /** @param {Partition} partition */
    select: async (partition) => {
      controller.state.partition = partition;
      await ticketHomeStart(controller, (token, selected) =>
        ticketHomeInitial(token, selected),
      );
    },
    refresh: () =>
      ticketHomeStart(controller, (token, partition) =>
        ticketHomeRefresh(controller.state.tickets, token, partition),
      ),
    next: () =>
      ticketHomeStart(controller, (token, partition) =>
        ticketHomeNext(controller.state.tickets, token, partition),
      ),
    ticket: parts.onTicket,
    newTicket: parts.onNewTicket,
  };
}
