/**
 * The signed-in session, held for the life of the tab and renewed before it
 * lapses.
 *
 * Everything the flow needs from a browser arrives as a port, so the whole of
 * it — the exchange, the renewal, the budget and the sign-out — is exercised
 * without one. The access token stays in this closure; only the refresh token
 * is handed to the store, which is what lets a reload keep the session without
 * ever writing an access token down.
 */

import {
  authorizeUrl,
  discoveryUrl,
  parseAuthorizationCallback,
  parseDiscovery,
  parseIssuedTokens,
  tokenExchangeRequest,
  tokenRefreshRequest,
  tokenRevocationRequest,
} from "./authorization.ts";
import type { AuthorizationEndpoints, FormRequest } from "./authorization.ts";
import {
  consoleConfigurationPath,
  parseConsoleConfiguration,
} from "./configuration.ts";
import type { ConsoleConfiguration } from "./configuration.ts";
import {
  pkceChallengeFromVerifier,
  pkceVerifierBytesCount,
  pkceVerifierFromBytes,
} from "./pkce.ts";
import type { PkceDigestPort } from "./pkce.ts";
import { base64urlFromBytes } from "./base64url.ts";
import {
  sessionAfterRefreshFailure,
  sessionCanRefresh,
  sessionFromRefreshToken,
  sessionFromTokens,
  sessionRefreshDueAtMs,
  sessionSignedOut,
  sessionUsableAccessToken,
} from "./session.ts";
import type { SessionState } from "./session.ts";

export const sessionRefreshTokenKey = "chuggy.refreshToken";
export const sessionTransactionKey = "chuggy.authorization";
export const sessionLoadRetryDelayMs = 1_000;

export interface KeyValuePort {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

/** How a request failed before there was a body to read. */
export type FetchJsonFault =
  | { readonly fault: "Unanswered" }
  | { readonly fault: "Status"; readonly status: number };

/** What `fetchJson` rejects with when it has no body to parse, so a request
 * that got no answer is told from one that answered with something unusable. */
export class FetchJsonError extends Error {
  readonly fault: FetchJsonFault;

  constructor(fault: FetchJsonFault, message: string) {
    super(message);
    this.name = "FetchJsonError";
    this.fault = fault;
  }
}

export interface SessionHolderPorts {
  readonly nowMs: () => number;
  readonly sleepMs: (ms: number) => Promise<void>;
  readonly fetchJson: (request: FormRequest | string) => Promise<unknown>;
  readonly persistent: KeyValuePort;
  readonly transient: KeyValuePort;
  readonly digest: PkceDigestPort;
  readonly drawBytes: (count: number) => Uint8Array;
  readonly redirect: (url: string) => void;
}

export type SessionPhase =
  "Loading" | "Unconfigured" | "Unreachable" | "SignedOut" | "SignedIn";

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly reason: string | undefined;
  readonly configuration: ConsoleConfiguration | undefined;
}

export type SessionCallback =
  | {
      readonly result: "SignedIn";
      /** Where the sign-in was started from, where it was started from a page
       * that asked to be returned to. */
      readonly returnPath: string | undefined;
    }
  | { readonly result: "Denied"; readonly reason: string }
  | { readonly result: "None" };

/** Where a completed callback leaves the tab: the page the sign-in was started
 * from, and the root where it named none or was refused. */
export function sessionCallbackPath(callback: SessionCallback): string {
  return callback.result === "SignedIn" ? (callback.returnPath ?? "/") : "/";
}

/** The address a callback is read from: the path it arrived at and its query. */
export interface SessionLocation {
  readonly pathname: string;
  readonly search: string;
}

export interface SessionHolder {
  readonly load: () => Promise<void>;
  readonly completeCallback: (
    location: SessionLocation,
  ) => Promise<SessionCallback>;
  readonly signIn: (returnPath?: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly bearer: () => Promise<string | undefined>;
  readonly refresh: () => Promise<boolean>;
  readonly refuse: (reason: string) => void;
  readonly refreshDueAtMs: () => number | undefined;
  readonly generation: () => number;
  readonly snapshot: () => SessionSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

interface SessionInner {
  readonly ports: SessionHolderPorts;
  readonly listeners: Set<() => void>;
  phase: SessionPhase;
  reason: string | undefined;
  configuration: ConsoleConfiguration | undefined;
  endpoints: AuthorizationEndpoints | undefined;
  session: SessionState;
  generation: number;
  snapshot: SessionSnapshot;
  renewal: Promise<boolean> | undefined;
}

function sessionReason(failure: unknown): string {
  return failure instanceof Error ? failure.message : "the request failed";
}

/**
 * The snapshot is rebuilt here and nowhere else, so a subscriber comparing it
 * by identity sees a new one exactly when something it draws has changed.
 */
function sessionAnnounce(inner: SessionInner): void {
  inner.snapshot = {
    phase: inner.phase,
    reason: inner.reason,
    configuration: inner.configuration,
  };
  for (const listener of inner.listeners) listener();
}

/** Phase follows the two facts that decide it, and nothing else changes it. */
function sessionSettle(inner: SessionInner): void {
  if (inner.configuration === undefined || inner.endpoints === undefined)
    return;
  inner.phase = inner.session.state === "Held" ? "SignedIn" : "SignedOut";
  sessionAnnounce(inner);
}

type SessionLoaded =
  | {
      readonly phase: "Loaded";
      readonly configuration: ConsoleConfiguration;
      readonly endpoints: AuthorizationEndpoints;
    }
  | {
      readonly phase: "Unconfigured" | "Unreachable";
      readonly reason: string;
    };

/** What a gateway answers for a server it could not reach or that is briefly
 * down, which is a blip like a request with no answer, not a deployment fault. */
const sessionLoadTransientStatuses: ReadonlySet<number> = new Set([
  502, 503, 504,
]);

/** The reason names where it was asked, because the configuration and the
 * issuer are different hosts. */
function sessionLoadFailure(source: string, failure: unknown): SessionLoaded {
  if (!(failure instanceof FetchJsonError))
    return {
      phase: "Unconfigured",
      reason: `${source} answered nothing usable`,
    };
  switch (failure.fault.fault) {
    case "Unanswered":
      return { phase: "Unreachable", reason: `No answer from ${source}` };
    case "Status":
      return {
        phase: sessionLoadTransientStatuses.has(failure.fault.status)
          ? "Unreachable"
          : "Unconfigured",
        reason: `${source} answered ${String(failure.fault.status)}`,
      };
  }
}

async function sessionLoadOnce(
  ports: SessionHolderPorts,
): Promise<SessionLoaded> {
  let configuration: ConsoleConfiguration;
  try {
    configuration = parseConsoleConfiguration(
      await ports.fetchJson(consoleConfigurationPath),
    );
  } catch (failure: unknown) {
    return sessionLoadFailure(consoleConfigurationPath, failure);
  }
  try {
    const endpoints = parseDiscovery(
      configuration,
      await ports.fetchJson(discoveryUrl(configuration)),
    );
    return { phase: "Loaded", configuration, endpoints };
  } catch (failure: unknown) {
    return sessionLoadFailure(new URL(configuration.issuer).host, failure);
  }
}

/** A load that got no answer is asked once more after a pause before it is
 * drawn, and again only when the reader asks. */
async function sessionLoad(inner: SessionInner): Promise<void> {
  if (inner.phase !== "Loading") {
    inner.phase = "Loading";
    inner.reason = undefined;
    sessionAnnounce(inner);
  }
  let loaded = await sessionLoadOnce(inner.ports);
  if (loaded.phase === "Unreachable") {
    await inner.ports.sleepMs(sessionLoadRetryDelayMs);
    loaded = await sessionLoadOnce(inner.ports);
  }
  if (loaded.phase !== "Loaded") {
    inner.phase = loaded.phase;
    inner.reason = loaded.reason;
    sessionAnnounce(inner);
    return;
  }
  inner.configuration = loaded.configuration;
  inner.endpoints = loaded.endpoints;
  const stored = inner.ports.persistent.read(sessionRefreshTokenKey);
  if (stored !== null) inner.session = sessionFromRefreshToken(stored);
  sessionSettle(inner);
}

function sessionAdopt(inner: SessionInner, issued: unknown): void {
  inner.generation += 1;
  const previous =
    inner.session.state === "Held"
      ? inner.session.held.refreshToken
      : undefined;
  inner.session = sessionFromTokens(
    inner.ports.nowMs(),
    parseIssuedTokens(issued),
    previous,
  );
  const kept =
    inner.session.state === "Held"
      ? inner.session.held.refreshToken
      : undefined;
  if (kept === undefined) inner.ports.persistent.remove(sessionRefreshTokenKey);
  else inner.ports.persistent.write(sessionRefreshTokenKey, kept);
  sessionSettle(inner);
}

function sessionForget(inner: SessionInner, reason: string | undefined): void {
  inner.generation += 1;
  inner.session = sessionSignedOut;
  inner.reason = reason;
  inner.ports.persistent.remove(sessionRefreshTokenKey);
  sessionSettle(inner);
}

/**
 * One renewal at a time, shared by everyone who asked while it was in flight,
 * and cleared when it settles so the next caller past the renewal point starts
 * a new one.
 *
 * An issuer that rotates refresh tokens invalidates the whole chain when a
 * spent one is presented again, so a second caller renewing against the token
 * the first is already spending would end the session rather than extend it.
 */
function sessionRefresh(inner: SessionInner): Promise<boolean> {
  const inflight = inner.renewal;
  if (inflight !== undefined) return inflight;
  const started = sessionRenew(inner).finally(() => {
    inner.renewal = undefined;
  });
  inner.renewal = started;
  return started;
}

async function sessionRenew(inner: SessionInner): Promise<boolean> {
  const { configuration, endpoints, session } = inner;
  if (session.state !== "Held" || configuration === undefined) return false;
  if (endpoints === undefined) return false;
  if (!sessionCanRefresh(session.held)) {
    sessionForget(inner, "this session could not be renewed");
    return false;
  }
  try {
    sessionAdopt(
      inner,
      await inner.ports.fetchJson(
        tokenRefreshRequest(
          configuration,
          endpoints,
          session.held.refreshToken ?? "",
        ),
      ),
    );
    return true;
  } catch (failure: unknown) {
    const spent = sessionAfterRefreshFailure(session.held);
    if (spent.state === "Held") {
      inner.session = spent;
      sessionAnnounce(inner);
    } else sessionForget(inner, sessionReason(failure));
    return false;
  }
}

async function sessionBearer(inner: SessionInner): Promise<string | undefined> {
  const usable = sessionUsableAccessToken(inner.ports.nowMs(), inner.session);
  if (usable !== undefined) return usable;
  if (inner.session.state !== "Held") return undefined;
  return (await sessionRefresh(inner))
    ? sessionUsableAccessToken(inner.ports.nowMs(), inner.session)
    : undefined;
}

/**
 * A sign-in, remembering where it was started from when the caller names a
 * path. The issuer redirects to the one address this client is registered
 * with, so a page reached from elsewhere — the forge's own setup return, which
 * carries a query the page needs — is come back to from the transaction rather
 * than from the redirect.
 */
async function sessionSignIn(
  inner: SessionInner,
  returnPath: string | undefined,
): Promise<void> {
  const { configuration, endpoints, ports } = inner;
  if (configuration === undefined || endpoints === undefined) return;
  const verifier = pkceVerifierFromBytes(
    ports.drawBytes(pkceVerifierBytesCount),
  );
  const state = base64urlFromBytes(ports.drawBytes(pkceVerifierBytesCount));
  const challenge = await pkceChallengeFromVerifier(ports.digest, verifier);
  ports.transient.write(
    sessionTransactionKey,
    JSON.stringify({
      state,
      verifier,
      ...(returnPath === undefined ? {} : { returnPath }),
    }),
  );
  ports.redirect(
    authorizeUrl(configuration, endpoints, { state, verifier, challenge }),
  );
}

interface SessionTransaction {
  readonly state: string;
  readonly verifier: string;
  readonly returnPath: string | undefined;
}

/** Read once and removed, so a replayed callback finds nothing to match. */
function sessionTakeTransaction(
  inner: SessionInner,
): SessionTransaction | undefined {
  const stored = inner.ports.transient.read(sessionTransactionKey);
  inner.ports.transient.remove(sessionTransactionKey);
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const fields = parsed as {
      state?: unknown;
      verifier?: unknown;
      returnPath?: unknown;
    };
    if (typeof fields.state !== "string" || typeof fields.verifier !== "string")
      return undefined;
    return {
      state: fields.state,
      verifier: fields.verifier,
      returnPath:
        typeof fields.returnPath === "string" ? fields.returnPath : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * A callback is read only at the address this client is registered with, so a
 * forge's own authorization, which returns a code and a state to a page of its
 * own, is that page's to redeem and spends nothing of a sign-in. One arriving
 * before the console has loaded is left untouched for the load that succeeds.
 */
async function sessionCompleteCallback(
  inner: SessionInner,
  location: SessionLocation,
): Promise<SessionCallback> {
  const callback = parseAuthorizationCallback(location.search);
  if (callback.result === "None") return { result: "None" };
  const { configuration, endpoints } = inner;
  if (configuration === undefined || endpoints === undefined)
    return { result: "None" };
  if (new URL(configuration.redirectUri).pathname !== location.pathname)
    return { result: "None" };
  const transaction = sessionTakeTransaction(inner);
  if (callback.result === "Denied") return callback;
  if (transaction === undefined || transaction.state !== callback.state)
    return { result: "Denied", reason: "the callback did not match this tab" };
  try {
    sessionAdopt(
      inner,
      await inner.ports.fetchJson(
        tokenExchangeRequest(configuration, endpoints, {
          code: callback.code,
          verifier: transaction.verifier,
        }),
      ),
    );
    return { result: "SignedIn", returnPath: transaction.returnPath };
  } catch (failure: unknown) {
    return { result: "Denied", reason: sessionReason(failure) };
  }
}

/** Revocation only where the issuer publishes an endpoint for it. */
function sessionRevocation(inner: SessionInner): FormRequest | undefined {
  const { configuration, endpoints, session } = inner;
  if (configuration === undefined || endpoints === undefined) return undefined;
  if (session.state !== "Held" || session.held.refreshToken === undefined)
    return undefined;
  return tokenRevocationRequest(
    configuration,
    endpoints,
    session.held.refreshToken,
  );
}

async function sessionSignOut(inner: SessionInner): Promise<void> {
  const revocation = sessionRevocation(inner);
  sessionForget(inner, undefined);
  if (revocation !== undefined)
    await inner.ports.fetchJson(revocation).catch(() => undefined);
}

/** What the sign-in was refused for, kept where the tree that draws it reads. */
function sessionRefuse(inner: SessionInner, reason: string): void {
  inner.reason = reason;
  sessionAnnounce(inner);
}

function sessionRefreshDue(inner: SessionInner): number | undefined {
  if (inner.session.state !== "Held") return undefined;
  if (inner.session.held.accessToken === "") return undefined;
  return sessionRefreshDueAtMs(inner.session.held);
}

export function createSessionHolder(ports: SessionHolderPorts): SessionHolder {
  const inner: SessionInner = {
    ports,
    listeners: new Set<() => void>(),
    phase: "Loading",
    reason: undefined,
    configuration: undefined,
    endpoints: undefined,
    session: sessionSignedOut,
    generation: 0,
    renewal: undefined,
    snapshot: {
      phase: "Loading",
      reason: undefined,
      configuration: undefined,
    },
  };
  return {
    load: () => sessionLoad(inner),
    completeCallback: (location: SessionLocation) =>
      sessionCompleteCallback(inner, location),
    signIn: (returnPath?: string) => sessionSignIn(inner, returnPath),
    signOut: () => sessionSignOut(inner),
    bearer: () => sessionBearer(inner),
    refresh: () => sessionRefresh(inner),
    refuse: (reason: string) => {
      sessionRefuse(inner, reason);
    },
    refreshDueAtMs: () => sessionRefreshDue(inner),
    generation: () => inner.generation,
    snapshot: () => inner.snapshot,
    subscribe: (listener: () => void) => {
      inner.listeners.add(listener);
      return () => {
        inner.listeners.delete(listener);
      };
    },
  };
}
