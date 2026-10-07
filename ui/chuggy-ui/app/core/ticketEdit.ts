/**
 * What editing a Pending ticket decides: the form its draft prefills, the
 * revision that form becomes, and the update that releases it.
 *
 * The form is the creation form, so every fault it states is the one creation
 * states. The dependencies are the one field it does not take from the reader:
 * a released ticket's cannot change, so the revision carries the draft's own
 * whatever the form holds, and the draft door refuses the rest.
 *
 * AN EDIT KEEPS THE CONFIGURATION ITS DRAFT NAMES. It starts on that name and
 * moves the ticket to another only where its reader chooses one, so a revision
 * of the title is never also a change of who does the work. The form draws no
 * overrides, so it carries the draft's through as they are: a revision that
 * omitted them would clear them.
 */

import { briefBranchPrefix } from "../../../../src/contract/brief.ts";
import { draftRevisionSchema } from "../../../../src/contract/requests.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type {
  DraftInitializationResponse,
  DraftResponse,
  ProjectRepositoryResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import {
  creationBodyFrom,
  creationConfigurationName,
  creationLandingDefault,
} from "./ticketCreation.ts";
import type {
  CreationFault,
  CreationOffer,
  TicketCreationForm,
} from "./ticketCreation.ts";

/** A reference as the branch fields hold it: the name, without the prefix the
 * console adds back on the way out. */
function editBranchName(ref: string | undefined): string {
  if (ref === undefined) return "";
  return ref.startsWith(briefBranchPrefix)
    ? ref.slice(briefBranchPrefix.length)
    : ref;
}

/** The name a draft's configuration goes by: the one it was declared under,
 * and its revision where nothing declared it. */
function editConfigurationName(draft: DraftResponse): string {
  return draft.configurationVersion?.name ?? draft.configurationRevision;
}

/**
 * The offer a draft is already drawn under: its own revision where the project
 * still offers it, and otherwise the one offer declared under its name, which
 * is that name's newest ready revision. Two repositories declaring the name
 * leave none, because a name does not say which of them a draft came from.
 */
function editOfferHeld(
  draft: DraftResponse,
  offers: readonly CreationOffer[],
): CreationOffer | undefined {
  const own = offers.find(
    (offer) =>
      offer.initialization.configuration.revision ===
      draft.configurationRevision,
  );
  if (own !== undefined) return own;
  const name = editConfigurationName(draft);
  const named = offers.filter(
    (offer) =>
      offer.listed !== undefined &&
      creationConfigurationName(offer.listed) === name,
  );
  return named.length === 1 ? named[0] : undefined;
}

/** What an edit chooses among, and the name its form starts on. */
export interface EditOffers {
  readonly offers: readonly CreationOffer[];
  readonly configuration: string;
}

/** Whether the project still offers the configuration a draft names, which
 * decides whether its own revision has to be read to keep it. */
export function editOfferListed(
  draft: DraftResponse,
  offers: readonly CreationOffer[],
): boolean {
  return editOfferHeld(draft, offers) !== undefined;
}

/**
 * The offers one edit is drawn over. A draft whose configuration the project
 * no longer offers is offered its own revision first and starts there, given
 * that revision's initialization; where that could not be read, or is another
 * revision's, nothing is chosen and the reader is asked.
 */
export function editOffersFrom(
  draft: DraftResponse,
  offers: readonly CreationOffer[],
  own: DraftInitializationResponse | undefined,
): EditOffers {
  const held = editOfferHeld(draft, offers);
  if (held !== undefined) return { offers, configuration: held.name };
  if (own?.configuration.revision !== draft.configurationRevision)
    return { offers, configuration: "" };
  const name = editConfigurationName(draft);
  return {
    offers: [{ name, listed: undefined, initialization: own }, ...offers],
    configuration: name,
  };
}

/** The form a draft reads back as, so an untouched submit revises it to itself. */
export function editFormFrom(
  draft: DraftResponse,
  repositories: readonly ProjectRepositoryResponse[],
  configuration: string,
): TicketCreationForm {
  const brief = draft.brief;
  const repository = brief?.repository ?? "";
  const finalization = brief?.finalization;
  return {
    dependencies: [...draft.authoring.dependencies],
    program: draft.authoring.program,
    configuration,
    title: brief?.title ?? "",
    intent: brief?.intent ?? "",
    links: brief?.links ?? [],
    images: brief?.images ?? [],
    checks: brief?.checks ?? [],
    branchName: editBranchName(brief?.branch),
    targetBranchName: editBranchName(
      finalization !== undefined && "target" in finalization
        ? finalization.target
        : undefined,
    ),
    repository,
    landingMode:
      finalization?.mode ?? creationLandingDefault(repositories, repository),
  };
}

export type EditAssembly =
  | {
      readonly assembled: "Body";
      readonly body: z.infer<typeof draftRevisionSchema>;
    }
  | { readonly assembled: "Faults"; readonly faults: readonly CreationFault[] };

/**
 * The revision one form becomes, written against the draft version it was read
 * at and pinned to the revision of the offer the form names, which is how an
 * update re-pins a ticket and how it is moved to another configuration.
 */
export function editRevisionFrom(
  draft: DraftResponse,
  offers: readonly CreationOffer[],
  form: TicketCreationForm,
  repositories: readonly ProjectRepositoryResponse[],
): EditAssembly {
  const assembled = creationBodyFrom(
    offers,
    { ...form, dependencies: draft.authoring.dependencies },
    repositories,
  );
  if (assembled.assembled === "Faults") return assembled;
  return {
    assembled: "Body",
    body: draftRevisionSchema.parse({
      expectedVersion: draft.authoringVersion,
      configurationRevision: assembled.body.configurationRevision,
      authoring: assembled.body.authoring,
      brief: assembled.body.brief,
      ...(draft.overrides === undefined ? {} : { overrides: draft.overrides }),
    }),
  };
}

/** The mutation that releases a revised draft over the ticket revision its
 * author read, so an update written against an older one is refused. */
export function ticketUpdateMutation(
  ticket: TicketResponse,
  draft: DraftResponse,
): PublicMutation {
  return {
    mutation: "UpdateTicket",
    ticket: ticket.ticket,
    expectedRevision: ticket.revision,
    authoringVersion: draft.authoringVersion,
    configurationRevision: draft.configurationRevision,
  };
}

/**
 * Where the draft stands against the live revision: the version that revision
 * was released from, and whether the draft has moved past it since. A draft
 * that names no released version says so rather than being read as current.
 */
export type DraftRelease =
  | { readonly release: "Unrecorded" }
  | { readonly release: "Current"; readonly released: number }
  | {
      readonly release: "Ahead";
      readonly released: number;
      readonly current: number;
    };

export function draftReleaseOf(draft: DraftResponse): DraftRelease {
  const released = draft.releasedAuthoringVersion;
  if (released === undefined) return { release: "Unrecorded" };
  return released < draft.authoringVersion
    ? { release: "Ahead", released, current: draft.authoringVersion }
    : { release: "Current", released };
}

/** The same standing as one short phrase, a count rather than a sentence, for
 * a summary grid cell. */
export function draftUnreleasedLabel(release: DraftRelease): string {
  switch (release.release) {
    case "Unrecorded":
      return "Not recorded";
    case "Current":
      return "Nothing unreleased";
    case "Ahead":
      return `${String(release.current - release.released)} unreleased`;
  }
}
