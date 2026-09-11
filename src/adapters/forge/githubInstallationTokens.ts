/**
 * The adapter behind `ForgeInstallationTokens` for GitHub: the app's own JWT,
 * and the one request that exchanges it for a token scoped to named
 * repositories.
 *
 * THE KEY IS READ PER MINT AND IS NEVER HELD. It stands in a file the
 * deployment mounts, read once into a buffer a byte wider than a key may be, so
 * a device standing where a key should be cannot be drawn on and a file that
 * grew past its bound is refused rather than truncated into something that
 * signs differently. Mints are rare because their tokens are cached, so reading
 * is cheaper than holding.
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
 * EXACTLY ONE FORGE REQUEST IS MADE PER MINT, under a deadline and refusing a
 * redirect, for `githubChangeProposals.ts`'s reasons. A refusal of this app is
 * `Denied` and settled; a throttle, a fault, a timeout and an answer this side
 * cannot read are `Unavailable` and may be asked again.
 *
 * A TOKEN IS HELD UNTIL ITS OWN EXPIRY, LESS A MARGIN, KEYED BY WHAT IT IS GOOD
 * FOR. Repeated mints for one key are one request for as long as the held token
 * lasts; anything else is a different key, because a cache keyed more loosely
 * would hand a reader a credential that can push. Nothing tracks a request in
 * flight, so mints racing on one key each send and each get a valid token, the
 * last of them being the one held.
 */

import { open } from "node:fs/promises";
import { createPrivateKey, type KeyObject } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

import {
  asForgeInstallationToken,
  forgePermissionSets,
  type ForgeInstallationToken,
  type ForgeInstallationTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../interpreter/forgeInstallation.ts";
import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import { githubResponseTextOf } from "./githubResponse.ts";

/** Everything the adapter is composed with, `fetch` among them because nothing here reaches a global. */
export interface GithubInstallationTokensOptions {
  readonly fetch: typeof fetch;
  readonly appId: string;
  readonly privateKeyPath: string;
  readonly apiUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly responseBytesMax?: number;
  readonly privateKeyBytesMax?: number;
  readonly tokenMarginMs?: number;
  readonly cachedTokensMax?: number;
  readonly currentTimeEpochMs?: () => number;
}

/** The forge and the bounds a deployment gets when it names none. */
export const githubInstallationTokensDefaults = {
  apiUrl: "https://api.github.com",
  requestTimeoutMs: 30_000,
  responseBytesMax: 1_048_576,
  privateKeyBytesMax: 16_384,
  tokenMarginMs: 60_000,
  cachedTokensMax: 256,
} as const;

/** The variables one process reads its app key and its forge from. */
export interface GithubInstallationTokensVariables {
  readonly appId: string;
  readonly appKeyFile: string;
  readonly apiUrl: string;
  readonly timeoutMs: string;
}

/**
 * What a process mints with, or nothing at all where it holds no app key. Two
 * processes hold an app key under names of their own — the API the portal
 * App's, the worker plane the worker App's — and this is the one place either
 * is read: a second parse would be a second answer to what an app id named
 * without its key file means.
 */
export function githubInstallationTokensSettings(
  named: GithubInstallationTokensVariables,
  environment: Readonly<Record<string, string | undefined>>,
  positive: (name: string, fallback: number) => number,
): GithubInstallationTokensOptions | undefined {
  const appId = environment[named.appId] ?? "";
  const privateKeyPath = environment[named.appKeyFile] ?? "";
  if (appId.length === 0 && privateKeyPath.length === 0) return undefined;
  if (appId.length === 0 || privateKeyPath.length === 0)
    throw new Error(
      `${named.appId} and ${named.appKeyFile} are named together or not at all`,
    );
  return {
    fetch,
    appId,
    privateKeyPath,
    apiUrl:
      environment[named.apiUrl] ?? githubInstallationTokensDefaults.apiUrl,
    requestTimeoutMs: positive(
      named.timeoutMs,
      githubInstallationTokensDefaults.requestTimeoutMs,
    ),
  };
}

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

/** The statuses that are the forge refusing this app rather than failing. */
const githubDeniedStatuses: readonly number[] = [401, 403, 404, 422];

/** The status a mint is answered with, a forge that made no token answering something else. */
const githubMintedStatus = 201;

const millisecondsPerSecond = 1_000;

/** The fields of a minted token this tree reads, the rest of the answer being the forge's own account of it. */
const githubAccessTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1),
});

/** What the adapter holds across mints: its bounds, its forge, its app and its cache. */
interface GithubInstallationTokensState {
  readonly requestFetch: typeof fetch;
  readonly appId: string;
  readonly privateKeyPath: string;
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
  readonly privateKeyBytesMax: number;
  readonly tokenMarginMs: number;
  readonly cachedTokensMax: number;
  readonly currentTimeEpochMs: () => number;
  readonly cached: Map<string, GithubCachedToken>;
}

interface GithubCachedToken {
  readonly token: ForgeInstallationToken;
  readonly expiresAtMs: number;
}

/** Refuses a bound no later call could work around. */
function githubInstallationTokensBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`github tokens: ${what} is not a positive bound`);
  return value;
}

/** Refuses an API URL that is not one, so every URL this adapter builds is built from one it checked once. */
function githubInstallationTokensApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new RangeError("github tokens: the API URL is not HTTP");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("github tokens: the API URL carries credentials");
  return url.toString();
}

/**
 * One file's whole key text, refused rather than truncated once it passes the
 * bound. Every way of not reading it raises, because a mint that cannot read
 * its key is an outage rather than an answer.
 */
async function githubInstallationTokensKeyText(
  path: string,
  bytesMax: number,
): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > bytesMax)
      throw new RangeError("github tokens: the private key passed its bound");
    return buffer.subarray(0, read.bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The app's signing key, refusing anything that is not an RSA private key in either PEM encoding. */
async function githubInstallationTokensKey(
  own: Pick<
    GithubInstallationTokensState,
    "privateKeyPath" | "privateKeyBytesMax"
  >,
): Promise<KeyObject> {
  const key = createPrivateKey(
    await githubInstallationTokensKeyText(
      own.privateKeyPath,
      own.privateKeyBytesMax,
    ),
  );
  if (key.asymmetricKeyType !== githubAppKeyType)
    throw new RangeError("github tokens: the private key is not an RSA key");
  return key;
}

/** The app's own bearer, which names the app and claims nothing else. */
async function githubInstallationTokensJwt(
  own: GithubInstallationTokensState,
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

/** The forge's own spelling of one named permission set. */
function githubInstallationTokensPermissions(
  request: ForgeTokenRequest,
): Readonly<Record<string, string>> {
  const permissions = forgePermissionSets[request.permissions];
  return {
    contents: permissions.contents,
    ...(permissions.changeProposals === undefined
      ? {}
      : { pull_requests: permissions.changeProposals }),
  };
}

/** The access-token collection of one installation. */
function githubInstallationTokensUrl(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): URL {
  return new URL(
    `/app/installations/${encodeURIComponent(request.installation.installationId)}/access_tokens`,
    own.apiUrl,
  );
}

/** What a token is good for, which is what two mints have to agree on to be one. */
function githubInstallationTokensCacheKey(request: ForgeTokenRequest): string {
  return JSON.stringify([
    request.installation.installationId,
    [...request.repositories].sort(),
    request.permissions,
  ]);
}

/** Makes the one bounded forge request this mint is, every way of not answering being an outage. */
async function githubInstallationTokensSend(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): Promise<ForgeTokenMinted> {
  let response: Response;
  try {
    const key = await githubInstallationTokensKey(own);
    response = await own.requestFetch(
      githubInstallationTokensUrl(own, request),
      {
        method: "POST",
        headers: {
          accept: githubAcceptMediaType,
          authorization: `Bearer ${await githubInstallationTokensJwt(own, key)}`,
          "content-type": githubRequestMediaType,
          "user-agent": githubUserAgent,
          "x-github-api-version": githubApiVersion,
        },
        body: JSON.stringify({
          repositories: [...request.repositories],
          permissions: githubInstallationTokensPermissions(request),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(own.requestTimeoutMs),
      },
    );
  } catch {
    return { minted: "Unavailable" };
  }
  if (response.status !== githubMintedStatus) {
    await response.body?.cancel().catch(() => undefined);
    return githubDeniedStatuses.includes(response.status)
      ? { minted: "Denied" }
      : { minted: "Unavailable" };
  }
  return githubInstallationTokensRead(own, response);
}

/** The token a minted answer carries, and an outage where no answer this side can read stands there. */
async function githubInstallationTokensRead(
  own: GithubInstallationTokensState,
  response: Response,
): Promise<ForgeTokenMinted> {
  try {
    const granted = githubAccessTokenSchema.parse(
      JSON.parse(
        await githubResponseTextOf(
          response,
          own.responseBytesMax,
          "github tokens",
        ),
      ),
    );
    const expiresAtMs = Date.parse(granted.expires_at);
    if (!Number.isSafeInteger(expiresAtMs)) return { minted: "Unavailable" };
    return {
      minted: "Token",
      token: asForgeInstallationToken(granted.token),
      expiresAtMs,
    };
  } catch {
    return { minted: "Unavailable" };
  }
}

/** The cached token still worth handing out, every expired entry dropped as it is passed. */
function githubInstallationTokensCached(
  own: GithubInstallationTokensState,
  key: string,
): GithubCachedToken | undefined {
  const usableUntilMs = own.currentTimeEpochMs() + own.tokenMarginMs;
  for (const [cachedKey, cached] of own.cached) {
    if (cached.expiresAtMs <= usableUntilMs) own.cached.delete(cachedKey);
  }
  return own.cached.get(key);
}

/** Holds one minted token, refusing to grow past the bound a deployment set. */
function githubInstallationTokensHold(
  own: GithubInstallationTokensState,
  key: string,
  held: GithubCachedToken,
): void {
  if (own.cached.size >= own.cachedTokensMax) {
    const oldest = own.cached.keys().next();
    if (!oldest.done) own.cached.delete(oldest.value);
  }
  own.cached.set(key, held);
}

function githubInstallationTokensState(
  options: GithubInstallationTokensOptions,
): GithubInstallationTokensState {
  if (options.appId.length === 0)
    throw new RangeError("github tokens: the app id is empty");
  if (options.privateKeyPath.length === 0)
    throw new RangeError("github tokens: the private key path is empty");
  return {
    requestFetch: options.fetch,
    appId: options.appId,
    privateKeyPath: options.privateKeyPath,
    apiUrl: githubInstallationTokensApiUrl(
      options.apiUrl ?? githubInstallationTokensDefaults.apiUrl,
    ),
    requestTimeoutMs: githubInstallationTokensBound(
      options.requestTimeoutMs ??
        githubInstallationTokensDefaults.requestTimeoutMs,
      "the request timeout",
    ),
    responseBytesMax: githubInstallationTokensBound(
      options.responseBytesMax ??
        githubInstallationTokensDefaults.responseBytesMax,
      "the response bound",
    ),
    privateKeyBytesMax: githubInstallationTokensBound(
      options.privateKeyBytesMax ??
        githubInstallationTokensDefaults.privateKeyBytesMax,
      "the private key bound",
    ),
    tokenMarginMs: githubInstallationTokensBound(
      options.tokenMarginMs ?? githubInstallationTokensDefaults.tokenMarginMs,
      "the token margin",
    ),
    cachedTokensMax: githubInstallationTokensBound(
      options.cachedTokensMax ??
        githubInstallationTokensDefaults.cachedTokensMax,
      "the tokens held",
    ),
    currentTimeEpochMs: options.currentTimeEpochMs ?? Date.now,
    cached: new Map(),
  };
}

/** The adapter over its options, refusing at construction what it could never serve. */
export function githubInstallationTokens(
  options: GithubInstallationTokensOptions,
): ForgeInstallationTokens {
  const own = githubInstallationTokensState(options);
  return {
    mint: async (request) => {
      if (request.repositories.length === 0)
        throw new RangeError("github tokens: a mint names no repository");
      const key = githubInstallationTokensCacheKey(request);
      const held = githubInstallationTokensCached(own, key);
      if (held !== undefined)
        return {
          minted: "Token",
          token: held.token,
          expiresAtMs: held.expiresAtMs,
        };
      const minted = await githubInstallationTokensSend(own, request);
      if (minted.minted === "Token")
        githubInstallationTokensHold(own, key, {
          token: minted.token,
          expiresAtMs: minted.expiresAtMs,
        });
      return minted;
    },
  };
}

/**
 * Requires the app's key to be readable and usable before this process answers
 * anything, so a deployment that mounted the wrong file refuses to start rather
 * than reporting an outage at every mint for as long as it runs.
 */
export function githubInstallationTokensPrecondition(
  options: GithubInstallationTokensOptions,
): RuntimePrecondition {
  const own = githubInstallationTokensState(options);
  return {
    name: "forge-app-key-usable",
    check: async (signal) => {
      signal.throwIfAborted();
      const usable = await githubInstallationTokensKey(own).then(
        () => true,
        () => false,
      );
      return runtimePreconditionAnswer(
        usable,
        "the forge app key this deployment names is not a readable RSA private key",
      );
    },
  };
}
