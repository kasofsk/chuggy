/**
 * One bounded request to GitHub: the app's own key and the JWT it signs, and
 * the exchange every caller in this directory shares.
 *
 * IT IS ONE FILE BECAUSE IT IS ONE CONVERSATION. Minting an installation token,
 * reading the app's own identity, reading one installation and paging what an
 * installation grants are all this tree talking to one host under one set of
 * bounds. Spelled four times, they would be four chances for one of them to
 * accept a redirect, drop a deadline, or read an answer past its bound — and
 * the one that did would be the one holding a private key.
 *
 * A BEARER IS THE CALLER'S AND THE REQUEST IS NOT. Two of those callers present
 * the app's own JWT and one presents an installation token minted under it, so
 * the bearer is a parameter and the app's key is reached only by the callers
 * that need it — an adapter that only pages a listing never opens the key file.
 *
 * THE KEY IS READ PER REQUEST AND IS NEVER HELD. It stands in a file the
 * deployment mounts, read once into a buffer a byte wider than a key may be, so
 * a device standing where a key should be cannot be drawn on and a file that
 * grew past its bound is refused rather than truncated into something that
 * signs differently. Requests are rare because their answers are cached or made
 * once, so reading is cheaper than holding.
 *
 * BOTH PEM ENCODINGS ARE ACCEPTED BECAUSE GITHUB ISSUES THE OLDER ONE. An app's
 * key downloads as PKCS#1 and a key converted by hand is PKCS#8;
 * `createPrivateKey` reads either, and anything that is not an RSA private key
 * is refused where it is read rather than at the signature GitHub would reject.
 *
 * A JWT IS THE APP SAYING WHO IT IS AND NOTHING ELSE. It is issued a minute in
 * the past against a clock this process does not share with the forge, expires
 * inside the window the forge admits, and is verified by nobody else.
 *
 * EXACTLY ONE FORGE REQUEST IS MADE PER CALL, under a deadline and refusing a
 * redirect, for `githubChangeProposals.ts`'s reasons. A refusal of this app is
 * `Denied` and settled; a throttle, a fault, a timeout, a status the caller did
 * not ask for and an answer this side cannot read are `Unavailable` and may be
 * asked again.
 */

import { open } from "node:fs/promises";
import { createPrivateKey, type KeyObject } from "node:crypto";

import { SignJWT } from "jose";
import type { z } from "zod";

import { githubResponseTextOf } from "./githubResponse.ts";

/** Where the forge is and how much of it one call may take. */
export interface GithubRequestOptions {
  readonly fetch: typeof fetch;
  readonly apiUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly responseBytesMax?: number;
}

/** Everything an app-authenticated caller adds: which app it is, and the key it signs as. */
export interface GithubAppOptions extends GithubRequestOptions {
  readonly appId: string;
  readonly privateKeyPath: string;
  readonly privateKeyBytesMax?: number;
  readonly currentTimeEpochMs?: () => number;
}

/** The forge and the bounds a deployment gets when it names none. */
export const githubAppDefaults = {
  apiUrl: "https://api.github.com",
  requestTimeoutMs: 30_000,
  responseBytesMax: 1_048_576,
  privateKeyBytesMax: 16_384,
} as const;

/** The media type this forge answers in, and the one a request body is sent as. */
const githubAcceptMediaType = "application/vnd.github+json";
const githubRequestMediaType = "application/json";

/** The API generation every request pins, so a later default cannot change what a body means. */
const githubApiVersion = "2022-11-28";

/** The agent this tree presents itself to a forge as. */
const githubUserAgent = "chuggy-api";

/** The algorithm GitHub verifies an app's JWT under. */
const githubAppJwtAlgorithm = "RS256";

/** The key type that algorithm signs with, and the only one this file accepts. */
const githubAppKeyType = "rsa";

/** How far in the past an app's JWT is issued, which is the drift GitHub tolerates. */
const githubAppJwtBackdateSecs = 60;

/** How long an app's JWT lives, inside the window past its issuance GitHub admits. */
const githubAppJwtLifetimeSecs = 540;

/** The statuses that are the forge refusing this caller rather than failing. */
const githubDeniedStatuses: readonly number[] = [401, 403, 404, 422];

const millisecondsPerSecond = 1_000;

/** Where the forge is and what one call may spend, checked once at construction. */
export interface GithubRequestBounds {
  readonly requestFetch: typeof fetch;
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
}

/** What an app-authenticated caller holds besides those: the app it is. */
export interface GithubAppState extends GithubRequestBounds {
  readonly appId: string;
  readonly privateKeyPath: string;
  readonly privateKeyBytesMax: number;
  readonly currentTimeEpochMs: () => number;
}

/** Refuses a bound no later call could work around. */
export function githubAppBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`github app: ${what} is not a positive bound`);
  return value;
}

/** Refuses an API URL that is not one, so every URL built here is built from one checked once. */
function githubAppApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new RangeError("github app: the API URL is not HTTP");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("github app: the API URL carries credentials");
  return url.toString();
}

/** The forge and the bounds, refusing at construction what no call could work around. */
export function githubRequestBounds(
  options: GithubRequestOptions,
): GithubRequestBounds {
  return {
    requestFetch: options.fetch,
    apiUrl: githubAppApiUrl(options.apiUrl ?? githubAppDefaults.apiUrl),
    requestTimeoutMs: githubAppBound(
      options.requestTimeoutMs ?? githubAppDefaults.requestTimeoutMs,
      "the request timeout",
    ),
    responseBytesMax: githubAppBound(
      options.responseBytesMax ?? githubAppDefaults.responseBytesMax,
      "the response bound",
    ),
  };
}

/** The composition of an app-authenticated caller, refusing what it could never serve. */
export function githubAppState(options: GithubAppOptions): GithubAppState {
  if (options.appId.length === 0)
    throw new RangeError("github app: the app id is empty");
  if (options.privateKeyPath.length === 0)
    throw new RangeError("github app: the private key path is empty");
  return {
    ...githubRequestBounds(options),
    appId: options.appId,
    privateKeyPath: options.privateKeyPath,
    privateKeyBytesMax: githubAppBound(
      options.privateKeyBytesMax ?? githubAppDefaults.privateKeyBytesMax,
      "the private key bound",
    ),
    currentTimeEpochMs: options.currentTimeEpochMs ?? Date.now,
  };
}

/**
 * One file's whole key text, refused rather than truncated once it passes the
 * bound. Every way of not reading it raises, because a caller that cannot read
 * its key is an outage rather than an answer.
 */
async function githubAppKeyText(
  path: string,
  bytesMax: number,
): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > bytesMax)
      throw new RangeError("github app: the private key passed its bound");
    return buffer.subarray(0, read.bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The app's signing key, refusing anything that is not an RSA private key in either PEM encoding. */
export async function githubAppKey(
  own: Pick<GithubAppState, "privateKeyPath" | "privateKeyBytesMax">,
): Promise<KeyObject> {
  const key = createPrivateKey(
    await githubAppKeyText(own.privateKeyPath, own.privateKeyBytesMax),
  );
  if (key.asymmetricKeyType !== githubAppKeyType)
    throw new RangeError("github app: the private key is not an RSA key");
  return key;
}

/** The app's own bearer, which names the app and claims nothing else. */
async function githubAppJwt(
  own: GithubAppState,
  key: KeyObject,
): Promise<string> {
  const issuedAtSecs =
    Math.floor(own.currentTimeEpochMs() / millisecondsPerSecond) -
    githubAppJwtBackdateSecs;
  return new SignJWT({})
    .setProtectedHeader({ alg: githubAppJwtAlgorithm })
    .setIssuer(own.appId)
    .setIssuedAt(issuedAtSecs)
    .setExpirationTime(issuedAtSecs + githubAppJwtLifetimeSecs)
    .sign(key);
}

/** What one request came to, a refusal kept apart from an outage. */
export type GithubAppAnswered =
  | { readonly answered: "Answer"; readonly response: Response }
  | { readonly answered: "Denied" }
  | { readonly answered: "Unavailable" };

/** One request as a caller spells it, including the one status it treats as an answer. */
export interface GithubAppRequest {
  readonly url: URL;
  readonly method: "GET" | "POST";
  readonly okStatus: number;
  readonly body?: unknown;
}

/**
 * Makes the one bounded forge request, every way of not answering being an
 * outage and a status the caller did not ask for being one too: a caller reads
 * a body only from the status it named.
 */
export async function githubBearerSend(
  own: GithubRequestBounds,
  request: GithubAppRequest,
  bearer: string,
): Promise<GithubAppAnswered> {
  let response: Response;
  try {
    response = await own.requestFetch(request.url, {
      method: request.method,
      headers: {
        accept: githubAcceptMediaType,
        authorization: `Bearer ${bearer}`,
        "content-type": githubRequestMediaType,
        "user-agent": githubUserAgent,
        "x-github-api-version": githubApiVersion,
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(own.requestTimeoutMs),
    });
  } catch {
    return { answered: "Unavailable" };
  }
  if (response.status === request.okStatus)
    return { answered: "Answer", response };
  await response.body?.cancel().catch(() => undefined);
  return githubDeniedStatuses.includes(response.status)
    ? { answered: "Denied" }
    : { answered: "Unavailable" };
}

/** The same request under the app's own bearer, a key this process cannot sign with being an outage. */
export async function githubAppSend(
  own: GithubAppState,
  request: GithubAppRequest,
): Promise<GithubAppAnswered> {
  let bearer: string;
  try {
    bearer = await githubAppJwt(own, await githubAppKey(own));
  } catch {
    return { answered: "Unavailable" };
  }
  return githubBearerSend(own, request, bearer);
}

/**
 * The fields of an answer this tree reads, and nothing where the forge sent
 * something past the bound or something this side cannot read. The rest of the
 * answer is the forge's own account of itself and is discarded.
 */
export async function githubAppRead<T>(
  own: Pick<GithubRequestBounds, "responseBytesMax">,
  response: Response,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  try {
    return schema.parse(
      JSON.parse(
        await githubResponseTextOf(
          response,
          own.responseBytesMax,
          "github app",
        ),
      ),
    );
  } catch {
    return undefined;
  }
}
