/**
 * What GitHub tells this app about itself, about its installation on one
 * account, and about what one installation has accepted.
 *
 * THE APP'S OWN IDENTITY IS READ ONCE PER PROCESS. It is a property of the key
 * this deployment mounts rather than of the request asking for it, so it cannot
 * change while the process runs; a route that asked the forge per request would
 * make an unauthenticated reader's page a forge request, which is a rate limit
 * a caller can spend on this deployment's behalf. An outage is not held: a
 * process that could not reach the forge once must be able to try again.
 *
 * THE APP'S PERMISSIONS ARE READ EACH TIME THEY ARE COMPARED. An owner changes
 * what the app asks for while a deployment runs, and a held set would call an
 * installation current against a request the app no longer makes. Only a
 * tenant's administrator asks, so no unauthenticated reader spends the limit.
 *
 * AN INSTALLATION IS BEHIND WHERE THE APP ASKS ANY PERMISSION AT A LEVEL IT
 * LACKS, a permission it does not hold at all being the lowest level of them.
 *
 * THE INSTALL, AUTHORIZE AND SETTINGS ADDRESSES ARE DERIVED FROM WHAT THE
 * FORGE SAYS, not assembled from a host this tree names. A deployment pointed
 * at an enterprise server installs from that server, and a constant here would
 * send its administrators to a public one.
 *
 * AN ACCOUNT'S INSTALLATION OF ANOTHER APP IS MISSING. Reading as the app
 * already answers 404 for an account without it, and the `app_id` comparison is
 * the second term: a forge that answered with someone else's installation would
 * otherwise be recorded as a claim this deployment can never mint through.
 *
 * AN ANSWER THIS SIDE CANNOT READ IS AN OUTAGE AND NEVER AN ABSENCE, so an
 * account whose installation could not be read is never reported as one that
 * has not installed the app.
 */

import { z } from "zod";

import {
  asForgeAccountId,
  asForgeInstallationId,
  type ForgeInstallationId,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeAccountInstallationRead,
  ForgeAppDescribed,
  ForgeApps,
  ForgeInstallationAccount,
  ForgeInstallationDirectory,
  ForgeInstallationPermissionsRead,
} from "../../interpreter/forgeDirectory.ts";
import {
  githubAppRead,
  githubAppSend,
  githubAppState,
  type GithubAppOptions,
  type GithubAppState,
} from "./githubAppRequest.ts";

/** The status either read is answered with, anything else being a refusal or an outage. */
const githubAppReadStatus = 200;

/** The path under an app's own address that begins an installation. */
const githubAppInstallPath = "installations/new";

/** Where on the forge's web host a person authorizes an app, and where that authorization is redeemed. */
export const githubOAuthPaths = {
  authorize: "/login/oauth/authorize",
  token: "/login/oauth/access_token",
} as const;

/** The fields of the app this tree reads, the rest being the forge's own account of it. */
const githubAppSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  html_url: z.string().min(1),
  client_id: z.string().min(1),
});

/** The fields of one account's installation this tree reads. */
const githubAccountInstallationSchema = z.object({
  id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  account: z.object({ id: z.number().int().positive() }),
});

/** The levels the forge grants a permission at, weakest first. */
const githubPermissionLevels = ["read", "write", "admin"] as const;

type GithubPermissionLevel = (typeof githubPermissionLevels)[number];

/** A set of permissions as the forge names them, a level it adds being an answer this side cannot read. */
const githubPermissionsSchema = z.record(
  z.string(),
  z.enum(githubPermissionLevels),
);

type GithubPermissions = z.infer<typeof githubPermissionsSchema>;

/** The fields of the app this tree compares an installation against. */
const githubAppPermissionsSchema = z.object({
  permissions: githubPermissionsSchema,
});

/** The fields of one installation this tree compares, and the forge's own page for it. */
const githubInstallationPermissionsSchema = z.object({
  app_id: z.number().int().positive(),
  html_url: z.string().min(1),
  permissions: githubPermissionsSchema,
});

/** An address on the forge's web host, or nothing where it is not one a person can be sent to. */
function githubWebUrl(htmlUrl: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(htmlUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url;
}

/** The addresses a tenant's administrator installs this app from and authorizes it at, or nothing where the forge named no usable one. */
function githubAppWebUrls(
  htmlUrl: string,
): { readonly installUrl: string; readonly authorizeUrl: string } | undefined {
  const url = githubWebUrl(htmlUrl);
  if (url === undefined) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  return {
    installUrl: new URL(
      githubAppInstallPath,
      url.pathname.endsWith("/") ? url : new URL(`${url.pathname}/`, url),
    ).toString(),
    authorizeUrl: new URL(githubOAuthPaths.authorize, url.origin).toString(),
  };
}

/** The app's own account of itself, read once and then answered from memory. */
export function githubApps(options: GithubAppOptions): ForgeApps {
  const own = githubAppState(options);
  let described: ForgeAppDescribed | undefined;
  return {
    app: async () => {
      if (described !== undefined) return described;
      const answered = await githubAppSend(own, {
        url: new URL("/app", own.apiUrl),
        method: "GET",
        okStatus: githubAppReadStatus,
      });
      if (answered.answered !== "Answer") return { described: "Unavailable" };
      const read = await githubAppRead(own, answered.response, githubAppSchema);
      const urls =
        read === undefined ? undefined : githubAppWebUrls(read.html_url);
      if (read === undefined || urls === undefined)
        return { described: "Unavailable" };
      described = {
        described: "App",
        app: {
          id: String(read.id),
          slug: read.slug,
          clientId: read.client_id,
          ...urls,
        },
      };
      return described;
    },
  };
}

/** Where the forge answers an account's installation of the app, which it files by the account's kind. */
function githubAccountInstallationUrl(
  own: GithubAppState,
  account: ForgeInstallationAccount,
): URL {
  const collection = account.accountKind === "User" ? "users" : "orgs";
  return new URL(
    `/${collection}/${encodeURIComponent(account.account)}/installation`,
    own.apiUrl,
  );
}

/** One account's installation as the forge reports it, compared against the app this process is. */
async function githubAccountInstallationRead(
  own: GithubAppState,
  account: ForgeInstallationAccount,
): Promise<ForgeAccountInstallationRead> {
  const answered = await githubAppSend(own, {
    url: githubAccountInstallationUrl(own, account),
    method: "GET",
    okStatus: githubAppReadStatus,
  });
  if (answered.answered === "Denied") return { read: "Missing" };
  if (answered.answered === "Unavailable") return { read: "Unavailable" };
  const read = await githubAppRead(
    own,
    answered.response,
    githubAccountInstallationSchema,
  );
  if (read === undefined) return { read: "Unavailable" };
  if (String(read.app_id) !== own.appId) return { read: "Missing" };
  return {
    read: "Installation",
    installationId: asForgeInstallationId(String(read.id)),
    accountId: asForgeAccountId(String(read.account.id)),
  };
}

/** Whether the app asks any permission at a level the installation does not hold. */
function githubPermissionsBehind(
  requested: GithubPermissions,
  granted: GithubPermissions,
): boolean {
  const held = new Map<string, GithubPermissionLevel>(Object.entries(granted));
  return Object.entries(requested).some(([name, level]) => {
    const holding = held.get(name);
    const holdingRank =
      holding === undefined ? -1 : githubPermissionLevels.indexOf(holding);
    return holdingRank < githubPermissionLevels.indexOf(level);
  });
}

/** One read made as the app, answering what the schema reads or what stopped it. */
async function githubAppSchemaRead<T>(
  own: GithubAppState,
  url: URL,
  schema: z.ZodType<T>,
): Promise<
  | { readonly read: "Answer"; readonly value: T }
  | { readonly read: "Denied" }
  | { readonly read: "Unavailable" }
> {
  const answered = await githubAppSend(own, {
    url,
    method: "GET",
    okStatus: githubAppReadStatus,
  });
  if (answered.answered === "Denied") return { read: "Denied" };
  if (answered.answered === "Unavailable") return { read: "Unavailable" };
  const value = await githubAppRead(own, answered.response, schema);
  return value === undefined
    ? { read: "Unavailable" }
    : { read: "Answer", value };
}

/**
 * One installation's permissions against the app's, the installation read first
 * so one this app does not hold asks nothing more. A refusal of the app's own
 * read is an outage, because it says nothing about the installation.
 */
async function githubInstallationPermissionsRead(
  own: GithubAppState,
  installationId: ForgeInstallationId,
): Promise<ForgeInstallationPermissionsRead> {
  const installation = await githubAppSchemaRead(
    own,
    new URL(
      `/app/installations/${encodeURIComponent(installationId)}`,
      own.apiUrl,
    ),
    githubInstallationPermissionsSchema,
  );
  if (installation.read !== "Answer") return installation;
  if (String(installation.value.app_id) !== own.appId)
    return { read: "Denied" };
  const settingsUrl = githubWebUrl(installation.value.html_url);
  if (settingsUrl === undefined) return { read: "Unavailable" };
  const app = await githubAppSchemaRead(
    own,
    new URL("/app", own.apiUrl),
    githubAppPermissionsSchema,
  );
  if (app.read !== "Answer") return { read: "Unavailable" };
  return {
    read: "Permissions",
    permissions: githubPermissionsBehind(
      app.value.permissions,
      installation.value.permissions,
    )
      ? "Behind"
      : "Current",
    settingsUrl: settingsUrl.toString(),
  };
}

/** Reads this app's installation on one account, and what one installation has accepted. */
export function githubInstallationDirectory(
  options: GithubAppOptions,
): ForgeInstallationDirectory {
  const own = githubAppState(options);
  return {
    accountInstallation: (account) =>
      githubAccountInstallationRead(own, account),
    installationPermissions: (installationId) =>
      githubInstallationPermissionsRead(own, installationId),
  };
}
