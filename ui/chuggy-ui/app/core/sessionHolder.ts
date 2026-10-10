/**
 * The signed-in session, held for the life of the tab and renewed before it
 * lapses.
 *
 * Everything the flow needs from a browser arrives as a port, so the whole of
 * it — the exchange, the renewal, the budget and the sign-out — is exercised
 * without one. The access token stays in this closure; only the refresh token
 * is handed to the store, which is what lets a reload keep the session without
 * ever writing an access token down.
 *
 * THE STORE IS SHARED AND THE CLOSURE IS NOT. Every document of an origin
 * reads the one stored refresh token, and an issuer that rotates them revokes
 * the whole session when a spent one is shown to it again. So the token a
 * renewal presents is the one the store holds at that moment, read while no
 * other document is renewing, and never the one this document remembers.
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
  sessionWithRefreshToken,
} from "./session.ts";
import type { SessionHeld, SessionState } from "./session.ts";

export const sessionRefreshTokenKey = "chuggy.refreshToken";
export const sessionTransactionKey = "chuggy.authorization";
export const sessionLoadRetryDelayMs = 1_000;

/** The name every document of an origin takes its turn to renew under. */
export const sessionRenewalLockName = "chuggy.session.renewal";
/** How long a renewal waits its turn behind another document's. */
export const sessionRenewalWaitMs = 30_000;

/** What a reader is told of a session the issuer would not renew. */
export const sessionEndedReason = "Session ended";
/** What a reader is told of one the issuer kept answering unusably for. */
export const sessionUnrenewedReason = "this session could not be renewed";

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

/** What a JSON request is sent with, a GET where it names no method. */
export interface FetchJsonInit {
  readonly method?: "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/** An answer narrowed to what is read of it, so a suite can fake it. */
export interface FetchJsonResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

export type FetchJsonPort = (
  url: string,
  init: FetchJsonInit,
) => Promise<FetchJsonResponse>;

function fetchJsonInit(request: FormRequest | string): FetchJsonInit {
  if (typeof request === "string")
    return { headers: { accept: "application/json" } };
  return {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: request.body,
  };
}

function fetchJsonUnanswered(failure: unknown): FetchJsonError {
  return new FetchJsonError(
    { fault: "Unanswered" },
    failure instanceof Error ? failure.message : "the request got no answer",
  );
}

/**
 * The token endpoints speak form encoding; `/config.json` and discovery, GET.
 * A request that got no answer, or lost its body on the way, rejects as
 * unanswered, and a body that is not JSON as the parser's own error.
 */
export async function fetchJsonThrough(
  fetch: FetchJsonPort,
  request: FormRequest | string,
): Promise<unknown> {
  const url = typeof request === "string" ? request : request.url;
  const response = await fetch(url, fetchJsonInit(request)).catch(
    (failure: unknown) => {
      throw fetchJsonUnanswered(failure);
    },
  );
  if (!response.ok)
    throw new FetchJsonError(
      { fault: "Status", status: response.status },
      `${url} answered ${String(response.status)}`,
    );
  const text = await response.text().catch((failure: unknown) => {
    throw fetchJsonUnanswered(failure);
  });
  const value: unknown = JSON.parse(text);
  return value;
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
  /**
   * Runs `body` while no other holder over the same store is running one
   * under `name`, rejecting where the turn did not come within `waitMs`.
   * Absent where nothing else shares the store.
   */
  readonly exclusive?: <T>(
    name: string,
    waitMs: number,
    body: () => Promise<T>,
  ) => Promise<T>;
  /** Tells `heard` whenever the stored refresh token may have changed under
   * this holder. Absent where nothing else shares the store. */
  readonly storedHeard?: (heard: () => void) => void;
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
  /** Whether the store was seen holding this session's refresh token, which
   * one a browser refuses never is. */
  storeKeeps: boolean;
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
const sessionTransientStatuses: ReadonlySet<number> = new Set([502, 503, 504]);

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
        phase: sessionTransientStatuses.has(failure.fault.status)
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
  if (stored !== null) {
    inner.session = sessionFromRefreshToken(stored);
    inner.storeKeeps = true;
  }
  sessionSettle(inner);
}

function sessionHeldNow(inner: SessionInner): SessionHeld | undefined {
  return inner.session.state === "Held" ? inner.session.held : undefined;
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
  inner.storeKeeps =
    kept !== undefined &&
    inner.ports.persistent.read(sessionRefreshTokenKey) === kept;
  sessionSettle(inner);
}

/** Ends the session in this document and leaves the store as it is. */
function sessionDrop(inner: SessionInner, reason: string | undefined): void {
  inner.generation += 1;
  inner.session = sessionSignedOut;
  inner.reason = reason;
  sessionSettle(inner);
}

function sessionForget(inner: SessionInner, reason: string | undefined): void {
  inner.ports.persistent.remove(sessionRefreshTokenKey);
  sessionDrop(inner, reason);
}

/**
 * Brings this document in line with the store every document of the origin
 * shares: a token there that this one does not hold is the one another
 * document renewed to, and a store that kept this session's token and holds
 * none now is a session another document ended.
 */
function sessionFollow(inner: SessionInner): void {
  const held = sessionHeldNow(inner);
  if (held === undefined || !inner.storeKeeps) return;
  const stored = inner.ports.persistent.read(sessionRefreshTokenKey);
  if (stored === held.refreshToken) return;
  if (stored === null) sessionDrop(inner, undefined);
  else inner.session = sessionWithRefreshToken(held, stored);
}

/**
 * One renewal at a time, shared by everyone in this document who asked while
 * it was in flight, and cleared when it settles so the next caller past the
 * renewal point starts a new one.
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

/**
 * A renewal takes its turn among the holders sharing the store. A turn that
 * did not come leaves the session as it was, to be renewed when it is next
 * needed.
 */
async function sessionRenew(inner: SessionInner): Promise<boolean> {
  const exclusive = inner.ports.exclusive;
  if (exclusive === undefined) return sessionRenewStored(inner);
  try {
    return await exclusive(sessionRenewalLockName, sessionRenewalWaitMs, () =>
      sessionRenewStored(inner),
    );
  } catch {
    return false;
  }
}

/**
 * Presents the token the store holds now. An answer that arrives after the
 * session was ended is dropped, so a sign-out is not undone by the renewal it
 * overtook.
 */
async function sessionRenewStored(inner: SessionInner): Promise<boolean> {
  const { configuration, endpoints } = inner;
  if (configuration === undefined || endpoints === undefined) return false;
  sessionFollow(inner);
  const held = sessionHeldNow(inner);
  if (held === undefined) return false;
  const presented = held.refreshToken;
  if (presented === undefined || !sessionCanRefresh(held)) {
    sessionForget(inner, sessionUnrenewedReason);
    return false;
  }
  try {
    const issued = await inner.ports.fetchJson(
      tokenRefreshRequest(configuration, endpoints, presented),
    );
    if (sessionHeldNow(inner) === undefined) return false;
    sessionAdopt(inner, issued);
    return true;
  } catch (failure: unknown) {
    sessionRenewFailed(inner, presented, failure);
    return false;
  }
}

/** How a renewal that brought no tokens ended. */
type SessionRenewalFault = "Refused" | "Unanswered" | "Unusable";

/** What a token endpoint answers a grant it will not honour. */
const sessionRefusalStatuses: ReadonlySet<number> = new Set([400, 401]);

function sessionRenewalFault(failure: unknown): SessionRenewalFault {
  if (!(failure instanceof FetchJsonError)) return "Unusable";
  switch (failure.fault.fault) {
    case "Unanswered":
      return "Unanswered";
    case "Status":
      if (sessionRefusalStatuses.has(failure.fault.status)) return "Refused";
      return sessionTransientStatuses.has(failure.fault.status)
        ? "Unanswered"
        : "Unusable";
  }
}

/**
 * What a renewal that brought no tokens leaves: a refusal ends the session,
 * being the issuer's answer about it that asking again cannot change, and no
 * answer keeps it, saying nothing about it. Anything else is counted against
 * the budget, so an issuer that keeps answering unusably ends the session
 * once.
 */
function sessionRenewFailed(
  inner: SessionInner,
  presented: string,
  failure: unknown,
): void {
  const held = sessionHeldNow(inner);
  if (held === undefined) return;
  switch (sessionRenewalFault(failure)) {
    case "Refused":
      sessionRefused(inner, presented);
      return;
    case "Unanswered":
      return;
    case "Unusable": {
      const spent = sessionAfterRefreshFailure(held);
      if (spent.state === "Held") {
        inner.session = spent;
        sessionAnnounce(inner);
      } else sessionForget(inner, sessionUnrenewedReason);
    }
  }
}

/** Ends a session the issuer would not renew, clearing the store only of the
 * token it refused: one another holder has put there since is that holder's. */
function sessionRefused(inner: SessionInner, presented: string): void {
  if (inner.ports.persistent.read(sessionRefreshTokenKey) === presented)
    inner.ports.persistent.remove(sessionRefreshTokenKey);
  sessionDrop(inner, sessionEndedReason);
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

/** The token revoked is the store's, which another document may have renewed
 * to since this one last looked. */
async function sessionSignOut(inner: SessionInner): Promise<void> {
  sessionFollow(inner);
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
    storeKeeps: false,
    generation: 0,
    renewal: undefined,
    snapshot: {
      phase: "Loading",
      reason: undefined,
      configuration: undefined,
    },
  };
  ports.storedHeard?.(() => {
    sessionFollow(inner);
  });
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
