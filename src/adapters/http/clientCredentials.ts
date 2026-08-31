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
 * rotated signing key, or a clock that stepped backwards so that an expired
 * token still reads as fresh, leaves a held token already worthless.
 * `invalidate` discards it, and discards nothing when the token it names has
 * already been replaced. It starts no retry of its own: the refused request
 * fails, and the read after it mints unless the cooldown below says otherwise.
 *
 * `mintCooldownMs` IS THE BOUND ON ALL OF THAT. It is measured from the start
 * of the last attempt, so it bounds grant requests to one per cooldown whether
 * that attempt succeeded or failed and whether or not a token is held: neither
 * a refusal that never stops nor a token endpoint that never answers can turn
 * a loop of reads into a loop of grants. A caller arriving while an attempt is
 * still in flight joins it rather than being turned away, and one arriving
 * inside the cooldown with a token still held is given it, because past a
 * refresh margin is not past an expiry.
 *
 * A COOLDOWN NEVER OUTLIVES THE GRANT THAT STARTED IT. What a configured
 * cooldown can be checked against is the refresh margin, and that check is
 * made — a cooldown as long as the margin could consume the whole window a
 * replacement has to be found in, and a bound that can be configured never to
 * fire is a control that reports success and enforces nothing. But the margin
 * is only the window when the issuer grants a lifetime longer than it; below
 * that a grant is held for half its life and the window is the other half,
 * which no check made before any grant can see. So a successful attempt
 * shortens its own cooldown to the life left in what it granted, and the two
 * together say the whole thing: while a token is held there is no refusal
 * before its expiry, and at its expiry a replacement can always be attempted.
 * A failed attempt shortens nothing, because it granted no lifetime to
 * measure — its cooldown is the configured one, which is what bounds a loop of
 * failures.
 *
 * TWO CLOCKS, BECAUSE THEY MEASURE DIFFERENT THINGS. An expiry is the issuer's
 * statement about wall-clock time and is held against one. A cooldown is a
 * duration this process measures for itself, so it is held against a monotonic
 * source, where no correction, snapshot resume or host sync can make elapsed
 * time negative and strand a client that is waiting to recover.
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
import { checkedPositiveBound } from "./bounds.ts";

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
  readonly mintCooldownMs: number;
  readonly fetch?: typeof fetch;
  readonly currentTimeEpochMs?: () => number;
  readonly monotonicMs?: () => number;
}

interface ClientCredentialsHeld {
  readonly token: string;
  readonly replaceAtEpochMs: number;
  readonly expiresAtEpochMs: number;
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
  checkedPositiveBound(
    config.requestTimeoutMs,
    "client credentials request timeout",
  );
  checkedPositiveBound(
    config.responseBytesMax,
    "client credentials response byte bound",
  );
  checkedPositiveBound(
    config.responseReadsMax,
    "client credentials response read bound",
  );
  checkedPositiveBound(
    config.refreshMarginMs,
    "client credentials refresh margin",
  );
  checkedPositiveBound(
    config.mintCooldownMs,
    "client credentials mint cooldown",
  );
  if (config.mintCooldownMs >= config.refreshMarginMs)
    throw new RangeError(
      "client credentials mint cooldown must be shorter than its refresh margin",
    );
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
  const lifetimeMs = grant.expires_in * millisecondsPerSecond;
  return {
    token: checkedBearerToken(grant.access_token),
    replaceAtEpochMs:
      atEpochMs + clientCredentialsHoldMs(lifetimeMs, config.refreshMarginMs),
    expiresAtEpochMs: atEpochMs + lifetimeMs,
  };
}

/**
 * The cooldown's clock when a caller supplies none, which is every deployment.
 * It is process-relative and cannot go backwards, so no correction to the wall
 * clock can make elapsed time negative and hold a source in a cooldown it has
 * already served.
 */
export function clientCredentialsMonotonicMs(): number {
  return performance.now();
}

/** Mints on demand and holds the grant until its margin, sharing one mint between the callers waiting on it. */
export function clientCredentialsTokenSource(
  input: ClientCredentialsConfig,
): AccessTokenSource {
  const config = clientCredentialsChecked(input);
  const transport = config.fetch ?? fetch;
  const currentTimeEpochMs = config.currentTimeEpochMs ?? Date.now;
  const monotonicMs = config.monotonicMs ?? clientCredentialsMonotonicMs;
  let held: ClientCredentialsHeld | undefined;
  let minting: Promise<ClientCredentialsHeld> | undefined;
  let attemptedAtMonotonicMs: number | undefined;
  let attemptCooldownMs = config.mintCooldownMs;
  const cooling = (): boolean =>
    attemptedAtMonotonicMs !== undefined &&
    monotonicMs() - attemptedAtMonotonicMs < attemptCooldownMs;
  const mint = (): Promise<ClientCredentialsHeld> => {
    const inFlight = minting;
    if (inFlight !== undefined) return inFlight;
    attemptedAtMonotonicMs = monotonicMs();
    attemptCooldownMs = config.mintCooldownMs;
    return (minting = clientCredentialsMinted(
      config,
      transport,
      currentTimeEpochMs(),
    ).then(
      (granted) => {
        held = granted;
        attemptCooldownMs = Math.min(
          config.mintCooldownMs,
          Math.max(1, granted.expiresAtEpochMs - currentTimeEpochMs()),
        );
        minting = undefined;
        return granted;
      },
      (failure: unknown) => {
        minting = undefined;
        throw failure;
      },
    ));
  };
  return {
    token: async (signal) => {
      signal.throwIfAborted();
      const current = held;
      if (
        current !== undefined &&
        currentTimeEpochMs() < current.replaceAtEpochMs
      )
        return current.token;
      if (minting === undefined && cooling()) {
        if (
          current !== undefined &&
          currentTimeEpochMs() < current.expiresAtEpochMs
        )
          return current.token;
        throw new Error("client credentials grant is within its cooldown");
      }
      const granted = await mint();
      signal.throwIfAborted();
      return granted.token;
    },
    invalidate: (refused) => {
      if (held?.token === refused) held = undefined;
    },
  };
}
