/**
 * What GitHub tells this app about itself and about its installation on one
 * account.
 *
 * THE APP'S OWN IDENTITY IS READ ONCE PER PROCESS. It is a property of the key
 * this deployment mounts rather than of the request asking for it, so it cannot
 * change while the process runs; a route that asked the forge per request would
 * make an unauthenticated reader's page a forge request, which is a rate limit
 * a caller can spend on this deployment's behalf. An outage is not held: a
 * process that could not reach the forge once must be able to try again.
 *
 * THE INSTALL AND AUTHORIZE ADDRESSES ARE DERIVED FROM WHAT THE FORGE SAYS, not
 * assembled from a host this tree names. A deployment pointed at an enterprise
 * server installs from that server, and a constant here would send its
 * administrators to a public one.
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
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeAccountInstallationRead,
  ForgeAppDescribed,
  ForgeApps,
  ForgeInstallationAccount,
  ForgeInstallationDirectory,
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

/** The addresses a tenant's administrator installs this app from and authorizes it at, or nothing where the forge named no usable one. */
function githubAppWebUrls(
  htmlUrl: string,
): { readonly installUrl: string; readonly authorizeUrl: string } | undefined {
  let url: URL;
  try {
    url = new URL(htmlUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
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

/** Reads this app's installation on one account. */
export function githubInstallationDirectory(
  options: GithubAppOptions,
): ForgeInstallationDirectory {
  const own = githubAppState(options);
  return {
    accountInstallation: (account) =>
      githubAccountInstallationRead(own, account),
  };
}
