import {
  ticketCreationCreated,
  ticketCreationEdited,
  ticketCreationInitialized,
  ticketCreationReleaseEvent,
  ticketCreationSelected,
  ticketCreationSubmitted,
} from "../app/ticketCreation.js";

/** @typedef {import("../app/protocol.js").Partition} Partition */

/** @param {Creator} creator @param {ReturnType<typeof ticketCreationSelected>} read @param {number} generation */
async function creatorInitialize(creator, read, generation) {
  creator.state.creation = read.state;
  creator.onChanged();
  const outcome = await creator.send(read.request);
  if (generation !== creator.generation) return;
  creator.state.creation = ticketCreationInitialized(
    read.state.revision,
    outcome,
  );
  creator.onChanged();
}

/** @param {Creator} creator */
async function creatorSubmit(creator) {
  creator.generation += 1;
  const generation = creator.generation;
  const token = await creator.session.accessToken();
  const partition = creator.state.partition;
  const state = creator.state.creation;
  if (
    token === undefined ||
    partition === undefined ||
    state.step !== "Editing" ||
    generation !== creator.generation
  )
    return;
  const submitted = ticketCreationSubmitted(state, token, partition);
  creator.state.creation = submitted.state;
  creator.onChanged();
  if (submitted.request === undefined) return;
  const outcome = await creator.send(submitted.request);
  if (generation !== creator.generation) return;
  creator.state.creation = ticketCreationCreated(
    submitted.state.initialization,
    submitted.state.authoring,
    outcome,
  );
  creator.onChanged();
}

/**
 * @typedef {{ session: { accessToken: () => Promise<string | undefined> },
 * send: (request: import("../app/protocol.js").ApiRequest) => Promise<import("../app/protocol.js").ApiOutcome>,
 * onChanged: () => void,
 * onRelease: (event: ReturnType<typeof ticketCreationReleaseEvent>) => void,
 * onNavigate: (ticket: number) => void, generation: number,
 * state: { partition: Partition | undefined, configurations: readonly unknown[],
 *   creation: import("../app/ticketCreation.js").TicketCreationState } }} Creator
 */

/** @param {Pick<Creator, "session" | "send" | "onChanged" | "onRelease" | "onNavigate">} parts */
export function createTicketCreation(parts) {
  /** @type {Creator} */
  const creator = {
    ...parts,
    generation: 0,
    state: {
      partition: undefined,
      configurations: [],
      creation: { step: "Choosing" },
    },
  };
  return {
    state: creator.state,
    /** @param {Partition} partition @param {readonly unknown[]} configurations */
    selectProject: (partition, configurations) => {
      creator.generation += 1;
      creator.state.partition = partition;
      creator.state.configurations = configurations;
      creator.state.creation = { step: "Choosing" };
      creator.onChanged();
    },
    /** @param {string} revision */
    selectRevision: async (revision) => {
      creator.generation += 1;
      const generation = creator.generation;
      const token = await creator.session.accessToken();
      if (
        token === undefined ||
        creator.state.partition === undefined ||
        generation !== creator.generation
      )
        return;
      await creatorInitialize(
        creator,
        ticketCreationSelected(token, creator.state.partition, revision),
        generation,
      );
    },
    /** @param {import("../app/ticketCreation.js").Authoring} authoring */
    edit: (authoring) => {
      const state = creator.state.creation;
      if (state.step !== "Editing") return;
      creator.state.creation = ticketCreationEdited(
        state.initialization,
        authoring,
      );
      creator.onChanged();
    },
    submit: () => creatorSubmit(creator),
    release: () => {
      const state = creator.state.creation;
      if (state.step !== "DraftCreated" && state.step !== "ReleaseFailed")
        return;
      creator.state.creation = { step: "Releasing", draft: state.draft };
      creator.onChanged();
      creator.onRelease(ticketCreationReleaseEvent(state.draft));
    },
    /** @param {{ result: "Succeeded" } | { result: "Failed", reason: string }} result */
    releaseAnswered: (result) => {
      const state = creator.state.creation;
      if (state.step !== "Releasing") return;
      if (result.result === "Succeeded") creator.onNavigate(state.draft.ticket);
      else {
        creator.state.creation = {
          step: "ReleaseFailed",
          draft: state.draft,
          reason: result.reason,
        };
        creator.onChanged();
      }
    },
  };
}
