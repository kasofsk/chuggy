/**
 * What editing a Pending ticket decides: the form its draft prefills, the
 * revision that form becomes, and the update that releases it.
 *
 * The form is the creation form, so every fault it states is the one creation
 * states. The dependencies are the one field it does not take from the reader:
 * a released ticket's cannot change, so the revision carries the draft's own
 * whatever the form holds, and the draft door refuses the rest.
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

import { creationBodyFrom, creationLandingDefault } from "./ticketCreation.ts";
import type { CreationFault, TicketCreationForm } from "./ticketCreation.ts";

/** A reference as the branch fields hold it: the name, without the prefix the
 * console adds back on the way out. */
function editBranchName(ref: string | undefined): string {
  if (ref === undefined) return "";
  return ref.startsWith(briefBranchPrefix)
    ? ref.slice(briefBranchPrefix.length)
    : ref;
}

/** The form a draft reads back as, so an untouched submit revises it to itself. */
export function editFormFrom(
  draft: DraftResponse,
  repositories: readonly ProjectRepositoryResponse[],
): TicketCreationForm {
  const brief = draft.brief;
  const repository = brief?.repository ?? "";
  const finalization = brief?.finalization;
  return {
    dependencies: [...draft.authoring.dependencies],
    program: draft.authoring.program,
    title: brief?.title ?? "",
    intent: brief?.intent ?? "",
    links: brief?.links ?? [],
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
 * at and shaped by the configuration the form was drawn from, which is how an
 * update re-pins one.
 */
export function editRevisionFrom(
  draft: DraftResponse,
  initialization: DraftInitializationResponse,
  form: TicketCreationForm,
  repositories: readonly ProjectRepositoryResponse[],
): EditAssembly {
  const assembled = creationBodyFrom(
    initialization,
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

/** The live revision, and the draft version it was released from. */
export function ticketRevisionLine(
  revision: number,
  release: DraftRelease,
): string {
  switch (release.release) {
    case "Unrecorded":
      return `revision ${String(revision)}`;
    case "Current":
    case "Ahead":
      return `revision ${String(revision)}, from draft version ${String(release.released)}`;
  }
}

/** Whether the draft holds anything the live revision does not. */
export function draftReleaseLine(release: DraftRelease): string {
  switch (release.release) {
    case "Unrecorded":
      return "not recorded which version is live";
    case "Current":
      return "nothing unreleased";
    case "Ahead":
      return `version ${String(release.current)} holds unreleased changes`;
  }
}
