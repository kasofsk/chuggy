/**
 * What duplicating a ticket decides: which ticket the new-ticket address starts
 * from, the form that ticket's draft seeds, and what of it is not carried.
 *
 * The form is the edit's own reading of the draft, so a duplicate holds every
 * field an edit of it would. It drops only what a new ticket could not send or
 * could never run — a repository no live binding offers, and a dependency on a
 * revoked ticket — and starts on the configuration the draft names only where
 * the project still offers it, never on a revision kept for the draft alone.
 */

import type {
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";

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

/** What the new-ticket address says about where it starts: from nothing, or
 * from the ticket it names. */
export interface TicketDuplicateQuery {
  readonly from?: number;
}

function ticketDuplicateNumberOf(value: unknown): number | undefined {
  const read =
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value;
  return typeof read === "number" && Number.isSafeInteger(read) && read > 0
    ? read
    : undefined;
}

/** The ticket the address names, read off the query the router parsed, which
 * hands a number back as one and a quoted one as text. */
export function ticketDuplicateQueryOf(
  search: Readonly<Record<string, unknown>>,
): TicketDuplicateQuery {
  const from = ticketDuplicateNumberOf(search["from"]);
  return from === undefined ? {} : { from };
}

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
 * starts; a repository no live binding offers is cleared.
 */
export function ticketDuplicateSeed(input: {
  readonly draft: DraftResponse;
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
  return {
    form: {
      ...edited,
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
): string | undefined {
  const parts = [
    ...(dropped.repository === undefined
      ? []
      : [`repository ${repositoryLabel(dropped.repository)}, no longer bound`]),
    ...dropped.dependencies.map(
      (ticket) => `dependency on ticket ${String(ticket)}, revoked`,
    ),
    ...(dropped.configuration === undefined
      ? []
      : [`configuration ${dropped.configuration}, no longer offered`]),
  ];
  return parts.length === 0 ? undefined : `Not carried · ${parts.join(" · ")}`;
}
