/**
 * View models: the shapes the renderer draws, derived from parsed resources.
 *
 * Nothing here reads a clock, a network or a document, so every arrangement
 * the console can show is reachable from a test.
 */

import { phaseRoster } from "./resources.js";

/** Settled phases share a rank in the model and share a column group here. */
export const phaseSettled = ["Done", "Escalated", "Revoked"];

/** Non-terminal execution statuses: what an operator is watching move. */
export const executionStatusesActive = [
  "Queued",
  "Admitted",
  "Launching",
  "Running",
];

/**
 * Tickets grouped into the model's phase order, with empty phases kept visible.
 *
 * @param {ReturnType<typeof import("./resources.js").parseProject>["tickets"]} tickets
 */
export function board(tickets) {
  const columns = phaseRoster.map((phase) => ({
    phase,
    settled: phaseSettled.includes(phase),
    tickets: tickets.filter((entry) => entry.phase === phase),
  }));
  return { columns, ticketsCount: tickets.length };
}

/**
 * @param {number} active
 * @param {number} limit
 */
function headroom(active, limit) {
  if (limit === 0) return { used: active, limit, free: 0, exhausted: true };
  const free = Math.max(limit - active, 0);
  return { used: active, limit, free, exhausted: free === 0 };
}

/**
 * Queue depth, the two headroom limits, and the deficit that says a reservation
 * the account owes has not been met.
 *
 * `schedulerFreshness` is carried through as the scheduler stated it, because a
 * console that translated it into a reassuring word would be reporting an
 * absence of evidence as health.
 *
 * @param {ReturnType<typeof import("./resources.js").parseOperationalStatus>} status
 */
export function scheduler(status) {
  return {
    observedAt: status.observedAt,
    schedulerFreshness: status.schedulerFreshness,
    queued: status.queued,
    inFlight: status.admitted + status.launching + status.running,
    stages: [
      { name: "Queued", value: status.queued },
      { name: "Admitted", value: status.admitted },
      { name: "Launching", value: status.launching },
      { name: "Running", value: status.running },
    ],
    cluster: headroom(status.clusterActive, status.clusterSlotsMax),
    account: headroom(status.accountActive, status.accountMaximum),
    reservationDeficit: status.accountReservationDeficit,
  };
}

/**
 * One row per execution, carrying the scheduler's own status and the retries
 * already spent against it.
 *
 * @param {ReturnType<typeof import("./resources.js").parseExecutionsPage>} page
 */
export function executionRows(page) {
  return page.executions.map((execution) => ({
    execution: execution.execution,
    ticket: execution.ticket,
    task: execution.task,
    taskKind: execution.taskKind,
    stage: execution.stage,
    cluster: execution.cluster,
    status: execution.status,
    outcome: execution.outcome,
    active: executionStatusesActive.includes(execution.status),
    retriesSpent: execution.retriesSpent,
    registeredAt: execution.registeredAt,
    terminalAt: execution.terminalAt,
  }));
}

/**
 * A candidate row carries the version a manual dispatch must echo, so a row
 * drawn from a stale page cannot submit a version the console never saw.
 *
 * @param {Extract<ReturnType<typeof import("./resources.js").parseDispatchView>, { result: "Page" }>} page
 */
export function candidateRows(page) {
  return page.candidates.map((candidate) => ({
    ticket: candidate.ticket,
    ticketVersion: candidate.ticketVersion,
    workFanout: candidate.workFanout,
    configurationRevision: candidate.configurationRevision,
    watermark: page.token.watermark,
  }));
}

/**
 * The mutation body a candidate row submits, built only from that row.
 *
 * @param {{ ticket: number, ticketVersion: number }} row
 */
export function manualDispatchMutation(row) {
  return {
    mutation: "ManualDispatch",
    ticket: row.ticket,
    expectedTicketVersion: row.ticketVersion,
  };
}
