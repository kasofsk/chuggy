/**
 * What duplicating a ticket decides: which ticket the new-ticket address starts
 * from, the form that ticket's draft seeds, and what of it is not carried.
 *
 * The form is the edit's own reading of the draft, so a duplicate holds every
 * field an edit of it would, but for the overrides of a ticket past Pending:
 * those are the ticket's, which an escalation may have moved past its draft's. It drops only what a new ticket could not send or
 * could never run — a repository no live binding offers, and a dependency on a
 * revoked ticket — and starts on the configuration the draft names only where
 * the project still offers it, never on a revision kept for the draft alone.
 */

import type {
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";

import type { Copy } from "./copy.ts";
import type { PanelState } from "./freshness.ts";
import { repositoryLabel } from "./projectRepositories.ts";
import {
  creationConfigurationStart,
  creationRepositories,
} from "./ticketCreation.ts";
import type { CreationOffer, TicketCreationForm } from "./ticketCreation.ts";
import {
  editConfigurationName,
  editFormFrom,
  editOffersFrom,
} from "./ticketEdit.ts";
import { overridesHeldOf } from "./ticketOverrides.ts";

/** What a duplicate could not carry, each named so the form can say it. */
export interface TicketDuplicateDropped {
  readonly repository: string | undefined;
  readonly dependencies: readonly number[];
  readonly configuration: string | undefined;
}

export interface TicketDuplicateSeed {
  readonly form: TicketCreationForm;
  readonly dropped: TicketDuplicateDropped;
}

/**
 * The dependencies known to be revoked, from each one's own read: undefined
 * while any is still being read, and a read that came back without the ticket
 * leaving it carried for the release to judge.
 */
export function ticketDuplicateRevoked(
  dependencies: readonly number[],
  states: readonly PanelState<TicketResponse>[],
): readonly number[] | undefined {
  if (states.some((state) => state.state === "Pending")) return undefined;
  return dependencies.filter((_, index) => {
    const state = states[index];
    return state?.state === "Ready" && state.value.phase === "Revoked";
  });
}

/**
 * The form a draft duplicates into. The configuration is the edit's match,
 * handed no revision of the draft's own, and otherwise wherever a new ticket
 * starts, under no selection, whose names were the draft's catalog's; a
 * repository no live binding offers is cleared.
 */
export function ticketDuplicateSeed(input: {
  readonly draft: DraftResponse;
  /** The ticket the draft released, absent where it released none. */
  readonly ticket?: TicketResponse | undefined;
  readonly offers: readonly CreationOffer[];
  /** What the project binds, retired bindings among them. */
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly revoked: readonly number[];
  readonly preferred: string | undefined;
  readonly partial: boolean;
}): TicketDuplicateSeed {
  const { draft, offers } = input;
  const repositories = creationRepositories(input.bound);
  const held = editOffersFrom(draft, offers, undefined).configuration;
  const configuration =
    held === ""
      ? creationConfigurationStart(offers, input.preferred, input.partial)
      : held;
  const edited = editFormFrom(draft, repositories, configuration);
  const offered = repositories.some(
    (binding) => binding.repository === edited.repository,
  );
  const repository =
    edited.repository === "" || offered ? undefined : edited.repository;
  const dependencies = edited.dependencies.filter((dependency) =>
    input.revoked.includes(dependency),
  );
  const ticket = input.ticket;
  return {
    form: {
      ...edited,
      ...(ticket === undefined || ticket.phase === "Pending"
        ? {}
        : {
            overrides: overridesHeldOf(ticket.overrides),
            selection: ticket.selection ?? {},
          }),
      ...(held === "" ? { selection: {} } : {}),
      dependencies: edited.dependencies.filter(
        (dependency) => !input.revoked.includes(dependency),
      ),
      ...(repository === undefined ? {} : { repository: "" }),
    },
    dropped: {
      repository,
      dependencies,
      configuration: held === "" ? editConfigurationName(draft) : undefined,
    },
  };
}

/** The line at the head of a duplicate naming what it did not carry, and
 * nothing where it carried everything. */
export function ticketDuplicateDroppedSentence(
  dropped: TicketDuplicateDropped,
): Copy | undefined {
  const parts: readonly Copy[] = [
    ...(dropped.repository === undefined
      ? []
      : [
          {
            id: "ticket-authoring-dropped-repository" as const,
            args: { repository: repositoryLabel(dropped.repository) },
          },
        ]),
    ...dropped.dependencies.map((ticket) => ({
      id: "ticket-authoring-dropped-dependency" as const,
      args: { ticket: String(ticket) },
    })),
    ...(dropped.configuration === undefined
      ? []
      : [
          {
            id: "ticket-authoring-dropped-configuration" as const,
            args: { configuration: dropped.configuration },
          },
        ]),
  ];
  const joined = parts.reduce<Copy | undefined>(
    (first, second) =>
      first === undefined
        ? second
        : { id: "ticket-authoring-joined", args: { first, second } },
    undefined,
  );
  return joined === undefined
    ? undefined
    : { id: "ticket-authoring-dropped", args: { parts: joined } };
}
