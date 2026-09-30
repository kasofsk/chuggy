/**
 * GitHub's side of `ForgeUserAuthorization`: the code redeemed at the web host
 * the app describes, with a client secret read per redemption, and the token
 * presented to the API host for this one call and then dropped. A refusal
 * reaches the caller as its kind and never GitHub's words.
 */

import { z } from "zod";

import { forgeAuthorizationAccountsAnsweredMax } from "../../contract/http.ts";
import type {
  ForgeAuthorizationGrant,
  ForgeMembershipRead,
  ForgeUser,
  ForgeUserAuthorization,
  ForgeUserAuthorized,
  ForgeUserInstallation,
} from "../../interpreter/forgeAuthorization.ts";
import type { ForgeApps } from "../../interpreter/forgeDirectory.ts";
import {
  allForgeAccountKinds,
  asForgeAccount,
  asForgeAccountId,
  asForgeInstallationId,
} from "../../interpreter/forgeInstallation.ts";
import { githubOAuthPaths } from "./githubApp.ts";
import {
  githubAppBound,
  githubAppRead,
  githubBearerSend,
  githubRequestBounds,
  githubSecretText,
  githubWebSend,
  type GithubAppAnswered,
  type GithubRequestBounds,
  type GithubRequestOptions,
} from "./githubAppRequest.ts";

/** Everything the adapter is composed with: the app a person authorizes, its secret, and how far it pages. */
export interface GithubUserAuthorizationOptions extends GithubRequestOptions {
  readonly app: ForgeApps;
  readonly appId: string;
  readonly clientSecretPath: string;
  readonly clientSecretBytesMax?: number;
  readonly installationsMax?: number;
}

/** The bounds a deployment gets when it names none. */
export const githubUserAuthorizationDefaults = {
  clientSecretBytesMax: 1_024,
  installationsMax: forgeAuthorizationAccountsAnsweredMax,
  pageSize: 100,
} as const;

/** The status every answer read here arrives with, a redemption's refusal included. */
const githubAnsweredStatus = 200;

/** What the web host redeems a code as: a token, or its refusal to issue one. */
const githubRedemptionSchema = z.object({
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
});

/** The fields of the person this tree reads. */
const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
});

/** The fields of one page of the installations the person reaches. */
const githubUserInstallationsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      app_id: z.number().int().positive(),
      account: z.object({
        id: z.number().int().positive(),
        login: z.string().min(1),
        type: z.enum(allForgeAccountKinds),
      }),
    }),
  ),
});

type GithubUserInstallationRow = z.infer<
  typeof githubUserInstallationsSchema
>["installations"][number];

/** The fields of the person's membership of one organization. */
const githubMembershipSchema = z.object({
  state: z.string(),
  role: z.string(),
  organization: z.object({ id: z.number().int().positive() }),
});

/** What the adapter holds across redemptions, none of it the person's. */
interface GithubUserAuthorizationState {
  readonly bounds: GithubRequestBounds;
  readonly app: ForgeApps;
  readonly appId: string;
  readonly clientSecretPath: string;
  readonly clientSecretBytesMax: number;
  readonly installationsMax: number;
  readonly pageSize: number;
}

/** What one read came to, a refusal kept apart from an outage. */
type GithubRead<T> =
  | { readonly read: "Answer"; readonly value: T }
  | { readonly read: "Refused" }
  | { readonly read: "Unavailable" };

/** One request under the person's token, read as the schema it is answered in. */
async function githubUserRead<T>(
  own: GithubUserAuthorizationState,
  url: URL,
  token: string,
  schema: z.ZodType<T>,
): Promise<GithubRead<T>> {
  const answered = await githubBearerSend(
    own.bounds,
    { url, method: "GET", okStatus: githubAnsweredStatus },
    token,
  );
  return githubAnswerRead(own, answered, schema);
}

/** One answer read as the schema it arrives in, anything but the status asked for being a refusal or an outage. */
async function githubAnswerRead<T>(
  own: GithubUserAuthorizationState,
  answered: GithubAppAnswered,
  schema: z.ZodType<T>,
): Promise<GithubRead<T>> {
  if (answered.answered === "Denied") return { read: "Refused" };
  if (answered.answered === "Unavailable") return { read: "Unavailable" };
  const value = await githubAppRead(own.bounds, answered.response, schema);
  return value === undefined
    ? { read: "Unavailable" }
    : { read: "Answer", value };
}

/** What reading the client secret came to: the secret, a file holding none, or a file that could not be read. */
type GithubClientSecretRead =
  | { readonly read: "Secret"; readonly secret: string }
  | { readonly read: "Absent" }
  | { readonly read: "Unreadable" };

/**
 * The client secret, surrounding whitespace trimmed. A file that is not there
 * and one that holds only whitespace are both a secret this deployment was not
 * given, which a deployment mounting an optional one is.
 */
async function githubClientSecretRead(
  own: Pick<
    GithubUserAuthorizationState,
    "clientSecretPath" | "clientSecretBytesMax"
  >,
): Promise<GithubClientSecretRead> {
  let text: string;
  try {
    text = await githubSecretText(
      own.clientSecretPath,
      own.clientSecretBytesMax,
    );
  } catch (error: unknown) {
    return (error as { readonly code?: unknown }).code === "ENOENT"
      ? { read: "Absent" }
      : { read: "Unreadable" };
  }
  const secret = text.trim();
  return secret.length === 0 ? { read: "Absent" } : { read: "Secret", secret };
}

/** One grant redeemed at the web host the app's own description names. */
async function githubRedeemed(
  own: GithubUserAuthorizationState,
  grant: ForgeAuthorizationGrant,
): Promise<GithubRead<string>> {
  const described = await own.app.app();
  if (described.described !== "App") return { read: "Unavailable" };
  const secret = await githubClientSecretRead(own);
  if (secret.read !== "Secret") return { read: "Unavailable" };
  const read = await githubAnswerRead(
    own,
    await githubWebSend(own.bounds, {
      url: new URL(githubOAuthPaths.token, described.app.authorizeUrl),
      method: "POST",
      okStatus: githubAnsweredStatus,
      body: {
        client_id: described.app.clientId,
        client_secret: secret.secret,
        code: grant.code,
        redirect_uri: grant.redirectUri,
        code_verifier: grant.codeVerifier,
      },
    }),
    githubRedemptionSchema,
  );
  if (read.read !== "Answer") return read;
  if (read.value.access_token !== undefined)
    return { read: "Answer", value: read.value.access_token };
  return read.value.error === undefined
    ? { read: "Unavailable" }
    : { read: "Refused" };
}

/** One page of the installations the person reaches. */
function githubUserInstallationsUrl(
  own: GithubUserAuthorizationState,
  page: number,
): URL {
  const url = new URL("/user/installations", own.bounds.apiUrl);
  url.searchParams.set("per_page", String(own.pageSize));
  url.searchParams.set("page", String(page));
  return url;
}

/** The installations of this app the person reaches, and whether they reach more than were read. */
interface GithubUserInstallationRows {
  readonly rows: readonly GithubUserInstallationRow[];
  readonly truncated: boolean;
}

/** Pages the installations the person reaches, stopping at the bound or at the last page. */
async function githubUserInstallationRows(
  own: GithubUserAuthorizationState,
  token: string,
): Promise<GithubRead<GithubUserInstallationRows>> {
  const rows: GithubUserInstallationRow[] = [];
  let total = 0;
  for (let page = 1; rows.length < own.installationsMax; page += 1) {
    const read = await githubUserRead(
      own,
      githubUserInstallationsUrl(own, page),
      token,
      githubUserInstallationsSchema,
    );
    if (read.read !== "Answer") return read;
    total = read.value.total_count;
    rows.push(...read.value.installations);
    if (read.value.installations.length < own.pageSize) break;
  }
  const kept = rows.slice(0, own.installationsMax);
  return {
    read: "Answer",
    value: {
      rows: kept.filter((row) => String(row.app_id) === own.appId),
      truncated: total > kept.length,
    },
  };
}

/** The person's own membership of one organization, as the forge answers them. */
async function githubMembership(
  own: GithubUserAuthorizationState,
  token: string,
  organization: string,
): Promise<ForgeMembershipRead> {
  const read = await githubUserRead(
    own,
    new URL(
      `/user/memberships/orgs/${encodeURIComponent(organization)}`,
      own.bounds.apiUrl,
    ),
    token,
    githubMembershipSchema,
  );
  if (read.read !== "Answer") return { read: read.read };
  return {
    read: "Membership",
    organizationId: asForgeAccountId(String(read.value.organization.id)),
    active: read.value.state === "active",
    owner: read.value.role === "admin",
  };
}

/** One installation as the interpreter proves it, an organization's carrying the person's membership. */
async function githubUserInstallation(
  own: GithubUserAuthorizationState,
  token: string,
  row: GithubUserInstallationRow,
): Promise<ForgeUserInstallation> {
  const of = {
    installationId: asForgeInstallationId(String(row.id)),
    account: asForgeAccount(row.account.login),
    accountId: asForgeAccountId(String(row.account.id)),
  };
  return row.account.type === "User"
    ? { ...of, accountKind: "User" }
    : {
        ...of,
        accountKind: "Organization",
        membership: await githubMembership(own, token, of.account),
      };
}

/** Everything the token reaches, read under it and answered without it. */
async function githubReached(
  own: GithubUserAuthorizationState,
  token: string,
): Promise<ForgeUserAuthorized> {
  const user = await githubUserRead(
    own,
    new URL("/user", own.bounds.apiUrl),
    token,
    githubUserSchema,
  );
  if (user.read !== "Answer") return { authorized: user.read };
  const listed = await githubUserInstallationRows(own, token);
  if (listed.read !== "Answer") return { authorized: listed.read };
  try {
    const person: ForgeUser = {
      id: asForgeAccountId(String(user.value.id)),
      login: asForgeAccount(user.value.login),
    };
    const installations: ForgeUserInstallation[] = [];
    for (const row of listed.value.rows)
      installations.push(await githubUserInstallation(own, token, row));
    return {
      authorized: "User",
      user: person,
      installations,
      truncated: listed.value.truncated,
    };
  } catch {
    return { authorized: "Unavailable" };
  }
}

/** The adapter over its options, refusing at construction what it could never serve. */
export function githubUserAuthorization(
  options: GithubUserAuthorizationOptions,
): ForgeUserAuthorization {
  if (options.appId.length === 0)
    throw new RangeError("github user authorization: the app id is empty");
  if (options.clientSecretPath.length === 0)
    throw new RangeError("github user authorization: the secret path is empty");
  const installationsMax = githubAppBound(
    options.installationsMax ??
      githubUserAuthorizationDefaults.installationsMax,
    "the installations answered",
  );
  const own: GithubUserAuthorizationState = {
    bounds: githubRequestBounds(options),
    app: options.app,
    appId: options.appId,
    clientSecretPath: options.clientSecretPath,
    clientSecretBytesMax: githubAppBound(
      options.clientSecretBytesMax ??
        githubUserAuthorizationDefaults.clientSecretBytesMax,
      "the client secret bound",
    ),
    installationsMax,
    pageSize: Math.min(
      installationsMax,
      githubUserAuthorizationDefaults.pageSize,
    ),
  };
  return {
    authorized: async (grant) => {
      const token = await githubRedeemed(own, grant);
      if (token.read !== "Answer") return { authorized: token.read };
      return githubReached(own, token.value);
    },
  };
}

/**
 * Whether a deployment's client secret file holds a secret, holds none, or
 * cannot be read at all, which a deployment decides once as it starts. The
 * secret itself is read again for every redemption and never held.
 */
export async function githubClientSecretPresence(
  options: Pick<
    GithubUserAuthorizationOptions,
    "clientSecretPath" | "clientSecretBytesMax"
  >,
): Promise<"Present" | "Absent" | "Unreadable"> {
  const read = await githubClientSecretRead({
    clientSecretPath: options.clientSecretPath,
    clientSecretBytesMax:
      options.clientSecretBytesMax ??
      githubUserAuthorizationDefaults.clientSecretBytesMax,
  });
  return read.read === "Secret" ? "Present" : read.read;
}
