/**
 * `WorkerPoolTokens` over the issuer's token endpoint, which is the one place a
 * pool's registration secret is ever sent.
 *
 * THE AUDIENCE IS NOT OPTIONAL AND IS THE WHOLE TRAP. Hydra puts an `aud` claim
 * on a client-credentials token only when the token request names one, and the
 * plane validates `aud` against the API audience, so a request that omits it
 * mints a token every call is then refused with — a 401 that looks like a wrong
 * secret and is not. The registered client bounds what may be asked for, so
 * naming it here widens nothing.
 *
 * THE TOKEN ENDPOINT IS CONFIGURED RATHER THAN DISCOVERED. A pool already has
 * to be told the plane's address and its own credential by the operator who
 * registered it, and discovery would add a second network call whose failure
 * mode is a third thing to tell apart; the installation that hands out a
 * client secret hands out the endpoint it is spent at.
 *
 * A REFUSAL AND AN OUTAGE ARE DIFFERENT ANSWERS. The grant's own error statuses
 * are the issuer saying this client may not have a token, which no retry
 * changes; every other status, every unreadable body and every connection that
 * did not open is an outage the caller comes back from.
 */

import { z } from "zod";

import type {
  WorkerPoolTokenAcquired,
  WorkerPoolTokens,
} from "../../interpreter/workerPoolClient.ts";
import { httpBoundedText } from "./boundedResponse.ts";

/** The most a token answer may weigh, which is orders above a signed JWT. */
export const clientCredentialsBytesMax = 64 * 1024;

/**
 * What a granted token answer must carry. A grant that returned no expiry is
 * read as one that expires immediately, because a client that assumed
 * otherwise would keep presenting a token the plane has stopped taking.
 */
const clientCredentialsGrantSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});

export interface ClientCredentialsSettings {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly requestTimeoutMs: number;
}

export function checkedClientCredentialsSettings(
  input: ClientCredentialsSettings,
): ClientCredentialsSettings {
  const url = new URL(input.tokenUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new RangeError("issuer token URL must be HTTP or HTTPS");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("issuer token URL must carry no credentials");
  for (const [name, value] of [
    ["client id", input.clientId],
    ["client secret", input.clientSecret],
    ["audience", input.audience],
  ] as const)
    if (value.length === 0) throw new RangeError(`pool ${name} is empty`);
  if (
    !Number.isSafeInteger(input.requestTimeoutMs) ||
    input.requestTimeoutMs < 1
  )
    throw new RangeError("issuer token timeout must be a positive integer");
  return { ...input, tokenUrl: url.toString() };
}

/**
 * The client's own credential as the registered authentication method sends
 * it, which is HTTP Basic over the two percent-encoded halves that RFC 6749
 * requires of them.
 */
function clientCredentialsAuthorization(
  settings: ClientCredentialsSettings,
): string {
  const encoded = Buffer.from(
    `${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`,
  ).toString("base64");
  return `Basic ${encoded}`;
}

/** The grant request's own body, the audience among it for the reason the header states. */
function clientCredentialsBody(settings: ClientCredentialsSettings): string {
  return new URLSearchParams({
    grant_type: "client_credentials",
    audience: settings.audience,
  }).toString();
}

/** The statuses that are the grant refusing this client rather than the issuer faltering. */
const clientCredentialsRefusals: ReadonlySet<number> = new Set([400, 401, 403]);

async function clientCredentialsAcquired(
  settings: ClientCredentialsSettings,
  fetcher: typeof fetch,
): Promise<WorkerPoolTokenAcquired> {
  let answered: Response;
  try {
    answered = await fetcher(settings.tokenUrl, {
      method: "POST",
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
      headers: {
        accept: "application/json",
        authorization: clientCredentialsAuthorization(settings),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: clientCredentialsBody(settings),
    });
  } catch {
    return {
      acquired: "Unavailable",
      evidence: "the issuer token endpoint could not be reached",
    };
  }
  if (clientCredentialsRefusals.has(answered.status))
    return {
      acquired: "Denied",
      evidence: `the issuer refused this pool's grant with ${String(answered.status)}`,
    };
  if (!answered.ok)
    return {
      acquired: "Unavailable",
      evidence: `the issuer answered ${String(answered.status)}`,
    };
  return clientCredentialsRead(answered);
}

/** One granted answer as this side reads it, an unreadable body being an outage like any other. */
async function clientCredentialsRead(
  answered: Response,
): Promise<WorkerPoolTokenAcquired> {
  const text = await httpBoundedText(answered, clientCredentialsBytesMax);
  if (text === undefined)
    return {
      acquired: "Unavailable",
      evidence: "the issuer answered more than a token",
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { acquired: "Unavailable", evidence: "the issuer answered no JSON" };
  }
  const granted = clientCredentialsGrantSchema.safeParse(parsed);
  return granted.success
    ? {
        acquired: "Token",
        token: granted.data.access_token,
        expiresInSecs: granted.data.expires_in ?? 0,
      }
    : { acquired: "Unavailable", evidence: "the issuer answered no token" };
}

export function clientCredentialsTokens(
  input: ClientCredentialsSettings,
  fetcher: typeof fetch = fetch,
): WorkerPoolTokens {
  const settings = checkedClientCredentialsSettings(input);
  return { acquire: () => clientCredentialsAcquired(settings, fetcher) };
}
