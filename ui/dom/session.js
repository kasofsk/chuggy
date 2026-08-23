/**
 * Holding a signed-in session in this tab and nowhere else.
 *
 * The access token lives in a closure for the life of the page: no cookie, no
 * local storage, nothing that survives the tab. The in-flight authorization
 * transaction does have to survive one redirect, so its state and verifier —
 * never a token — go to session storage and are removed the moment the code
 * comes back.
 */

import {
  authorizeUrl,
  configurationPath,
  discoveryUrl,
  identityLabel,
  parseCallback,
  parseConfiguration,
  parseDiscovery,
  parseTokenResponse,
  sessionExpiresAtMs,
  sessionNeedsRefresh,
  tokenExchangeRequest,
  tokenRefreshRequest,
} from "../app/authorization.js";
import {
  challengeFromVerifier,
  verifierBytesCount,
  verifierFromBytes,
} from "../app/pkce.js";
import { base64urlEncoded } from "../app/encoding.js";
import { readJson } from "./transport.js";

const transactionKey = "chuggy.authorization";
export const refreshFailuresMax = 3;

function drawnBytes() {
  return crypto.getRandomValues(new Uint8Array(verifierBytesCount));
}

function sessionRemember(transaction) {
  sessionStorage.setItem(transactionKey, JSON.stringify(transaction));
}

/** Read once and removed, so a replayed callback finds nothing to match. */
function sessionTakeTransaction() {
  const stored = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (stored === null) return undefined;
  const parsed = JSON.parse(stored);
  return typeof parsed === "object" && parsed !== null ? parsed : undefined;
}

async function sessionExchanged(request) {
  return parseTokenResponse(
    await readJson(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    }),
  );
}

async function sessionLoad(held) {
  held.configuration = parseConfiguration(await readJson(configurationPath));
  held.endpoints = parseDiscovery(
    held.configuration,
    await readJson(discoveryUrl(held.configuration)),
  );
}

async function sessionBeginSignIn(held) {
  const verifier = verifierFromBytes(drawnBytes());
  const state = base64urlEncoded(drawnBytes());
  sessionRemember({ state, verifier });
  location.assign(
    authorizeUrl(held.configuration, held.endpoints, {
      state,
      verifier,
      challenge: await challengeFromVerifier(verifier),
    }),
  );
}

function sessionAdopt(held, token) {
  held.token = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAtMs: sessionExpiresAtMs(held.nowMs(), token.expiresInSeconds),
    label:
      token.idToken === undefined ? undefined : identityLabel(token.idToken),
  };
  held.refreshFailures = 0;
}

async function sessionCompleteSignIn(held, search) {
  const callback = parseCallback(search);
  if (callback.result === "Absent") return { result: "None" };
  const transaction = sessionTakeTransaction();
  if (callback.result === "Denied")
    return {
      result: "Denied",
      reason: `${callback.code}: ${callback.description}`,
    };
  if (transaction === undefined || transaction.state !== callback.state)
    return {
      result: "Denied",
      reason: "the callback did not match this tab's request",
    };
  sessionAdopt(
    held,
    await sessionExchanged(
      tokenExchangeRequest(held.configuration, held.endpoints, {
        code: callback.code,
        verifier: transaction.verifier,
      }),
    ),
  );
  return { result: "SignedIn" };
}

/** A refresh budget, so an issuer that keeps declining ends the session once. */
async function sessionAccessToken(held) {
  if (held.token === undefined) return undefined;
  if (!sessionNeedsRefresh(held.nowMs(), held.token.expiresAtMs))
    return held.token.accessToken;
  if (
    held.token.refreshToken === undefined ||
    held.refreshFailures >= refreshFailuresMax
  ) {
    held.token = undefined;
    return undefined;
  }
  try {
    const refreshed = tokenRefreshRequest(
      held.configuration,
      held.endpoints,
      held.token.refreshToken,
    );
    sessionAdopt(held, await sessionExchanged(refreshed));
    return held.token.accessToken;
  } catch {
    held.refreshFailures += 1;
    return undefined;
  }
}

export function createSession(nowMs) {
  const held = {
    nowMs,
    configuration: undefined,
    endpoints: undefined,
    token: undefined,
    refreshFailures: 0,
  };
  return {
    load: () => sessionLoad(held),
    beginSignIn: () => sessionBeginSignIn(held),
    completeSignIn: (search) => sessionCompleteSignIn(held, search),
    accessToken: () => sessionAccessToken(held),
    signedIn: () => held.token !== undefined,
    label: () => held.token?.label,
    signOut: () => {
      held.token = undefined;
    },
    redirectPath: () => new URL(held.configuration.redirectUri).pathname,
  };
}
