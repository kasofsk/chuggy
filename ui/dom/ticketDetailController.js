import {
  ticketDetailActions,
  ticketDetailConfigurationReceived,
  ticketDetailDraftReceived,
  ticketDetailExecutionsNext,
  ticketDetailExecutionsReceived,
  ticketDetailIdentityReceived,
  ticketDetailInitial,
} from "../app/ticketDetail.js";

/** @typedef {import("../app/protocol.js").Partition} Partition */

/** @param {TicketDetail} detail @param {number} selection @param {ReturnType<typeof ticketDetailInitial>} initial */
async function readInitial(detail, selection, initial) {
  const [identity, draft, executions] = await Promise.all([
    detail.send(initial.requests.identity),
    detail.send(initial.requests.draft),
    detail.send(initial.requests.executions),
  ]);
  if (selection !== detail.selection || detail.state.detail === undefined)
    return;
  detail.state.detail = ticketDetailIdentityReceived(
    detail.state.detail,
    identity,
  );
  detail.state.detail = ticketDetailExecutionsReceived(
    detail.state.detail,
    executions,
  );
  const token = await detail.session.accessToken();
  if (token === undefined || detail.state.partition === undefined) return;
  const answered = ticketDetailDraftReceived(
    detail.state.detail,
    draft,
    token,
    detail.state.partition,
  );
  detail.state.detail = answered.state;
  detail.onChanged();
  if (answered.request === undefined) return;
  const configuration = await detail.send(answered.request);
  if (selection !== detail.selection || detail.state.detail === undefined)
    return;
  detail.state.detail = ticketDetailConfigurationReceived(
    detail.state.detail,
    configuration,
  );
  detail.onChanged();
}

/** @typedef {{ session: { accessToken: () => Promise<string | undefined> }, send: (request: import("../app/protocol.js").ApiRequest) => Promise<import("../app/protocol.js").ApiOutcome>, onChanged: () => void, onEdit: (ticket: number) => void, onDelete: (ticket: number) => void, onRelease: (ticket: number) => void, onExecution: (execution: string) => void, onArtifact: (execution: string, ordinal: number) => void, selection: number, state: { partition: Partition | undefined, detail: ReturnType<typeof ticketDetailInitial>["state"] | undefined } }} TicketDetail */

/** @param {Pick<TicketDetail, "session" | "send" | "onChanged" | "onEdit" | "onDelete" | "onRelease" | "onExecution" | "onArtifact">} parts */
export function createTicketDetail(parts) {
  /** @type {TicketDetail} */
  const detail = {
    ...parts,
    selection: 0,
    state: { partition: undefined, detail: undefined },
  };
  return {
    state: detail.state,
    /** @param {Partition} partition @param {number} ticket */
    select: async (partition, ticket) => {
      detail.selection += 1;
      const selection = detail.selection;
      const token = await detail.session.accessToken();
      if (token === undefined || selection !== detail.selection) return;
      detail.state.partition = partition;
      const initial = ticketDetailInitial(token, partition, ticket);
      detail.state.detail = initial.state;
      detail.onChanged();
      await readInitial(detail, selection, initial);
    },
    nextExecutions: async () => {
      const selection = detail.selection;
      const token = await detail.session.accessToken();
      if (
        token === undefined ||
        detail.state.partition === undefined ||
        detail.state.detail === undefined
      )
        return;
      const next = ticketDetailExecutionsNext(
        detail.state.detail,
        token,
        detail.state.partition,
      );
      if (next === undefined) return;
      detail.state.detail = next.state;
      detail.onChanged();
      const outcome = await detail.send(next.request);
      if (selection !== detail.selection || detail.state.detail === undefined)
        return;
      detail.state.detail = ticketDetailExecutionsReceived(
        detail.state.detail,
        outcome,
      );
      detail.onChanged();
    },
    edit: () => {
      if (detail.state.detail && ticketDetailActions(detail.state.detail).edit)
        parts.onEdit(detail.state.detail.ticket);
    },
    delete: () => {
      if (
        detail.state.detail &&
        ticketDetailActions(detail.state.detail).delete
      )
        parts.onDelete(detail.state.detail.ticket);
    },
    release: () => {
      if (
        detail.state.detail &&
        ticketDetailActions(detail.state.detail).release
      )
        parts.onRelease(detail.state.detail.ticket);
    },
    /** @param {string} execution */
    openExecution: (execution) => parts.onExecution(execution),
    /** @param {string} execution @param {number} ordinal */
    openArtifact: (execution, ordinal) => parts.onArtifact(execution, ordinal),
  };
}
