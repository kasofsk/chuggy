import * as ticket from "../domain/chuggernaut/ticket.js";

export interface TicketMachineHistory {
  readonly sequence: number;
  readonly decision: ticket.TicketDecision;
}

export interface TicketMachineState {
  readonly sequence: number;
  readonly graph: ticket.TicketGraph;
}

export function ticketMachineEmpty(): TicketMachineState {
  return { sequence: 0, graph: new ticket.TicketGraph(new Map()) };
}

/** Recovery applies accepted events without consulting the current policy. */
export function ticketMachineReplay(
  state: TicketMachineState,
  history: readonly TicketMachineHistory[],
): TicketMachineState {
  if (!Number.isSafeInteger(state.sequence) || state.sequence < 0)
    throw new RangeError("invalid ticket history position");
  let { sequence, graph } = state;
  for (const entry of history) {
    if (
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence !== sequence + 1
    )
      throw new Error("ticket history is not contiguous");
    if (entry.decision.kind === "TicketDecided")
      graph = ticket.evolve_checked(graph, entry.decision.event);
    sequence = entry.sequence;
  }
  return { sequence, graph };
}
