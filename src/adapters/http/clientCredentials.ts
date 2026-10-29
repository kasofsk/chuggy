/**
 * The access token an authenticated client presents, minted by the OAuth2
 * client-credentials grant and replaced before the issuer expires it. This and
 * `src/adapters/http/poolTokens.ts` are chuggy-common's `poolTokens.mjs` in
 * TypeScript, and a change to one is a change to both.
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
 * `mintCooldownMs` IS THE BOUND ON ALL OF THAT, AND IT IS THE OPERATOR'S
 * NUMBER RATHER THAN THE ISSUER'S. It is measured from the start of the last
 * attempt, so it bounds grant requests to one per cooldown whether that
 * attempt succeeded or failed and whether or not a token is held: neither a
 * refusal that never stops nor a token endpoint that never answers can turn a
 * loop of reads into a loop of grants. A caller arriving while an attempt is
 * still in flight joins it rather than being turned away, and one arriving
 * inside the cooldown with a token still held is given it, because past a
 * refresh margin is not past an expiry.
 *
 * A GRANT THAT CANNOT OUTLIVE THAT COOLDOWN IS REFUSED AS UNUSABLE, which is
 * what keeps the two promises from pulling against each other. Holding such a
 * token would mean either refusing reads before it expired or letting the
 * issuer shorten the bound the operator set, and the second is worse than it
 * sounds: the shortening would be largest exactly when the issuer is slowest
 * to answer, which points a mint per read at an issuer already struggling. A
 * grant is measured against the cooldown the way a lifetime of nothing is
 * measured against zero, and the refusal names both numbers so an operator can
 * see which to move.
 *
 * THE COOLDOWN IS ALSO REFUSED IF IT IS NOT SHORTER THAN THE REFRESH MARGIN,
 * which is a different guarantee and is made where a process starts rather
 * than when a grant arrives. The margin is how long a held token goes on
 * working after a replacement is first sought, so a cooldown shorter than it
 * is what leaves room for a failed refresh to be tried again before the token
 * it would have replaced expires.
 *
 * TWO CLOCKS, BECAUSE THEY MEASURE DIFFERENT THINGS. An expiry is the issuer's
 * statement about wall-clock time and is held against one. A cooldown is a
 * duration this process measures for itself, its start and its length both, so
 * it is held against a monotonic source, where no correction, snapshot resume
 * or host sync can make elapsed time negative and strand a client that is
 * waiting to recover.
 *
 * ONE MINT AT A TIME. Callers arriving while a replacement is in flight join it
 * rather than each starting one, so the issuer sees a request per replacement
 * however many are waiting. A failed mint is not held: the next caller mints
 * again and carries the failure itself, because a token source that answers
 * with a stale token is a client that cannot tell a refusal from an outage.
 *
 * THE GRANT IS READ UNDER A BOUND, because the issuer is reached across the
 * same network as everything else and an endpoint that answers endlessly is
 * not distinguishable from one that is slow. So is a refusal.
 *
 * A GRANT IS REFUSED ONLY BY AN RFC 6749 §5.2 REFUSAL: a 400 or a 401 whose
 * body is a JSON object naming one of that section's codes. Each is the
 * issuer's word on this client's credential, its registration or its request,
 * which presenting the credential again will not change, and is raised as
 * `ClientCredentialsRefused`. Any other failed grant is an ordinary error,
 * because a proxy in front of an issuer it cannot reach answers statuses of
 * its own.
 *
 * A REFUSAL AN ISSUER ALSO GIVES A LOOKUP IT COULD NOT MAKE IS CONFIRMED.
 * Hydra, through fosite, answers every failed read of its client store
 * `invalid_client`, as it answers a client it does not have, until its
 * readiness probe takes it out of rotation. So that refusal is an ordinary
 * error, saying it is being confirmed, until every grant across
 * `refusalConfirmMs` has been refused the same way; a grant, any other answer
 * or a different status starts the interval again. The interval is the
 * caller's, since how long an issuer stays ready without its database is a
 * fact of its deployment.
 *
 * NOTHING HERE REACHES A DIAGNOSTIC BUT A STATUS AND A REFUSAL'S CODE. The
 * secret is in the request and the token is in the response, and a mint
 * failure is reported by a process that logs.
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

/** The codes RFC 6749 §5.2 refuses a grant with, and the only ones read as a refusal. */
const clientCredentialsRefusalCodes = [
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
] as const;

type ClientCredentialsRefusalCode =
  (typeof clientCredentialsRefusalCodes)[number];

/** The statuses RFC 6749 §5.2 refuses a grant with: 401 for a client that failed authentication, 400 for the rest. */
const clientCredentialsRefusalStatuses: ReadonlySet<number> = new Set([
  400, 401,
]);

/**
 * The codes an issuer also refuses a client it could not look up with. Every
 * other code fosite decides against the request or the registration that
 * lookup returned.
 */
const clientCredentialsLookupCodes: ReadonlySet<ClientCredentialsRefusalCode> =
  new Set(["invalid_client"]);

/** A refusal may carry more than its code, and a client ignores the rest. */
const clientCredentialsRefusalSchema = z.object({
  error: z.enum(clientCredentialsRefusalCodes),
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
  readonly refusalConfirmMs: number;
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
  checkedPositiveBound(
    config.refusalConfirmMs,
    "client credentials refusal confirmation",
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

/**
 * The issuer's own refusal of this client, which is not the same news as an
 * issuer that could not be reached: a caller told its credential is wrong
 * learns nothing by presenting it again, and one told nothing at all does.
 */
export class ClientCredentialsRefused extends Error {
  readonly status: number;
  readonly code: ClientCredentialsRefusalCode;
  constructor(status: number, code: ClientCredentialsRefusalCode) {
    super(`client credentials grant returned ${String(status)} ${code}`);
    this.name = "ClientCredentialsRefused";
    this.status = status;
    this.code = code;
  }
}

interface ClientCredentialsRefusals {
  granted(): void;
  failed(failure: unknown, atMonotonicMs: number): unknown;
}

interface ClientCredentialsRefusalFirst {
  readonly status: number;
  readonly code: ClientCredentialsRefusalCode;
  readonly atMonotonicMs: number;
}

/** What a failed mint raises, a refusal an issuer also gives a lookup it could not make held as an ordinary error until it has lasted `confirmMs`, measured from the start of the first mint refused that way. */
function clientCredentialsRefusals(
  confirmMs: number,
): ClientCredentialsRefusals {
  let first: ClientCredentialsRefusalFirst | undefined;
  const seconds = (milliseconds: number): string =>
    `${String(Math.floor(milliseconds / millisecondsPerSecond))}s`;
  return {
    granted: () => {
      first = undefined;
    },
    failed: (failure, atMonotonicMs) => {
      if (
        !(failure instanceof ClientCredentialsRefused) ||
        !clientCredentialsLookupCodes.has(failure.code)
      ) {
        first = undefined;
        return failure;
      }
      if (first?.status !== failure.status || first.code !== failure.code)
        first = { status: failure.status, code: failure.code, atMonotonicMs };
      const heldMs = atMonotonicMs - first.atMonotonicMs;
      return heldMs >= confirmMs
        ? failure
        : new Error(
            `${failure.message}, a refusal being confirmed: ${seconds(heldMs)} of ${seconds(confirmMs)}`,
          );
    },
  };
}

/** An answer's body as JSON, read under the configured bounds. */
async function clientCredentialsAnswer(
  config: ClientCredentialsConfig,
  response: Response,
): Promise<unknown> {
  const bytes = await boundedResponseBytes(
    response,
    config.responseBytesMax,
    config.responseReadsMax,
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** The code a failed grant was refused with, or nothing where the answer is no refusal. */
async function clientCredentialsRefusalCode(
  config: ClientCredentialsConfig,
  response: Response,
): Promise<ClientCredentialsRefusalCode | undefined> {
  if (!clientCredentialsRefusalStatuses.has(response.status)) {
    await response.body?.cancel();
    return undefined;
  }
  try {
    const refusal = clientCredentialsRefusalSchema.safeParse(
      await clientCredentialsAnswer(config, response),
    );
    return refusal.success ? refusal.data.error : undefined;
  } catch {
    return undefined;
  }
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
    const code = await clientCredentialsRefusalCode(config, response);
    throw code === undefined
      ? new Error(
          `client credentials grant returned ${String(response.status)}`,
        )
      : new ClientCredentialsRefused(response.status, code);
  }
  const grant = clientCredentialsGrantSchema.parse(
    await clientCredentialsAnswer(config, response),
  );
  if (grant.token_type.toLowerCase() !== clientCredentialsTokenType)
    throw new Error("client credentials grant is not a bearer token");
  const lifetimeMs = grant.expires_in * millisecondsPerSecond;
  if (lifetimeMs <= config.mintCooldownMs)
    throw new RangeError(
      `client credentials grant lives ${String(lifetimeMs)}ms, which this client cannot operate on while keeping a ${String(config.mintCooldownMs)}ms cooldown between grants`,
    );
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

/** Mints on demand and holds the grant until its margin, sharing one mint between the callers waiting on it. A refusal not yet confirmed is raised as an ordinary error. */
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
  const refusals = clientCredentialsRefusals(config.refusalConfirmMs);
  const cooling = (): boolean =>
    attemptedAtMonotonicMs !== undefined &&
    monotonicMs() - attemptedAtMonotonicMs < config.mintCooldownMs;
  const mint = (): Promise<ClientCredentialsHeld> => {
    const inFlight = minting;
    if (inFlight !== undefined) return inFlight;
    const attemptedAt = monotonicMs();
    attemptedAtMonotonicMs = attemptedAt;
    return (minting = clientCredentialsMinted(
      config,
      transport,
      currentTimeEpochMs(),
    ).then(
      (granted) => {
        held = granted;
        minting = undefined;
        refusals.granted();
        return granted;
      },
      (failure: unknown) => {
        minting = undefined;
        throw refusals.failed(failure, attemptedAt);
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
