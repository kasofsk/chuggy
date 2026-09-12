/**
 * What GitHub tells this app about itself and about one installation of it.
 *
 * THE APP'S OWN IDENTITY IS READ ONCE PER PROCESS. It is a property of the key
 * this deployment mounts rather than of the request asking for it, so it cannot
 * change while the process runs; a route that asked the forge per request would
 * make an unauthenticated reader's page a forge request, which is a rate limit
 * a caller can spend on this deployment's behalf. An outage is not held: a
 * process that could not reach the forge once must be able to try again.
 *
 * THE INSTALL ADDRESS IS DERIVED FROM WHAT THE FORGE SAYS, not assembled from a
 * host this tree names. A deployment pointed at an enterprise server installs
 * from that server, and a constant here would send its administrators to a
 * public one.
 *
 * AN INSTALLATION OF ANOTHER APP IS UNKNOWN. Reading as the app already answers
 * 404 for one this app does not hold, and the `app_id` comparison is the second
 * term: a forge that answered with someone else's installation would otherwise
 * be recorded as a claim this deployment can never mint through.
 *
 * AN ANSWER THIS SIDE CANNOT READ IS AN OUTAGE AND NEVER AN ABSENCE. An account
 * kind this tree does not declare is such an answer, so a claim is never
 * recorded against a kind the table would refuse.
 */

import { z } from "zod";

import {
  allForgeAccountKinds,
  asForgeAccount,
  type ForgeInstallationId,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeAppDescribed,
  ForgeApps,
  ForgeInstallationDirectory,
  ForgeInstallationRead,
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

/** The fields of the app this tree reads, the rest being the forge's own account of it. */
const githubAppSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  html_url: z.string().min(1),
});

/** The fields of one installation this tree reads. */
const githubInstallationSchema = z.object({
  app_id: z.number().int().positive(),
  account: z.object({
    login: z.string().min(1),
    type: z.enum(allForgeAccountKinds),
  }),
});

/** The address a tenant's administrator installs this app from, or nothing where the forge named no usable one. */
function githubAppInstallUrl(htmlUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(htmlUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  return new URL(
    githubAppInstallPath,
    url.pathname.endsWith("/") ? url : new URL(`${url.pathname}/`, url),
  ).toString();
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
      const installUrl =
        read === undefined ? undefined : githubAppInstallUrl(read.html_url);
      if (read === undefined || installUrl === undefined)
        return { described: "Unavailable" };
      described = {
        described: "App",
        app: { id: String(read.id), slug: read.slug, installUrl },
      };
      return described;
    },
  };
}

/** One installation as the forge reports it, compared against the app this process is. */
async function githubInstallationRead(
  own: GithubAppState,
  installationId: ForgeInstallationId,
): Promise<ForgeInstallationRead> {
  const answered = await githubAppSend(own, {
    url: new URL(
      `/app/installations/${encodeURIComponent(installationId)}`,
      own.apiUrl,
    ),
    method: "GET",
    okStatus: githubAppReadStatus,
  });
  if (answered.answered === "Denied") return { read: "Unknown" };
  if (answered.answered === "Unavailable") return { read: "Unavailable" };
  const read = await githubAppRead(
    own,
    answered.response,
    githubInstallationSchema,
  );
  if (read === undefined) return { read: "Unavailable" };
  if (String(read.app_id) !== own.appId) return { read: "Unknown" };
  try {
    return {
      read: "Installation",
      installation: {
        account: asForgeAccount(read.account.login),
        accountKind: read.account.type,
      },
    };
  } catch {
    return { read: "Unavailable" };
  }
}

/** Reads one installation of this app by the identity the forge gave it. */
export function githubInstallationDirectory(
  options: GithubAppOptions,
): ForgeInstallationDirectory {
  const own = githubAppState(options);
  return {
    installation: (installationId) =>
      githubInstallationRead(own, installationId),
  };
}
