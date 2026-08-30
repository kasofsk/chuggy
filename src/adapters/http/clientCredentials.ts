/**
 * The access token an authenticated client presents, minted by the OAuth2
 * client-credentials grant and replaced before the issuer expires it.
 *
 * A TOKEN IS REPLACED AHEAD OF EXPIRY. The issuer signs short-lived access
 * tokens and the API verifies them offline, so a client that waits for the 401
 * spends a failed request on every replacement and reports the failure as the
 * API's. `refreshMarginMs` is how far ahead of the granted expiry a held token
 * stops being handed out; a grant shorter than that margin is held for half its
 * lifetime instead, because a hold of nothing is a mint per request.
 *
 * A REFUSAL IS THE OTHER WAY A TOKEN ENDS, and the margin cannot see it: a
 * rotated signing key or a clock that skewed further than the margin leaves a
 * held token already worthless. `invalidate` discards it so the next read
 * mints, and discards nothing when the token it names has already been
 * replaced. It starts no retry of its own — the refused request fails, and the
 * one after it carries a new token.
 *
 * ONE MINT AT A TIME. Callers arriving while a replacement is in flight join it
 * rather than each starting one, so the issuer sees a request per replacement
 * however many are waiting. A failed mint is not held: the next caller mints
 * again and carries the failure itself, because a token source that answers
 * with a stale token is a client that cannot tell a refusal from an outage.
 *
 * THE GRANT IS READ UNDER A BOUND, because the issuer is reached across the
 * same network as everything else and an endpoint that answers endlessly is
 * not distinguishable from one that is slow.
 *
 * NOTHING HERE REACHES A DIAGNOSTIC BUT A STATUS. The secret is in the request
 * and the token is in the response, and a mint failure is reported by a process
 * that logs.
 */

import { z } from "zod";

import { checkedBearerToken, type AccessTokenSource } from "./accessToken.ts";
import { boundedResponseBytes } from "./boundedResponse.ts";

const millisecondsPerSecond = 1_000;
const clientCredentialsGrantType = "client_credentials";
const clientCredentialsTokenType = "bearer";

/**
 * An issuer returns `scope` and may return more beside these three, and RFC
 * 6749 requires a client to ignore what it does not know.
 */
const clientCredentialsGrantSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export interface ClientCredentialsConfig {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: readonly string[];
  readonly scope: readonly string[];
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
  readonly responseReadsMax: number;
  readonly refreshMarginMs: number;
  readonly fetch?: typeof fetch;
  readonly currentTimeEpochMs?: () => number;
}

interface ClientCredentialsHeld {
  readonly token: string;
  readonly replaceAtEpochMs: number;
}

function clientCredentialsPositive(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(
      `client credentials ${what} must be a positive safe integer`,
    );
  return value;
}

function clientCredentialsChecked(
  config: ClientCredentialsConfig,
): ClientCredentialsConfig {
  const url = new URL(config.tokenUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new RangeError("client credentials token URL is not HTTP");
  if (url.username !== "" || url.password !== "")
    throw new RangeError("client credentials token URL carries credentials");
  if (config.clientId.length === 0 || config.clientSecret.length === 0)
    throw new RangeError("client credentials identity or secret is empty");
  clientCredentialsPositive(config.requestTimeoutMs, "request timeout");
  clientCredentialsPositive(config.responseBytesMax, "response byte bound");
  clientCredentialsPositive(config.responseReadsMax, "response read bound");
  clientCredentialsPositive(config.refreshMarginMs, "refresh margin");
  return config;
}

/** Basic authentication, percent-encoding each half so neither can contribute the colon that joins them. */
function clientCredentialsAuthorization(
  config: ClientCredentialsConfig,
): string {
  const encoded = [config.clientId, config.clientSecret]
    .map((part) => encodeURIComponent(part))
    .join(":");
  return `Basic ${Buffer.from(encoded, "utf8").toString("base64")}`;
}

/** How long a grant is handed out for: its lifetime less the margin, and half of it when the margin would leave none. */
function clientCredentialsHoldMs(
  lifetimeMs: number,
  refreshMarginMs: number,
): number {
  return lifetimeMs > refreshMarginMs
    ? lifetimeMs - refreshMarginMs
    : Math.floor(lifetimeMs / 2);
}

async function clientCredentialsMinted(
  config: ClientCredentialsConfig,
  transport: typeof fetch,
  atEpochMs: number,
): Promise<ClientCredentialsHeld> {
  const form = new URLSearchParams({ grant_type: clientCredentialsGrantType });
  if (config.audience.length > 0)
    form.set("audience", config.audience.join(" "));
  if (config.scope.length > 0) form.set("scope", config.scope.join(" "));
  const response = await transport(new URL(config.tokenUrl), {
    method: "POST",
    headers: {
      authorization: clientCredentialsAuthorization(config),
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(
      `client credentials grant returned ${String(response.status)}`,
    );
  }
  const bytes = await boundedResponseBytes(
    response,
    config.responseBytesMax,
    config.responseReadsMax,
  );
  const grant = clientCredentialsGrantSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  if (grant.token_type.toLowerCase() !== clientCredentialsTokenType)
    throw new Error("client credentials grant is not a bearer token");
  return {
    token: checkedBearerToken(grant.access_token),
    replaceAtEpochMs:
      atEpochMs +
      clientCredentialsHoldMs(
        grant.expires_in * millisecondsPerSecond,
        config.refreshMarginMs,
      ),
  };
}

/** Mints on demand and holds the grant until its margin, sharing one mint between the callers waiting on it. */
export function clientCredentialsTokenSource(
  input: ClientCredentialsConfig,
): AccessTokenSource {
  const config = clientCredentialsChecked(input);
  const transport = config.fetch ?? fetch;
  const currentTimeEpochMs = config.currentTimeEpochMs ?? Date.now;
  let held: ClientCredentialsHeld | undefined;
  let minting: Promise<ClientCredentialsHeld> | undefined;
  const mint = (): Promise<ClientCredentialsHeld> =>
    (minting ??= clientCredentialsMinted(
      config,
      transport,
      currentTimeEpochMs(),
    ).then(
      (granted) => {
        held = granted;
        minting = undefined;
        return granted;
      },
      (failure: unknown) => {
        minting = undefined;
        throw failure;
      },
    ));
  return {
    token: async (signal) => {
      signal.throwIfAborted();
      const current = held;
      if (
        current !== undefined &&
        currentTimeEpochMs() < current.replaceAtEpochMs
      )
        return current.token;
      const granted = await mint();
      signal.throwIfAborted();
      return granted.token;
    },
    invalidate: (refused) => {
      if (held?.token === refused) held = undefined;
    },
  };
}
