/**
 * Connecting one repository to a project: the repository first, then where
 * each of the two apps stands on it, then the bind once both reach it.
 *
 * The repository is named before anything is read, because nothing about the
 * person's repositories can be listed until an app is installed on the account
 * that owns it. What each app reaches is read for that account alone: its
 * claim in the tenant, the listing of that installation, and where the listing
 * lacks the repository, the installation's own page on the forge.
 *
 * AN ADDRESS CAN CARRY THE REPOSITORY, and says who sent the person: the setup
 * program gives one, and every press to the forge returns to one, so the flow
 * comes back to the repository it left with.
 */

import type {
  ForgeAppResponse,
  ForgeInstallationResponse,
  ForgeRepositoriesResponse,
  ForgeRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import { forgeApps } from "../../../../src/contract/rosters.ts";
import type { ForgeAppName } from "../../../../src/contract/rosters.ts";

import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import {
  apiForgeInstallationPermissions,
  apiForgeInstallationRepositories,
  apiForgeInstallations,
} from "./apiRoutes.ts";
import type { Copy } from "./copy.ts";
import {
  forgeInstallSuggestedUrl,
  forgeInstallUrl,
} from "./forgeInstallation.ts";
import type { ForgePress } from "./forgePress.ts";

/** A repository as the person names it: the account that owns it and its name there. */
export interface RepositoryNamed {
  readonly owner: string;
  readonly name: string;
}

/** The repository as a line names it. */
export function repositoryNamedLabel(named: RepositoryNamed): string {
  return `${named.owner}/${named.name}`;
}

/** GitHub's own rules: an account's name has no dot, a repository's may. */
const repositoryNamedOwner = /^[A-Za-z0-9_-]+$/u;
const repositoryNamedName = /^[A-Za-z0-9_.-]+$/u;

/**
 * What the person typed, as a repository: `owner/name`, or an address of it on
 * the forge, as a browser or a clone shows it, which names its host first.
 * Nothing where it names no owner and name and no more.
 */
export function repositoryConnectNamed(
  text: string,
): RepositoryNamed | undefined {
  const path = text
    .trim()
    .replace(/^[a-z+]+:\/\//iu, "")
    .replace(/^[^@/\s]+@([^:/\s]+):/u, "$1/")
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "");
  const segments = path.split("/");
  const hosted = segments[0]?.includes(".") === true;
  const parts = hosted ? segments.slice(1) : segments;
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined)
    return undefined;
  return repositoryNamedOwner.test(owner) &&
    repositoryNamedName.test(name) &&
    name !== "." &&
    name !== ".."
    ? { owner, name }
    : undefined;
}

/** The forge names accounts and repositories without regard to case. */
function repositoryNamedKey(named: RepositoryNamed): string {
  return repositoryNamedLabel(named).toLowerCase();
}

/** Whether one named repository is the other. */
export function repositoryNamedSame(
  one: RepositoryNamed,
  other: RepositoryNamed,
): boolean {
  return repositoryNamedKey(one) === repositoryNamedKey(other);
}

/** The listing's own entry for the repository, where it lists it. */
function repositoryConnectEntry(
  listed: readonly ForgeRepositoryResponse[],
  named: RepositoryNamed,
): ForgeRepositoryResponse | undefined {
  const key = repositoryNamedKey(named);
  return listed.find((held) => held.fullName.toLowerCase() === key);
}

/** Who sent the person to the flow, which decides the way on once it is done. */
export const repositoryConnectArrivals = ["Setup", "Console"] as const;

export type RepositoryConnectArrival =
  (typeof repositoryConnectArrivals)[number];

/** What an address asks of the flow: the repository, where it names one, and who sent it. */
export interface RepositoryConnectAsked {
  readonly repository: RepositoryNamed | undefined;
  readonly arrival: RepositoryConnectArrival;
}

/** The search key the repository is carried under. */
export const repositoryConnectKey = "repository";

/** The search key, and its one value, that say the setup program sent the person. */
export const repositoryConnectArrivalKey = "from";
export const repositoryConnectSetup = "setup";

const repositoryConnectBase = "https://console.invalid";

/** What the address at `path` asks of the flow. */
export function repositoryConnectAskedOf(path: string): RepositoryConnectAsked {
  const url = new URL(path, repositoryConnectBase);
  const named = url.searchParams.get(repositoryConnectKey);
  return {
    repository: named === null ? undefined : repositoryConnectNamed(named),
    arrival:
      url.searchParams.get(repositoryConnectArrivalKey) ===
      repositoryConnectSetup
        ? "Setup"
        : "Console",
  };
}

/** The address at `path` carrying `asked` and nothing else of the flow's, without its anchor. */
export function repositoryConnectPath(
  path: string,
  asked: RepositoryConnectAsked,
): string {
  const url = new URL(path, repositoryConnectBase);
  url.searchParams.delete(repositoryConnectKey);
  url.searchParams.delete(repositoryConnectArrivalKey);
  if (asked.repository !== undefined)
    url.searchParams.set(
      repositoryConnectKey,
      repositoryNamedLabel(asked.repository),
    );
  if (asked.arrival === "Setup")
    url.searchParams.set(repositoryConnectArrivalKey, repositoryConnectSetup);
  return `${url.pathname}${url.search}`;
}

/**
 * The address the setup program gives: the repositories page at `page`, with
 * the picker open on `repository` where the folder names one.
 */
export function repositoryConnectSetupAddress(
  page: string,
  repository: string | undefined,
  anchor: string,
): string {
  const query = new URLSearchParams();
  if (repository !== undefined) query.set(repositoryConnectKey, repository);
  query.set(repositoryConnectArrivalKey, repositoryConnectSetup);
  return `${page}?${query.toString()}#${anchor}`;
}

/** Where one app stands on the repository. */
export type RepositoryAppReach =
  /** Its installation lists the repository: `entry` is how, and `accountId` the forge's number for the account where the listing names it. */
  | {
      readonly app: ForgeAppName;
      readonly reach: "Reaches";
      readonly entry: ForgeRepositoryResponse;
      readonly accountId: string | undefined;
    }
  /** Installed on the account and not let into the repository, with its installation's page on the forge where that was read. */
  | {
      readonly app: ForgeAppName;
      readonly reach: "Ungranted";
      readonly settings: string | undefined;
    }
  /** No claim of the tenant's names it on the account. */
  | { readonly app: ForgeAppName; readonly reach: "Uninstalled" };

/** One app's claim on the account that owns the repository, where the tenant holds one. */
function repositoryConnectClaim(
  installations: readonly ForgeInstallationResponse[],
  named: RepositoryNamed,
  app: ForgeAppName,
): ForgeInstallationResponse | undefined {
  const owner = named.owner.toLowerCase();
  return installations.find(
    (claim) => claim.app === app && claim.account.toLowerCase() === owner,
  );
}

/** Where one claimed app stands, from its installation's listing and, where that lacks the repository, its page. */
async function repositoryConnectClaimed(
  ports: ApiPorts,
  tenant: string,
  named: RepositoryNamed,
  claim: ForgeInstallationResponse,
): Promise<ApiResult<RepositoryAppReach>> {
  const app = claim.app;
  const listed = await apiForgeInstallationRepositories(
    ports,
    tenant,
    claim.installationId,
  );
  if (listed.outcome !== "Ok") return listed;
  const entry = repositoryConnectEntry(listed.value.repositories, named);
  if (entry !== undefined)
    return {
      outcome: "Ok",
      value: {
        app,
        reach: "Reaches",
        entry,
        accountId: listed.value.accountId,
      },
    };
  const page = await apiForgeInstallationPermissions(
    ports,
    tenant,
    claim.installationId,
  );
  return {
    outcome: "Ok",
    value: {
      app,
      reach: "Ungranted",
      settings: page.outcome === "Ok" ? page.value.settingsUrl : undefined,
    },
  };
}

/**
 * Where each app stands on the repository, in the roster's order. The first
 * read that does not answer `Ok` is the answer for them all, since an app left
 * unread could be one the flow then asks the person to install again.
 */
export async function repositoryConnectRead(
  ports: ApiPorts,
  tenant: string,
  named: RepositoryNamed,
): Promise<ApiResult<readonly RepositoryAppReach[]>> {
  const claims = await apiForgeInstallations(ports, tenant);
  if (claims.outcome !== "Ok") return claims;
  const apps: RepositoryAppReach[] = [];
  for (const app of forgeApps) {
    const claim = repositoryConnectClaim(
      claims.value.installations,
      named,
      app,
    );
    if (claim === undefined) {
      apps.push({ app, reach: "Uninstalled" });
      continue;
    }
    const one = await repositoryConnectClaimed(ports, tenant, named, claim);
    if (one.outcome !== "Ok") return one;
    apps.push(one.value);
  }
  return { outcome: "Ok", value: apps };
}

/** The portal app's entry for the repository once both apps reach it, which is the address a bind names; nothing before. */
export function repositoryConnectBindable(
  apps: readonly RepositoryAppReach[],
): ForgeRepositoryResponse | undefined {
  if (apps.length !== forgeApps.length)
    throw new Error("the flow holds where each app stands, once each");
  if (apps.some((one) => one.reach !== "Reaches")) return undefined;
  const portal = apps.find((one) => one.app === "portal");
  return portal?.reach === "Reaches" ? portal.entry : undefined;
}

/** The apps still to be let into the repository, in the roster's order. */
export function repositoryConnectLeft(
  apps: readonly RepositoryAppReach[],
): readonly ForgeAppName[] {
  return apps.filter((one) => one.reach !== "Reaches").map((one) => one.app);
}

/**
 * The address an app not installed is installed from: with the account and the
 * repository already chosen where the other app's listing names both, and the
 * plain one otherwise, where the flow says what to choose.
 */
export function repositoryConnectInstallUrl(
  held: ForgeAppResponse,
  state: string,
  apps: readonly RepositoryAppReach[],
): { readonly url: string; readonly chosen: boolean } {
  const known = apps.find(
    (one) =>
      one.app !== held.app &&
      one.reach === "Reaches" &&
      one.accountId !== undefined,
  );
  if (known?.reach !== "Reaches")
    return { url: forgeInstallUrl(held.installUrl, state), chosen: false };
  const granted: ForgeRepositoriesResponse = {
    repositories: [known.entry],
    truncated: false,
    selection: "Selected",
    accountId: known.accountId,
  };
  return {
    url: forgeInstallSuggestedUrl(held.installUrl, state, granted),
    chosen: true,
  };
}

/**
 * The press a trip to the forge from the flow is stored as. The flow draws
 * each app's own press, so it counts every app as sent on to already: a
 * landing then sends the person back here rather than on to the other app's
 * install, which this page offers with the repository chosen.
 */
export function repositoryConnectPress(
  tenant: string,
  returnPath: string,
): ForgePress {
  return { tenant, returnPath, installs: [...forgeApps] };
}

/** What one app is for, as the setup program says it. */
export const repositoryConnectReasons: Readonly<Record<ForgeAppName, Copy>> = {
  portal: { id: "repositories-connect-reason-portal" },
  worker: { id: "repositories-connect-reason-worker" },
};

/** Where an app stands on the repository, as its row says it. */
export function repositoryConnectReachLine(
  reach: RepositoryAppReach,
  named: RepositoryNamed,
): Copy {
  const repository = repositoryNamedLabel(named);
  switch (reach.reach) {
    case "Reaches":
      return { id: "repositories-connect-reaches", args: { repository } };
    case "Ungranted":
      return {
        id: "repositories-connect-ungranted",
        args: { repository, account: named.owner },
      };
    case "Uninstalled":
      return {
        id: "repositories-connect-uninstalled",
        args: { account: named.owner },
      };
  }
}

/** What the person chooses on the forge after the app's press, which the address cannot choose for them, or what it chose. */
export function repositoryConnectChooseLine(
  reach: RepositoryAppReach,
  named: RepositoryNamed,
  chosen: boolean,
): Copy | undefined {
  const repository = repositoryNamedLabel(named);
  const account = named.owner;
  switch (reach.reach) {
    case "Reaches":
      return undefined;
    case "Ungranted":
      return reach.settings === undefined
        ? {
            id: "repositories-connect-choose-install",
            args: { repository, account },
          }
        : { id: "repositories-connect-choose-settings", args: { repository } };
    case "Uninstalled":
      return chosen
        ? {
            id: "repositories-connect-choose-chosen",
            args: { repository, account },
          }
        : {
            id: "repositories-connect-choose-install",
            args: { repository, account },
          };
  }
}
