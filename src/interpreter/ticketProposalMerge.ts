/**
 * A person has this deployment merge the pull request a ticket's landing
 * opened, through the portal app, on their own word.
 *
 * IT IS AUTHORIZED AS THE TICKET'S READ IS, AND THEN BY `MergeProposals`. A
 * ticket the caller may not read is answered as one that does not exist, and
 * a reader who may not merge is told so apart from it.
 *
 * THE PULL REQUEST IS THE ONE THE TICKET'S NEWEST SUCCESSFUL LANDING OPENED,
 * by the number its proved evidence records, and its merge is conditional on
 * the head that landing evaluated. A newest success that opened none, or whose
 * evidence holds no number, is nothing to merge.
 *
 * IT IS READ BEFORE IT IS MERGED. One merged already answers `Merged`, so a
 * second press is harmless; one closed, conflicting, blocked, behind, or no
 * longer between the landing's repository, head and base, is refused by name
 * and no merge is asked for. A refusal the forge gave no reason for, and an
 * answer nobody could read, are read back once and named by that reading.
 *
 * NOTHING IS WRITTEN AND NO TICKET MOVES. The merge is the forge's, as one a
 * person pressed there is, and what follows it is read as that would be.
 */

import { isActionReportLink } from "../contract/actionReport.ts";
import type { ProposalMergeRefusal } from "../contract/rosters.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  asForgeCredentialReference,
  proposalMarkerOf,
  type ChangeProposalAddress,
  type ChangeProposalMergeRequest,
  type ChangeProposalPort,
  type ChangeProposalRead,
  type ChangeProposalRequestIdentity,
} from "./changeProposal.ts";
import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/**
 * The credential reference every merge asked here names. The portal app's
 * minted credential is selected by the repository's host and never reads it,
 * and a repository on any other host is refused rather than read from a file.
 */
export const ticketProposalMergeCredential =
  asForgeCredentialReference("portal-app");

/** The pull request a ticket's newest successful landing opened, as its row records it. */
export interface TicketProposedLanding {
  readonly repository: RepositoryId;
  readonly request: ChangeProposalRequestIdentity;
  readonly head: { readonly ref: GitRefName; readonly commit: GitObjectId };
  readonly baseRef: GitRefName;
  readonly proposal: ChangeProposalAddress;
  readonly url?: string;
}

export interface TicketProposedLandingStore {
  /** The pull request the ticket's newest successful landing opened, nothing where it opened none the store can address. */
  proposed(
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketProposedLanding | undefined>;
}

/** What a press of a ticket's merge answers. */
export type TicketProposalMerged =
  | { readonly result: "NotFound" }
  | { readonly result: "Forbidden" }
  | { readonly result: "Unavailable" }
  | {
      readonly result: "Merged";
      readonly mergeCommit?: GitObjectId;
      readonly url?: string;
    }
  | {
      readonly result: "Refused";
      readonly refused: ProposalMergeRefusal;
      readonly url?: string;
    };

export interface TicketProposalMerges {
  merge(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketProposalMerged>;
}

export interface TicketProposalMergePorts {
  readonly access: ProjectAccess;
  readonly store: TicketProposedLandingStore;
  /** The forge the portal app acts on, absent where this deployment holds no portal key. */
  readonly proposals?: Pick<ChangeProposalPort, "readByNumber" | "merge">;
}

/** What one reading of the pull request says of merging it: merged, refused by name, or nothing that stops a merge. */
type TicketProposalMergeReading =
  | { readonly reading: "Merged"; readonly mergeCommit?: GitObjectId }
  | { readonly reading: "Refused"; readonly refused: ProposalMergeRefusal }
  | { readonly reading: "Open" };

/** The merge request one landing's pull request is asked under. */
function ticketProposalMergeRequest(
  partition: Partition,
  landing: TicketProposedLanding,
): ChangeProposalMergeRequest {
  return {
    binding: {
      forge: landing.proposal.forge,
      credential: ticketProposalMergeCredential,
    },
    partition,
    repository: landing.repository,
    proposal: landing.proposal,
    marker: proposalMarkerOf(landing.request),
    headCommit: landing.head.commit,
  };
}

/** What one found pull request says of merging it, a pull request no longer where the landing opened it being one not to merge. */
function ticketProposalMergeFound(
  landing: TicketProposedLanding,
  read: Extract<ChangeProposalRead, { read: "Found" }>,
): TicketProposalMergeReading {
  const evidence = read.evidence;
  if (evidence.status === "Merged")
    return evidence.mergeCommit === undefined
      ? { reading: "Merged" }
      : { reading: "Merged", mergeCommit: evidence.mergeCommit };
  if (evidence.status === "Closed")
    return { reading: "Refused", refused: "Closed" };
  if (
    evidence.status === "Superseded" ||
    evidence.repository !== landing.repository ||
    evidence.head.ref !== landing.head.ref ||
    evidence.base.ref !== landing.baseRef
  )
    return { reading: "Refused", refused: "NotMergeable" };
  switch (evidence.mergeability) {
    case "Conflicting":
    case "Blocked":
    case "Behind":
      return { reading: "Refused", refused: evidence.mergeability };
    case "Mergeable":
    case "Unknown":
    case undefined:
      return { reading: "Open" };
    default:
      return assertNever(evidence.mergeability);
  }
}

/**
 * What a reading taken after the forge did not merge names: what the proposal
 * now stands at, and `NotMergeable` where it stands open or could not be read,
 * since the forge has already declined this merge once.
 */
function ticketProposalMergeReread(
  landing: TicketProposedLanding,
  read: ChangeProposalRead,
): Exclude<TicketProposalMergeReading, { reading: "Open" }> {
  if (read.read !== "Found")
    return { reading: "Refused", refused: "NotMergeable" };
  const found = ticketProposalMergeFound(landing, read);
  return found.reading === "Open"
    ? { reading: "Refused", refused: "NotMergeable" }
    : found;
}

/** The answer one reading comes to, carrying the pull request's link where a report could carry it. */
function ticketProposalMergeAnswered(
  landing: TicketProposedLanding,
  reading: Exclude<TicketProposalMergeReading, { reading: "Open" }>,
): TicketProposalMerged {
  const url =
    landing.url !== undefined && isActionReportLink(landing.url)
      ? { url: landing.url }
      : {};
  return reading.reading === "Merged"
    ? {
        result: "Merged",
        ...(reading.mergeCommit === undefined
          ? {}
          : { mergeCommit: reading.mergeCommit }),
        ...url,
      }
    : { result: "Refused", refused: reading.refused, ...url };
}

/** Asks the forge to merge a pull request read open, and names what it answered. */
async function ticketProposalMergeAsked(
  proposals: NonNullable<TicketProposalMergePorts["proposals"]>,
  landing: TicketProposedLanding,
  request: ChangeProposalMergeRequest,
): Promise<TicketProposalMerged> {
  const merged = await proposals.merge(request);
  switch (merged.merged) {
    case "Merged":
      return ticketProposalMergeAnswered(landing, {
        reading: "Merged",
        mergeCommit: merged.mergeCommit,
      });
    case "HeadMoved":
      return ticketProposalMergeAnswered(landing, {
        reading: "Refused",
        refused: "HeadMoved",
      });
    case "Denied":
      return ticketProposalMergeAnswered(landing, {
        reading: "Refused",
        refused: "AppDenied",
      });
    case "Unavailable":
      return { result: "Unavailable" };
    case "NotMergeable":
    case "Ambiguous":
      return ticketProposalMergeAnswered(
        landing,
        ticketProposalMergeReread(
          landing,
          await proposals.readByNumber(request),
        ),
      );
    default:
      return assertNever(merged);
  }
}

/** Reads the landing's pull request, and merges it only where that reading stops nothing. */
async function ticketProposalMergeRead(
  proposals: NonNullable<TicketProposalMergePorts["proposals"]>,
  partition: Partition,
  landing: TicketProposedLanding,
): Promise<TicketProposalMerged> {
  const request = ticketProposalMergeRequest(partition, landing);
  const read = await proposals.readByNumber(request);
  switch (read.read) {
    case "Unavailable":
      return { result: "Unavailable" };
    case "Denied":
      return ticketProposalMergeAnswered(landing, {
        reading: "Refused",
        refused: "AppDenied",
      });
    case "Absent":
      return ticketProposalMergeAnswered(landing, {
        reading: "Refused",
        refused: "NotMergeable",
      });
    case "Found": {
      const found = ticketProposalMergeFound(landing, read);
      return found.reading === "Open"
        ? ticketProposalMergeAsked(proposals, landing, request)
        : ticketProposalMergeAnswered(landing, found);
    }
    default:
      return assertNever(read);
  }
}

async function ticketProposalMergesMerge(
  ports: TicketProposalMergePorts,
  principal: Principal,
  partition: Partition,
  ticket: TicketId,
): Promise<TicketProposalMerged> {
  const { access } = ports;
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  if (
    (await access.authorize(principal, partition, "MergeProposals")) ===
    undefined
  )
    return { result: "Forbidden" };
  const landing = await ports.store.proposed(partition, ticket);
  if (landing === undefined) return { result: "NotFound" };
  if (ports.proposals === undefined) return { result: "Unavailable" };
  return ticketProposalMergeRead(ports.proposals, partition, landing);
}

export function ticketProposalMerges(
  ports: TicketProposalMergePorts,
): TicketProposalMerges {
  return {
    merge: (principal, partition, ticket) =>
      ticketProposalMergesMerge(ports, principal, partition, ticket),
  };
}
