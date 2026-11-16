/**
 * `merge`: the pull request of the project's first ticket merged, through the
 * site's merge of a ticket's pull request, on the person's yes.
 *
 * It is asked only where the checklist is otherwise done and that pull request
 * stands unmerged on a repository holding only the bootstrap, and it lets no
 * other write out. A merge refused is said in the person's words for the
 * site's reason, with the pull request's link. Whether the repository's own
 * configuration is imported after is the checklist's to say, read again at
 * `setupMergePollMs`.
 *
 * Before the merge is offered, git is asked how much history the folder's
 * checkout holds, which is the history the repository had before chuggy, since
 * the bootstrap is on the pull request's branch and not the checkout's head. A
 * repository past `setupHistoryNewCommitsMax` is read as one with a history of
 * its own; a checkout git could not read is read as nothing either way.
 */

import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { ticketProposalMergeRefusedResponseSchema } from "../../../../src/contract/responses.ts";
import type { RepositoryConfigurationImportAttemptResponse } from "../../../../src/contract/responses.ts";
import { proposalMergeForbiddenCode } from "../../../../src/contract/rosters.ts";

import type { ApiPorts } from "./apiRequest.ts";
import { apiMergeTicketProposal } from "./apiRoutes.ts";
import { failureWords } from "./failureWords.ts";
import type { SetupProcessPort } from "./setupPorts.ts";
import type { SetupMergeAnswered } from "./setupReport.ts";

/** How often `merge` reads the checklist again while the repository's own configuration is not yet imported. */
export const setupMergePollMs = 3_000;

/** The most commits a repository made to try chuggy is read as new with. */
export const setupHistoryNewCommitsMax = 20;

/** Past anything git prints for a count. */
export const setupHistoryBytesMax = 64;

/** What git is asked, in the folder the program was run in: how many commits the checkout's head has, counted no further than the first past the bound. */
export const setupHistoryCommand: readonly string[] = [
  "git",
  "rev-list",
  "--count",
  `--max-count=${String(setupHistoryNewCommitsMax + 1)}`,
  "HEAD",
];

/** How much history the folder's checkout holds: more than a new repository's, no more, or none git could say. */
export type SetupHistory = "Long" | "Short" | "Unread";

/** The folder's history, asked of git once and for at most `waitMs`. */
export async function setupHistoryRead(
  process: SetupProcessPort,
  waitMs: number,
): Promise<SetupHistory> {
  const printed = (
    await process.read(setupHistoryCommand, waitMs, setupHistoryBytesMax)
  )?.trim();
  if (printed === undefined || !/^\d{1,6}$/u.test(printed)) return "Unread";
  return Number(printed) > setupHistoryNewCommitsMax ? "Long" : "Short";
}

/** The one write `merge` makes for a project: the merge of one ticket's pull request. */
export function setupMergeWrites(
  partition: PartitionIdentity,
  ticket: number,
): readonly string[] {
  const route = nativeHttpRoutes.ticketProposalMerge
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project))
    .replace(":ticket", String(ticket));
  return [`POST ${route}`];
}

/** Asks the site to merge `ticket`'s pull request, through ports that let only that write out. */
export async function setupMergeAsked(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
): Promise<SetupMergeAnswered> {
  const result = await apiMergeTicketProposal(ports, partition, ticket);
  if (result.outcome === "Ok")
    return { answered: "Merged", mergeCommit: result.value.mergeCommit };
  const refused =
    result.outcome === "Conflict"
      ? ticketProposalMergeRefusedResponseSchema.safeParse(result.body)
      : undefined;
  if (refused?.success === true)
    return { answered: "Refused", refusal: refused.data.refused };
  const forbidden =
    result.outcome === "Rejected" &&
    result.status === 403 &&
    result.code === proposalMergeForbiddenCode;
  return forbidden
    ? { answered: "Refused", refusal: "Forbidden" }
    : { answered: "Failed", failure: failureWords(result).word };
}

/** What a `merge` run looked at before it asked: the import of the repository that had finished last, and the commit the merge left, as the site's merge named it or, where it was merged already, as the ticket's landings name it. */
export interface SetupMergeSince {
  readonly before: RepositoryConfigurationImportAttemptResponse | undefined;
  readonly mergeCommit: string | undefined;
}

/** Whether the import that finished last is one the merge brought on and it imported nothing: one other than the import before, or one of the merge's own commit. */
export function setupMergeImportFailed(
  since: SetupMergeSince,
  last: RepositoryConfigurationImportAttemptResponse | undefined,
): boolean {
  if (last === undefined || last.outcome.result === "Imported") return false;
  const other =
    since.before === undefined ||
    since.before.attemptedAt !== last.attemptedAt ||
    since.before.commit !== last.commit;
  return (
    other ||
    (since.mergeCommit !== undefined && last.commit === since.mergeCommit)
  );
}
