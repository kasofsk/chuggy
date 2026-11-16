/**
 * What one installation grants, paged under a bound this deployment sets.
 *
 * THE TOKEN IS SCOPED TO THE INSTALLATION AND NOT TO A REPOSITORY, as only this
 * mint is: the question is which repositories exist at all, and a token naming
 * them would be a token asked for by a caller that already had the answer. It
 * asks for `read` and nothing more, so the listing cannot be made by a
 * credential that could also push.
 *
 * THE TOKEN IS MINTED FOR THE LISTING IT PAGES. What an installation grants
 * changes on the forge with no word to this deployment, and whether a token
 * minted before a grant shows it is the forge's to say, so every listing asks
 * for a mint of its own and is never read under one made before it was asked
 * for.
 *
 * A BOUND IS ANSWERED HONESTLY RATHER THAN SILENTLY. An installation on an
 * account with more repositories than this deployment will page for is answered
 * with the first of them and `truncated`, so a reader that cannot find what it
 * wants knows the listing is partial rather than concluding the repository is
 * not there. The forge's own count is what decides that flag, so a bound that
 * happens to land exactly on the last page does not report more.
 *
 * THE SELECTION AND THE ACCOUNT ARE THE FORGE'S OWN ACCOUNT OF THE LISTING:
 * whether the installation was given every repository or chosen ones is read
 * from the listing's top level, and the account's number from the owner of the
 * rows, which one installation's rows all share. Rows naming two owners are an
 * answer this side cannot read.
 *
 * A REFUSED MINT IS `Denied` AND EVERY OTHER FAILURE IS AN OUTAGE, as at every
 * other forge edge: an installation this app no longer holds is settled, and a
 * forge that could not be reached, would not answer, or answered something this
 * side cannot read has settled nothing.
 */

import { z } from "zod";

import type {
  ForgeInstallationRepositories,
  ForgeRepositoriesRead,
  ForgeRepositorySelection,
  ForgeRepositorySummary,
} from "../../interpreter/forgeDirectory.ts";
import {
  asForgeAccountId,
  asForgeRepositoryName,
  type ForgeAccountId,
  type ForgeInstallation,
  type ForgeInstallationTokens,
} from "../../interpreter/forgeInstallation.ts";
import {
  githubAppBound,
  githubAppRead,
  githubBearerSend,
  githubRequestBounds,
  type GithubRequestBounds,
  type GithubRequestOptions,
} from "./githubAppRequest.ts";

/** The bounds a deployment gets when it names none. */
export const githubInstallationRepositoriesDefaults = {
  repositoriesMax: 500,
  pageSize: 100,
} as const;

/** The status the listing is answered with. */
const githubListingStatus = 200;

/** The fields of a listing this tree reads, the rest being the forge's own account of it. */
const githubRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repository_selection: z.enum(["all", "selected"]),
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      owner: z.object({ id: z.number().int().positive() }),
      name: z.string().min(1),
      full_name: z.string().min(1),
      clone_url: z.string().min(1),
      default_branch: z.string().min(1),
      private: z.boolean(),
    }),
  ),
});

type GithubRepositoryRow = z.infer<
  typeof githubRepositoriesSchema
>["repositories"][number];

/** Everything the adapter is composed with: where the forge is, what mints for it, and how far it pages. */
export interface GithubInstallationRepositoriesOptions extends GithubRequestOptions {
  readonly tokens: ForgeInstallationTokens;
  readonly repositoriesMax?: number;
}

interface GithubInstallationRepositoriesState {
  readonly bounds: GithubRequestBounds;
  readonly tokens: ForgeInstallationTokens;
  readonly repositoriesMax: number;
  readonly pageSize: number;
}

/** One page of the installation's own collection. */
function githubRepositoriesUrl(
  own: GithubInstallationRepositoriesState,
  page: number,
): URL {
  const url = new URL("/installation/repositories", own.bounds.apiUrl);
  url.searchParams.set("per_page", String(own.pageSize));
  url.searchParams.set("page", String(page));
  return url;
}

/** One row as a reader chooses between repositories by, the clone address being its identity. */
function githubRepositorySummary(
  row: GithubRepositoryRow,
): ForgeRepositorySummary {
  return {
    id: String(row.id),
    name: asForgeRepositoryName(row.name),
    fullName: row.full_name,
    url: row.clone_url,
    defaultBranch: row.default_branch,
    private: row.private,
  };
}

/** The forge's word for an installation's selection, in this tree's. */
const githubRepositorySelections = {
  all: "All",
  selected: "Selected",
} as const satisfies Record<string, ForgeRepositorySelection>;

/** The one account every row stands on, nothing where no row is listed and a refusal where two are named. */
function githubRepositoriesAccount(
  owners: readonly number[],
): ForgeAccountId | undefined | "Mixed" {
  const first = owners[0];
  if (first === undefined) return undefined;
  if (owners.some((owner) => owner !== first)) return "Mixed";
  return asForgeAccountId(String(first));
}

/** Pages the listing under one minted bearer, stopping at the bound or at the last page. */
async function githubRepositoriesPaged(
  own: GithubInstallationRepositoriesState,
  bearer: string,
): Promise<ForgeRepositoriesRead> {
  const collected: ForgeRepositorySummary[] = [];
  const owners: number[] = [];
  let total = 0;
  let selection: ForgeRepositorySelection | undefined;
  for (let page = 1; collected.length < own.repositoriesMax; page += 1) {
    const answered = await githubBearerSend(
      own.bounds,
      {
        url: githubRepositoriesUrl(own, page),
        method: "GET",
        okStatus: githubListingStatus,
      },
      bearer,
    );
    if (answered.answered === "Denied") return { read: "Denied" };
    if (answered.answered === "Unavailable") return { read: "Unavailable" };
    const read = await githubAppRead(
      own.bounds,
      answered.response,
      githubRepositoriesSchema,
    );
    if (read === undefined) return { read: "Unavailable" };
    total = read.total_count;
    selection = githubRepositorySelections[read.repository_selection];
    owners.push(...read.repositories.map((row) => row.owner.id));
    try {
      collected.push(...read.repositories.map(githubRepositorySummary));
    } catch {
      return { read: "Unavailable" };
    }
    if (read.repositories.length < own.pageSize) break;
  }
  const repositories = collected.slice(0, own.repositoriesMax);
  const accountId = githubRepositoriesAccount(owners);
  if (accountId === "Mixed" || selection === undefined)
    return { read: "Unavailable" };
  return {
    read: "Repositories",
    repositories,
    truncated: total > repositories.length,
    selection,
    ...(accountId === undefined ? {} : { accountId }),
  };
}

/** The listing over its options, refusing at construction what it could never serve. */
export function githubInstallationRepositories(
  options: GithubInstallationRepositoriesOptions,
): ForgeInstallationRepositories {
  const repositoriesMax = githubAppBound(
    options.repositoriesMax ??
      githubInstallationRepositoriesDefaults.repositoriesMax,
    "the repositories answered",
  );
  const own: GithubInstallationRepositoriesState = {
    bounds: githubRequestBounds(options),
    tokens: options.tokens,
    repositoriesMax,
    pageSize: Math.min(
      repositoriesMax,
      githubInstallationRepositoriesDefaults.pageSize,
    ),
  };
  return {
    repositories: async (
      installation: ForgeInstallation,
    ): Promise<ForgeRepositoriesRead> => {
      const minted = await own.tokens.mint({
        installation,
        permissions: "read",
        unheld: true,
      });
      if (minted.minted === "Denied") return { read: "Denied" };
      if (minted.minted === "Unavailable") return { read: "Unavailable" };
      return githubRepositoriesPaged(own, minted.token);
    },
  };
}
