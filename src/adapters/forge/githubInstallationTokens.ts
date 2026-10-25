/**
 * The adapter behind `ForgeInstallationTokens` for GitHub: the request that
 * exchanges the app's own JWT for a token scoped to named repositories.
 *
 * THE APP'S CREDENTIAL AND THE REQUEST IT MAKES ARE `githubAppRequest.ts`'s.
 * What is here is the mint alone: which collection it posts to, how a named
 * permission set is spelled, and what a token is held under.
 *
 * PIPELINE DEFINITIONS ARE ASKED FOR ONLY WHERE THE REPOSITORY'S BINDING ALLOWS
 * THEM, AND THEN ONLY AS FAR AS THE INSTALLATION GRANTS THEM. A request whose
 * set names `pipelines` and whose binding allows them asks for them; any other
 * asks for none. An installation holds a permission its app requests only once
 * the installation's owner has accepted it, and the forge refuses a mint asking
 * for one the installation does not hold, so such a request reads the
 * installation as the app first and spells `workflows` only where it is
 * granted. The read answers as a mint does, and a request asking for no
 * pipelines makes none.
 *
 * A TOKEN IS HELD UNTIL ITS OWN EXPIRY, LESS A MARGIN, KEYED BY WHAT IT IS GOOD
 * FOR. Repeated mints for one key are one mint for as long as the held token
 * lasts; anything else is a different key, because a cache keyed more loosely
 * would hand a reader a credential that can push, hand a caller acting on one
 * repository a token good for every repository the installation holds, or hand
 * a binding that allows no pipeline definitions a token that can write them.
 * What an installation grants is not in the key, so a token held from before
 * its owner accepted `workflows` is handed out without it until it expires.
 * Nothing tracks a request in flight, so mints racing on one key each send and
 * each get a valid token, the last of them being the one held.
 *
 * A MINT ASKED FOR `unheld` IS NEITHER ANSWERED FROM WHAT IS HELD NOR HELD. It
 * is minted every time, and it leaves every held token as it found it. A
 * listing of what an installation grants asks for it, because a held token was
 * minted before whatever has been granted since and a listing must not turn on
 * whether the forge shows such a token the grant.
 *
 * NAMING NO REPOSITORY IS THE WHOLE INSTALLATION AND NAMING AN EMPTY LIST IS
 * NOTHING AT ALL. GitHub reads an absent `repositories` as every repository the
 * installation grants, which is what enumerating one needs; an empty list would
 * be sent as that same request by a caller that meant the opposite, so it is
 * refused here rather than widened silently.
 */

import { z } from "zod";

import {
  asForgeInstallationToken,
  forgeAppKeyOf,
  forgePermissionSets,
  type ForgeAppKey,
  type ForgeAppKeyVariables,
  type ForgeInstallationToken,
  type ForgeInstallationTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../interpreter/forgeInstallation.ts";
import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import {
  githubAppBound,
  githubAppDefaults,
  githubAppKey,
  githubAppRead,
  githubAppSend,
  githubAppState,
  type GithubAppAnswered,
  type GithubAppOptions,
  type GithubAppState,
} from "./githubAppRequest.ts";

/** Everything the adapter is composed with: the app's own options, and the cache's. */
export interface GithubInstallationTokensOptions extends GithubAppOptions {
  readonly tokenMarginMs?: number;
  readonly cachedTokensMax?: number;
}

/** The forge and the bounds a deployment gets when it names none. */
export const githubInstallationTokensDefaults = {
  ...githubAppDefaults,
  tokenMarginMs: 60_000,
  cachedTokensMax: 256,
} as const;

/** The variables one process reads its app key and its forge from. */
export type GithubInstallationTokensVariables = ForgeAppKeyVariables;

/** This forge's spelling of one app key, each bound it left absent taken from above. */
export function githubInstallationTokensOptions(
  key: ForgeAppKey,
): GithubInstallationTokensOptions {
  return {
    fetch,
    appId: key.appId,
    privateKeyPath: key.keyFile,
    apiUrl: key.apiUrl ?? githubInstallationTokensDefaults.apiUrl,
    requestTimeoutMs:
      key.requestTimeoutMs ?? githubInstallationTokensDefaults.requestTimeoutMs,
  };
}

/**
 * What a process mints with, or nothing at all where it holds no app key. Each
 * process holds an app key under names of its own — the API the portal App's,
 * the worker plane the worker App's — and the pair is read through
 * `forgeAppKeyOf`, so what an app id named without its key file means is
 * answered in a single place.
 */
export function githubInstallationTokensSettings(
  named: GithubInstallationTokensVariables,
  environment: Readonly<Record<string, string | undefined>>,
  positive: (name: string, fallback: number) => number,
): GithubInstallationTokensOptions | undefined {
  const key = forgeAppKeyOf(named, environment, (name) =>
    positive(name, githubInstallationTokensDefaults.requestTimeoutMs),
  );
  return key === undefined ? undefined : githubInstallationTokensOptions(key);
}

/** The status a mint is answered with, a forge that made no token answering something else. */
const githubMintedStatus = 201;

/** The status the read of an installation is answered with. */
const githubInstallationReadStatus = 200;

/** The fields of a minted token this tree reads, the rest of the answer being the forge's own account of it. */
const githubAccessTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1),
});

/** The one grant of an installation this tree reads, the rest of the answer being the forge's own account of it. */
const githubInstallationGrantSchema = z.object({
  permissions: z.object({ workflows: z.string().optional() }),
});

/** What the adapter holds across mints: the app's own state, and its cache. */
interface GithubInstallationTokensState {
  readonly app: GithubAppState;
  readonly tokenMarginMs: number;
  readonly cachedTokensMax: number;
  readonly cached: Map<string, GithubCachedToken>;
}

interface GithubCachedToken {
  readonly token: ForgeInstallationToken;
  readonly expiresAtMs: number;
}

/** A mint that made no token, which is also what a failed read of its installation answers. */
type GithubInstallationTokensRefused = Exclude<
  ForgeTokenMinted,
  { readonly minted: "Token" }
>;

/** What a body asks the forge for, or the refusal that stopped it before it was asked. */
type GithubInstallationTokensAsked =
  | {
      readonly asked: "Permissions";
      readonly permissions: Readonly<Record<string, string>>;
    }
  | {
      readonly asked: "Refused";
      readonly refused: GithubInstallationTokensRefused;
    };

/** A request the forge did not answer, as the mint reports it. */
function githubInstallationTokensRefusal(
  answered: Exclude<GithubAppAnswered, { readonly answered: "Answer" }>,
): GithubInstallationTokensRefused {
  return {
    minted: answered.answered,
    ...(answered.evidence === undefined ? {} : { evidence: answered.evidence }),
  };
}

/** Where the app addresses one installation, which its access-token collection sits under. */
function githubInstallationTokensPath(request: ForgeTokenRequest): string {
  return `/app/installations/${encodeURIComponent(request.installation.installationId)}`;
}

/** The access-token collection of one installation. */
function githubInstallationTokensUrl(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): URL {
  return new URL(
    `${githubInstallationTokensPath(request)}/access_tokens`,
    own.app.apiUrl,
  );
}

/** Whether the installation's owner has granted the app its pipeline definitions, read as the app. */
async function githubInstallationTokensPipelinesGranted(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): Promise<boolean | GithubInstallationTokensRefused> {
  const answered = await githubAppSend(own.app, {
    url: new URL(githubInstallationTokensPath(request), own.app.apiUrl),
    method: "GET",
    okStatus: githubInstallationReadStatus,
  });
  if (answered.answered !== "Answer")
    return githubInstallationTokensRefusal(answered);
  const read = await githubAppRead(
    own.app,
    answered.response,
    githubInstallationGrantSchema,
  );
  if (read === undefined)
    return { minted: "Unavailable", evidence: { mint: "Body" } };
  return read.permissions.workflows === "write";
}

/** The pipeline definitions a request asks for: what its set names, where its binding allows them. */
function githubInstallationTokensPipelinesAsked(
  request: ForgeTokenRequest,
): "write" | undefined {
  return request.pipelinesAllowed === true
    ? forgePermissionSets[request.permissions].pipelines
    : undefined;
}

/** The forge's own spelling of one named permission set, as far as the binding allows and the installation grants it. */
async function githubInstallationTokensPermissions(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): Promise<GithubInstallationTokensAsked> {
  const permissions = forgePermissionSets[request.permissions];
  const spelled = {
    contents: permissions.contents,
    ...(permissions.changeProposals === undefined
      ? {}
      : { pull_requests: permissions.changeProposals }),
    ...(permissions.administration === undefined
      ? {}
      : { administration: permissions.administration }),
  };
  const pipelines = githubInstallationTokensPipelinesAsked(request);
  if (pipelines === undefined)
    return { asked: "Permissions", permissions: spelled };
  const granted = await githubInstallationTokensPipelinesGranted(own, request);
  if (typeof granted !== "boolean")
    return { asked: "Refused", refused: granted };
  return {
    asked: "Permissions",
    permissions: granted ? { ...spelled, workflows: pipelines } : spelled,
  };
}

/** What a token is good for, which is what two mints have to agree on to be one. */
function githubInstallationTokensCacheKey(request: ForgeTokenRequest): string {
  return JSON.stringify([
    request.installation.installationId,
    request.repositories === undefined
      ? null
      : [...request.repositories].sort(),
    request.permissions,
    githubInstallationTokensPipelinesAsked(request) ?? null,
  ]);
}

/** The body one mint sends, the whole installation being what an absent scope means. */
function githubInstallationTokensBody(
  request: ForgeTokenRequest,
  permissions: Readonly<Record<string, string>>,
): unknown {
  return {
    ...(request.repositories === undefined
      ? {}
      : { repositories: [...request.repositories] }),
    permissions,
  };
}

/** Makes the bounded forge request this mint is, after the installation read its set may need. */
async function githubInstallationTokensSend(
  own: GithubInstallationTokensState,
  request: ForgeTokenRequest,
): Promise<ForgeTokenMinted> {
  const asked = await githubInstallationTokensPermissions(own, request);
  if (asked.asked === "Refused") return asked.refused;
  const answered = await githubAppSend(own.app, {
    url: githubInstallationTokensUrl(own, request),
    method: "POST",
    okStatus: githubMintedStatus,
    body: githubInstallationTokensBody(request, asked.permissions),
  });
  if (answered.answered !== "Answer")
    return githubInstallationTokensRefusal(answered);
  const granted = await githubAppRead(
    own.app,
    answered.response,
    githubAccessTokenSchema,
  );
  if (granted === undefined)
    return { minted: "Unavailable", evidence: { mint: "Body" } };
  const expiresAtMs = Date.parse(granted.expires_at);
  if (!Number.isSafeInteger(expiresAtMs))
    return { minted: "Unavailable", evidence: { mint: "Expiry" } };
  return {
    minted: "Token",
    token: asForgeInstallationToken(granted.token),
    expiresAtMs,
  };
}

/** The cached token still worth handing out, every expired entry dropped as it is passed. */
function githubInstallationTokensCached(
  own: GithubInstallationTokensState,
  key: string,
): GithubCachedToken | undefined {
  const usableUntilMs = own.app.currentTimeEpochMs() + own.tokenMarginMs;
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
  return {
    app: githubAppState(options),
    tokenMarginMs: githubAppBound(
      options.tokenMarginMs ?? githubInstallationTokensDefaults.tokenMarginMs,
      "the token margin",
    ),
    cachedTokensMax: githubAppBound(
      options.cachedTokensMax ??
        githubInstallationTokensDefaults.cachedTokensMax,
      "the tokens held",
    ),
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
      if (
        request.repositories !== undefined &&
        request.repositories.length === 0
      )
        throw new RangeError("github tokens: a mint names no repository");
      if (request.unheld === true)
        return githubInstallationTokensSend(own, request);
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
      const usable = await githubAppKey(own.app).then(
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
