/**
 * A repository credential asked of the native API rather than minted here, for
 * the processes that will hold no forge key.
 *
 * IT IS BUILT AND COMPOSED BY NOBODY YET. The ticket service, the importer and
 * the finalizer keep reading their mounted token files until the fabric stops
 * mounting them; this is the source each of them takes then, and building it
 * now is what makes that change a composition rather than a slice.
 *
 * A REFUSAL IS SETTLED AND EVERYTHING ELSE IS A WAIT. The route answers 404 for
 * a project this client may not address and for a repository it does not bind,
 * and both are `Denied`; every other status, a body this side cannot read and
 * every transport fault are `Unavailable`, because none of them established
 * that the credential will not be answered. A 401 is reported to the token
 * source as spent before the wait, so the next attempt presents a fresh bearer.
 *
 * A TOKEN IS HELD UNTIL ITS OWN EXPIRY, LESS A MARGIN, AND NOT LONGER. The
 * route answers when the forge stops honouring it, so nothing here estimates a
 * lifetime, and a repository not held is one request rather than a refusal.
 */

import { z } from "zod";

import {
  asRepositoryCredential,
  type CredentialResolved,
  type RepositoryBinding,
  type RepositoryCredentialPort,
} from "../../interpreter/finalizer.ts";
import type { ForgePermissionSet } from "../../interpreter/forgeInstallation.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { nativeHttpMediaType } from "../../contract/http.ts";
import { presentedAccessToken, type AccessTokenSource } from "./accessToken.ts";
import { boundedResponseBytes } from "./boundedResponse.ts";
import { checkedPositiveBound } from "./bounds.ts";

/** Everything this source is composed with, the permission set among them because a caller does not choose one. */
export interface RemoteRepositoryCredentialsConfig {
  readonly baseUrl: string;
  readonly accessToken: AccessTokenSource;
  readonly permissions: ForgePermissionSet;
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
  readonly responseReadsMax: number;
  readonly tokenMarginMs: number;
  readonly cachedTokensMax: number;
  readonly currentTimeEpochMs?: () => number;
}

/** The two fields the route answers with, which are the credential and when it stops working. */
const remoteCredentialSchema = z.object({
  token: z.string().min(1),
  expiresAtMs: z.number().int().safe().positive(),
});

/** The status that is the API refusing this caller or this repository rather than failing. */
const remoteCredentialDeniedStatus = 404;

/** The status that says the bearer presented was the problem. */
const remoteCredentialUnauthorizedStatus = 401;

interface RemoteCredentialHeld {
  readonly token: string;
  readonly expiresAtMs: number;
}

function remoteCredentialUrl(baseUrl: string, partition: Partition): URL {
  return new URL(
    [
      "api/v1/tenants",
      encodeURIComponent(partition.tenant),
      "projects",
      encodeURIComponent(partition.project),
      "forge-credentials",
    ].join("/"),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
}

/** Asks the route once, every way of not being answered being an outage rather than a denial. */
async function remoteCredentialAsked(
  config: RemoteRepositoryCredentialsConfig,
  transport: typeof fetch,
  repository: RepositoryBinding,
  bounds: {
    readonly timeoutMs: number;
    readonly bytesMax: number;
    readonly readsMax: number;
  },
): Promise<RemoteCredentialHeld | "Denied" | "Unavailable"> {
  const signal = AbortSignal.timeout(bounds.timeoutMs);
  let token: string;
  let response: Response;
  try {
    token = await presentedAccessToken(config.accessToken, signal);
    response = await transport(
      remoteCredentialUrl(config.baseUrl, repository.partition),
      {
        method: "POST",
        headers: {
          accept: nativeHttpMediaType,
          authorization: `Bearer ${token}`,
          "content-type": nativeHttpMediaType,
        },
        body: JSON.stringify({
          repository: repository.repository,
          permissions: config.permissions,
        }),
        redirect: "error",
        signal,
      },
    );
  } catch {
    return "Unavailable";
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === remoteCredentialUnauthorizedStatus)
      config.accessToken.invalidate(token);
    return response.status === remoteCredentialDeniedStatus
      ? "Denied"
      : "Unavailable";
  }
  try {
    const granted = remoteCredentialSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedResponseBytes(
            response,
            bounds.bytesMax,
            bounds.readsMax,
          ),
        ),
      ),
    );
    return { token: granted.token, expiresAtMs: granted.expiresAtMs };
  } catch {
    return "Unavailable";
  }
}

/** The credential source over the native API's minting route, holding each token to its own expiry. */
export function remoteRepositoryCredentials(
  config: RemoteRepositoryCredentialsConfig,
  transport: typeof fetch = fetch,
): RepositoryCredentialPort {
  const bounds = {
    timeoutMs: checkedPositiveBound(
      config.requestTimeoutMs,
      "remote credential request timeout",
    ),
    bytesMax: checkedPositiveBound(
      config.responseBytesMax,
      "remote credential response byte bound",
    ),
    readsMax: checkedPositiveBound(
      config.responseReadsMax,
      "remote credential response read bound",
    ),
  };
  const tokenMarginMs = checkedPositiveBound(
    config.tokenMarginMs,
    "remote credential token margin",
  );
  const cachedTokensMax = checkedPositiveBound(
    config.cachedTokensMax,
    "remote credential tokens held",
  );
  const currentTimeEpochMs = config.currentTimeEpochMs ?? Date.now;
  const held = new Map<string, RemoteCredentialHeld>();
  return {
    credential: async (repository): Promise<CredentialResolved> => {
      const usableUntilMs = currentTimeEpochMs() + tokenMarginMs;
      for (const [key, token] of held) {
        if (token.expiresAtMs <= usableUntilMs) held.delete(key);
      }
      const key = JSON.stringify([
        repository.partition.tenant,
        repository.partition.project,
        repository.repository,
      ]);
      const standing = held.get(key);
      if (standing !== undefined)
        return {
          resolved: "Credential",
          credential: asRepositoryCredential(standing.token),
        };
      const asked = await remoteCredentialAsked(
        config,
        transport,
        repository,
        bounds,
      );
      if (asked === "Denied") return { resolved: "Denied" };
      if (asked === "Unavailable") return { resolved: "Unavailable" };
      if (held.size >= cachedTokensMax) {
        const oldest = held.keys().next();
        if (!oldest.done) held.delete(oldest.value);
      }
      held.set(key, asked);
      return {
        resolved: "Credential",
        credential: asRepositoryCredential(asked.token),
      };
    },
  };
}
