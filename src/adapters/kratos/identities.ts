/**
 * `AccessDirectory` over Ory Kratos's admin API: an account found by the
 * credential identifier it carries, created already carrying a GitHub sign-in
 * credential, and a page of subjects read back by id.
 *
 * THE ADMIN API HAS NO AUTHENTICATION, so reach is its whole control, and
 * `.dependency-cruiser.cjs` refuses every root but the access plane's.
 *
 * AN ACCOUNT IS CREATED WITH AN EMAIL NOBODY VERIFIED, so it carries the email
 * as a trait and nothing marking it verified, and no password.
 *
 * EVERY ANSWER IS READ UNDER A BYTE BOUND BY A SCHEMA KEEPING ONLY WHAT IS
 * USED, and nothing Kratos wrote in free text leaves this file: a refusal is
 * its status, and an email or a login is kept only in the shape the plane
 * admits for one.
 */

import { z } from "zod";

import {
  accessEmailSchema,
  accessGithubLoginSchema,
} from "../../contract/accessPlane.ts";
import {
  AccessDirectoryUnavailable,
  accessDirectorySubject,
  accessDirectorySubjectsMax,
  type AccessAccount,
  type AccessAccountCreated,
  type AccessDirectory,
  type AccessDirectorySettings,
  type AccessGithubAccount,
} from "../../interpreter/accessDirectory.ts";
import {
  boundedJsonRequest,
  BoundedJsonUnanswered,
  type BoundedJsonAnswer,
} from "../../interpreter/boundedJsonRequest.ts";

/** The identity collection every question addresses. */
const kratosIdentitiesPath = "admin/identities";

/** The identity schema the deployment declares. */
export const kratosSchemaId = "default";

/** The social sign-in provider an invited account carries a credential of. */
export const kratosGithubProvider = "github";

/** The most one answer may weigh, which a full page of identities fits. */
export const kratosResponseBytesMax = 1_048_576;

/** The most reads one answer may take, so a trickle of empty chunks cannot hold a question open. */
export const kratosResponseReadsMax = 1_024;

/** The most identities one credential identifier is answered with that are read. */
const kratosHoldersMax = 16;

/** The fields of an identity a credential finding reads. */
const kratosHoldersSchema = z
  .array(
    z.object({
      id: z.string(),
      credentials: z
        .object({
          oidc: z.object({ identifiers: z.array(z.string()) }).optional(),
        })
        .optional(),
    }),
  )
  .max(kratosHoldersMax);

/** The field of a created identity this side reads. */
const kratosCreatedSchema = z.object({ id: z.string() });

/** The fields of an identity a page of subjects reads, each text judged on its own. */
const kratosAccountsSchema = z
  .array(
    z.object({
      id: z.string(),
      traits: z.object({ email: z.unknown() }).nullable().optional(),
      metadata_admin: z
        .object({ github_login: z.unknown() })
        .nullable()
        .optional(),
    }),
  )
  .max(accessDirectorySubjectsMax);

/** The credential identifier Kratos indexes a GitHub sign-in under. */
export function kratosGithubIdentifier(github: AccessGithubAccount): string {
  return `${kratosGithubProvider}:${github.id}`;
}

async function kratosAsked(
  settings: AccessDirectorySettings,
  fetcher: typeof fetch,
  url: URL,
  body?: unknown,
): Promise<BoundedJsonAnswer> {
  try {
    return await boundedJsonRequest({
      fetcher,
      url,
      method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
      bytesMax: kratosResponseBytesMax,
      readsMax: kratosResponseReadsMax,
      ...(body === undefined ? {} : { body }),
    });
  } catch (failure) {
    if (failure instanceof BoundedJsonUnanswered)
      throw new AccessDirectoryUnavailable(failure.message);
    throw failure;
  }
}

/** The answer's body as `schema` reads it, from the one status that carries it. */
function kratosRead<T>(
  answer: BoundedJsonAnswer,
  status: number,
  schema: z.ZodType<T>,
  what: string,
): T {
  if (answer.status !== status)
    throw new AccessDirectoryUnavailable(
      `${what} answered ${String(answer.status)}`,
    );
  const read = schema.safeParse(answer.json);
  if (!read.success)
    throw new AccessDirectoryUnavailable(`${what} answered an unreadable body`);
  return read.data;
}

function kratosIdentitiesUrl(
  settings: AccessDirectorySettings,
  query: readonly (readonly [string, string])[],
): URL {
  const url = new URL(kratosIdentitiesPath, settings.adminUrl);
  for (const [name, value] of query) url.searchParams.append(name, value);
  return url;
}

/** The identities carrying one credential identifier. */
async function kratosHolders(
  settings: AccessDirectorySettings,
  fetcher: typeof fetch,
  identifier: string,
): Promise<z.infer<typeof kratosHoldersSchema>> {
  return kratosRead(
    await kratosAsked(
      settings,
      fetcher,
      kratosIdentitiesUrl(settings, [["credentials_identifier", identifier]]),
    ),
    200,
    kratosHoldersSchema,
    "a credential finding",
  );
}

/** What a creation is sent: the email, the GitHub credential, and who invited the person to which tenant. */
function kratosCreation(
  account: Parameters<AccessDirectory["create"]>[0],
): unknown {
  return {
    schema_id: kratosSchemaId,
    traits: { email: account.email },
    credentials: {
      oidc: {
        config: {
          providers: [
            { provider: kratosGithubProvider, subject: account.github.id },
          ],
        },
      },
    },
    metadata_admin: {
      invited_by: account.invitedBy,
      tenant: account.tenant,
      github_login: account.github.login,
      github_id: account.github.id,
    },
  };
}

async function kratosCreated(
  settings: AccessDirectorySettings,
  fetcher: typeof fetch,
  account: Parameters<AccessDirectory["create"]>[0],
): Promise<AccessAccountCreated> {
  const answer = await kratosAsked(
    settings,
    fetcher,
    kratosIdentitiesUrl(settings, []),
    kratosCreation(account),
  );
  if (answer.status === 409) return { created: "Conflict" };
  if (answer.status === 400) return { created: "EmailRefused" };
  const { id } = kratosRead(answer, 201, kratosCreatedSchema, "a creation");
  if (!accessDirectorySubject(id))
    throw new AccessDirectoryUnavailable("a creation answered no account id");
  return { created: "Created", subject: id };
}

/** One identity as the plane reads it, a text kept only in the shape the plane admits. */
function kratosAccount(
  identity: z.infer<typeof kratosAccountsSchema>[number],
): AccessAccount {
  const email = accessEmailSchema.safeParse(identity.traits?.email);
  const login = accessGithubLoginSchema.safeParse(
    identity.metadata_admin?.github_login,
  );
  return {
    subject: identity.id,
    ...(email.success ? { email: email.data } : {}),
    ...(login.success ? { githubLogin: login.data } : {}),
  };
}

async function kratosAccounts(
  settings: AccessDirectorySettings,
  fetcher: typeof fetch,
  subjects: readonly string[],
): Promise<readonly AccessAccount[]> {
  if (
    subjects.length > accessDirectorySubjectsMax ||
    !subjects.every((subject) => accessDirectorySubject(subject))
  )
    throw new RangeError(
      "access directory: a page of subjects is past its bound or names one that is no account",
    );
  if (subjects.length === 0) return [];
  const identities = kratosRead(
    await kratosAsked(
      settings,
      fetcher,
      kratosIdentitiesUrl(settings, [
        ...subjects.map((subject) => ["ids", subject] as const),
        ["page_size", String(subjects.length)],
      ]),
    ),
    200,
    kratosAccountsSchema,
    "a page of subjects",
  );
  return identities
    .filter((identity) => accessDirectorySubject(identity.id))
    .map(kratosAccount);
}

export function kratosAccessDirectory(
  settings: AccessDirectorySettings,
  fetcher: typeof fetch = fetch,
): AccessDirectory {
  return {
    githubHolder: async (github) => {
      const identifier = kratosGithubIdentifier(github);
      const holder = (await kratosHolders(settings, fetcher, identifier)).find(
        (identity) =>
          accessDirectorySubject(identity.id) &&
          (identity.credentials?.oidc?.identifiers ?? []).includes(identifier),
      );
      return holder?.id;
    },
    emailHeld: async (email) =>
      (await kratosHolders(settings, fetcher, email)).length > 0,
    create: (account) => kratosCreated(settings, fetcher, account),
    accounts: (subjects) => kratosAccounts(settings, fetcher, subjects),
  };
}
