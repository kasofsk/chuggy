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

export interface KeyValuePort {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

export interface SessionHolderPorts {
  readonly nowMs: () => number;
  readonly fetchJson: (request: FormRequest | string) => Promise<unknown>;
  readonly persistent: KeyValuePort;
  readonly transient: KeyValuePort;
  readonly digest: PkceDigestPort;
  readonly drawBytes: (count: number) => Uint8Array;
  readonly redirect: (url: string) => void;
}

export type SessionPhase =
  "Loading" | "Unconfigured" | "SignedOut" | "SignedIn";

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly reason: string | undefined;
  readonly configuration: ConsoleConfiguration | undefined;
}

export type SessionCallback =
  | { readonly result: "SignedIn" }
  | { readonly result: "Denied"; readonly reason: string }
  | { readonly result: "None" };

export interface SessionHolder {
  readonly load: () => Promise<void>;
  readonly completeCallback: (search: string) => Promise<SessionCallback>;
  readonly signIn: () => Promise<void>;
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

async function sessionLoad(inner: SessionInner): Promise<void> {
  try {
    inner.configuration = parseConsoleConfiguration(
      await inner.ports.fetchJson(consoleConfigurationPath),
    );
    inner.endpoints = parseDiscovery(
      inner.configuration,
      await inner.ports.fetchJson(discoveryUrl(inner.configuration)),
    );
  } catch (failure: unknown) {
    inner.phase = "Unconfigured";
    inner.reason = sessionReason(failure);
    sessionAnnounce(inner);
    return;
  }
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

async function sessionSignIn(inner: SessionInner): Promise<void> {
  const { configuration, endpoints, ports } = inner;
  if (configuration === undefined || endpoints === undefined) return;
  const verifier = pkceVerifierFromBytes(
    ports.drawBytes(pkceVerifierBytesCount),
  );
  const state = base64urlFromBytes(ports.drawBytes(pkceVerifierBytesCount));
  const challenge = await pkceChallengeFromVerifier(ports.digest, verifier);
  ports.transient.write(
    sessionTransactionKey,
    JSON.stringify({ state, verifier }),
  );
  ports.redirect(
    authorizeUrl(configuration, endpoints, { state, verifier, challenge }),
  );
}

interface SessionTransaction {
  readonly state: string;
  readonly verifier: string;
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
    const fields = parsed as { state?: unknown; verifier?: unknown };
    if (typeof fields.state !== "string" || typeof fields.verifier !== "string")
      return undefined;
    return { state: fields.state, verifier: fields.verifier };
  } catch {
    return undefined;
  }
}

async function sessionCompleteCallback(
  inner: SessionInner,
  search: string,
): Promise<SessionCallback> {
  const callback = parseAuthorizationCallback(search);
  if (callback.result === "None") return { result: "None" };
  const transaction = sessionTakeTransaction(inner);
  if (callback.result === "Denied") return callback;
  const { configuration, endpoints } = inner;
  if (configuration === undefined || endpoints === undefined)
    return { result: "Denied", reason: "the console is not configured" };
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
    return { result: "SignedIn" };
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
    completeCallback: (search: string) =>
      sessionCompleteCallback(inner, search),
    signIn: () => sessionSignIn(inner),
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
