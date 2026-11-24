/**
 * The adapter behind `QueueFailedChecksPort` for GitHub: the check runs and
 * the statuses of one commit a merge queue built, read for the names of those
 * that failed.
 *
 * EACH ENDPOINT IS READ ONLY WHERE ITS TOKEN WAS GRANTED IT, AND STANDS ALONE.
 * The token is minted for `readChecks`, which asks the installation for check
 * runs and statuses each only as far as its owner has accepted them, and
 * answers which it was given; an endpoint not granted is not asked. One that
 * is refused, fails or answers what this side cannot read keeps nothing of its
 * own and leaves the other's names standing, and a refused mint keeps nothing
 * at all.
 *
 * A CHECK RUN FAILED WHERE ITS CONCLUSION SAYS SO, AND A STATUS BY ITS OWN
 * STATE. A run concluded `failure`, `timed_out`, `cancelled` or
 * `action_required` failed; a status failed at `failure` or `error`. The
 * commit's combined state is never read, because it is `pending` where the
 * commit carries no status at all.
 *
 * BOTH ARE PAGED UNDER `githubQueueFailedChecksPagesMax`, a page being the
 * forge's largest, and a read that stops at that bound before the forge's own
 * count says it was cut.
 */

import { z } from "zod";

import type { ForgeRepositoryTokens } from "../../interpreter/forgeInstallation.ts";
import type {
  QueueFailedChecksPort,
  QueueFailedChecksRequest,
} from "../../interpreter/changeProposal.ts";
import {
  queueFailedChecksOf,
  type QueueFailedChecks,
} from "../../interpreter/queueFailedChecks.ts";
import { githubAddressOf, githubRepositoryHost } from "./githubAddress.ts";
import {
  githubAppRead,
  githubBearerSend,
  githubRequestBounds,
  type GithubRequestBounds,
  type GithubRequestOptions,
} from "./githubAppRequest.ts";

/** Everything the adapter is composed with: where the forge is, and what mints a credential for one repository on it. */
export interface GithubQueueFailedChecksOptions extends GithubRequestOptions {
  readonly tokens: ForgeRepositoryTokens;
  readonly repositoryHost?: string;
}

/** The most entries the forge's `per_page` is honoured for on either endpoint. */
export const githubQueueFailedChecksPerPage = 100;

/** The most pages either endpoint is read for, each of `githubQueueFailedChecksPerPage` entries. */
export const githubQueueFailedChecksPagesMax = 3;

/** The status both endpoints answer with. */
const githubQueueFailedChecksStatus = 200;

/** The conclusions a check run failed at. */
const githubCheckRunFailedConclusions: readonly string[] = [
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
];

/** The states a status failed at. */
const githubStatusFailedStates: readonly string[] = ["failure", "error"];

/** The fields of a page of check runs this tree reads. */
const githubCheckRunsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  check_runs: z.array(
    z.object({ name: z.string(), conclusion: z.string().nullable() }),
  ),
});

/** The fields of a page of a commit's statuses this tree reads, its combined state not among them. */
const githubStatusesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  statuses: z.array(z.object({ context: z.string(), state: z.string() })),
});

/** One endpoint: where it stands under the commit, how a page is read, and which of its entries failed. */
interface GithubQueueFailedChecksEndpoint<Page> {
  readonly path: string;
  readonly schema: z.ZodType<Page>;
  readonly total: (page: Page) => number;
  readonly entries: (page: Page) => number;
  readonly failed: (page: Page) => readonly string[];
}

const githubCheckRunsEndpoint: GithubQueueFailedChecksEndpoint<
  z.infer<typeof githubCheckRunsSchema>
> = {
  path: "check-runs",
  schema: githubCheckRunsSchema,
  total: (page) => page.total_count,
  entries: (page) => page.check_runs.length,
  failed: (page) =>
    page.check_runs
      .filter(
        (run) =>
          run.conclusion !== null &&
          githubCheckRunFailedConclusions.includes(run.conclusion),
      )
      .map((run) => run.name),
};

const githubStatusesEndpoint: GithubQueueFailedChecksEndpoint<
  z.infer<typeof githubStatusesSchema>
> = {
  path: "status",
  schema: githubStatusesSchema,
  total: (page) => page.total_count,
  entries: (page) => page.statuses.length,
  failed: (page) =>
    page.statuses
      .filter((status) => githubStatusFailedStates.includes(status.state))
      .map((status) => status.context),
};

/** What one endpoint's read found: the failed names, and whether the page bound stopped it before the forge's count. */
interface GithubQueueFailedChecksFound {
  readonly names: readonly string[];
  readonly cut: boolean;
}

/** One page of one endpoint under the commit. */
function githubQueueFailedChecksUrl(
  bounds: GithubRequestBounds,
  commitPath: string,
  endpoint: string,
  page: number,
): URL {
  const url = new URL(`${commitPath}/${endpoint}`, bounds.apiUrl);
  url.searchParams.set("per_page", String(githubQueueFailedChecksPerPage));
  url.searchParams.set("page", String(page));
  return url;
}

/** Pages one endpoint under the bearer, nothing where any page was not answered as this side reads it. */
async function githubQueueFailedChecksPaged<Page>(
  bounds: GithubRequestBounds,
  commitPath: string,
  bearer: string,
  endpoint: GithubQueueFailedChecksEndpoint<Page>,
): Promise<GithubQueueFailedChecksFound | undefined> {
  const names: string[] = [];
  let seen = 0;
  let total = 0;
  for (let page = 1; page <= githubQueueFailedChecksPagesMax; page += 1) {
    const answered = await githubBearerSend(
      bounds,
      {
        url: githubQueueFailedChecksUrl(
          bounds,
          commitPath,
          endpoint.path,
          page,
        ),
        method: "GET",
        okStatus: githubQueueFailedChecksStatus,
      },
      bearer,
    );
    if (answered.answered !== "Answer") return undefined;
    const read = await githubAppRead(
      bounds,
      answered.response,
      endpoint.schema,
    );
    if (read === undefined) return undefined;
    total = endpoint.total(read);
    seen += endpoint.entries(read);
    names.push(...endpoint.failed(read));
    if (
      endpoint.entries(read) < githubQueueFailedChecksPerPage ||
      seen >= total
    )
      return { names, cut: false };
  }
  return { names, cut: seen < total };
}

/** The adapter over its options, refusing at construction a bound it could never serve. */
export function githubQueueFailedChecks(
  options: GithubQueueFailedChecksOptions,
): QueueFailedChecksPort {
  const bounds = githubRequestBounds(options);
  const repositoryHost = options.repositoryHost ?? githubRepositoryHost;
  return {
    read: async (
      request: QueueFailedChecksRequest,
    ): Promise<QueueFailedChecks | undefined> => {
      const address = githubAddressOf(request.repository, repositoryHost);
      if (address === undefined) return undefined;
      const minted = await options.tokens
        .token(request.repository, request.partition, "readChecks")
        .catch(() => undefined);
      if (minted?.minted !== "Token") return undefined;
      const granted = minted.granted ?? [];
      const commitPath = `/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.name)}/commits/${encodeURIComponent(request.commit)}`;
      const found = [
        granted.includes("checks")
          ? await githubQueueFailedChecksPaged(
              bounds,
              commitPath,
              minted.token,
              githubCheckRunsEndpoint,
            )
          : undefined,
        granted.includes("commitStatuses")
          ? await githubQueueFailedChecksPaged(
              bounds,
              commitPath,
              minted.token,
              githubStatusesEndpoint,
            )
          : undefined,
      ];
      return queueFailedChecksOf(
        found.flatMap((read) => read?.names ?? []),
        found.some((read) => read?.cut === true),
      );
    },
  };
}
