/**
 * When a session has to be renewed, and when it has run out of chances.
 *
 * Every case is a function of a clock the test supplies, so the scheduling is
 * checked without waiting for any of it.
 */

import { expect, test } from "vitest";

import {
  sessionRefreshFailuresMax,
  sessionRefreshSecondsBefore,
} from "../app/core/authorization.ts";
import {
  sessionAfterRefreshFailure,
  sessionCanRefresh,
  sessionFromRefreshToken,
  sessionFromTokens,
  sessionNeedsRefresh,
  sessionRefreshDueAtMs,
  sessionUsableAccessToken,
} from "../app/core/session.ts";
import type { SessionHeld } from "../app/core/session.ts";

const issuedAtMs = 1_000_000;
const issued = {
  accessToken: "access",
  refreshToken: "renew",
  expiresInSeconds: 600,
};

function heldOf(): SessionHeld {
  const state = sessionFromTokens(issuedAtMs, issued);
  if (state.state !== "Held") throw new Error("the tokens were not adopted");
  return state.held;
}

test("the renewal is due before expiry, by the stated margin", () => {
  const held = heldOf();
  expect(held.expiresAtMs).toBe(issuedAtMs + issued.expiresInSeconds * 1_000);
  expect(sessionRefreshDueAtMs(held)).toBe(
    held.expiresAtMs - sessionRefreshSecondsBefore * 1_000,
  );
  expect(sessionNeedsRefresh(sessionRefreshDueAtMs(held) - 1, held)).toBe(
    false,
  );
  expect(sessionNeedsRefresh(sessionRefreshDueAtMs(held), held)).toBe(true);
});

test("an issuer that rotates no refresh token leaves the held one in place", () => {
  const state = sessionFromTokens(
    issuedAtMs,
    { accessToken: "next", refreshToken: undefined, expiresInSeconds: 60 },
    "renew",
  );
  expect(state.state === "Held" && state.held.refreshToken).toBe("renew");
});

test("the budget ends the session rather than retrying without limit", () => {
  let state = { state: "Held", held: heldOf() } as const;
  let spent = 0;
  for (let attempt = 0; attempt < sessionRefreshFailuresMax; attempt += 1) {
    const next = sessionAfterRefreshFailure(state.held);
    spent += 1;
    if (next.state === "SignedOut") break;
    state = { state: "Held", held: next.held };
  }
  expect(spent).toBe(sessionRefreshFailuresMax);
  expect(sessionAfterRefreshFailure(state.held).state).toBe("SignedOut");
});

test("a session with no refresh token cannot be renewed at all", () => {
  const held = { ...heldOf(), refreshToken: undefined };
  expect(sessionCanRefresh(held)).toBe(false);
});

test("a session restored from storage holds no access token to use", () => {
  const state = sessionFromRefreshToken("renew");
  expect(sessionUsableAccessToken(issuedAtMs, state)).toBeUndefined();
  expect(state.state === "Held" && state.held.refreshToken).toBe("renew");
});

test("a token past its renewal point is not offered to a request", () => {
  const state = sessionFromTokens(issuedAtMs, issued);
  expect(sessionUsableAccessToken(issuedAtMs, state)).toBe("access");
  expect(
    sessionUsableAccessToken(
      issuedAtMs + issued.expiresInSeconds * 1_000,
      state,
    ),
  ).toBeUndefined();
});
