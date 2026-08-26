/**
 * The whole sign-in, driven with no browser present.
 *
 * The ports stand in for the network, the clock, the draws, the digest, the two
 * stores and the address bar, so what is checked is the flow: what is
 * persisted, what is asked for, what a mismatched callback does, and that a
 * declining issuer ends the session once rather than being asked forever.
 */

import { expect, test } from "vitest";

import { sessionRefreshFailuresMax } from "../app/core/authorization.ts";
import {
  createSessionHolder,
  sessionRefreshTokenKey,
  sessionTransactionKey,
} from "../app/core/sessionHolder.ts";
import type {
  KeyValuePort,
  SessionHolderPorts,
} from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";

const configuration = {
  issuer: "https://auth.example/",
  clientId: "chuggy-web",
  audience: "https://chuggy.example/api",
  redirectUri: "https://chuggy.example/auth/callback",
  scopes: ["openid", "offline_access"],
};

const discovery = {
  issuer: "https://auth.example",
  authorization_endpoint: "https://auth.example/oauth2/auth",
  token_endpoint: "https://auth.example/oauth2/token",
  revocation_endpoint: "https://auth.example/oauth2/revoke",
};

function store(): KeyValuePort & { readonly held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    read: (key) => held.get(key) ?? null,
    write: (key, value) => {
      held.set(key, value);
    },
    remove: (key) => {
      held.delete(key);
    },
  };
}

interface Harness {
  readonly ports: SessionHolderPorts;
  readonly persistent: ReturnType<typeof store>;
  readonly transient: ReturnType<typeof store>;
  readonly asked: (FormRequest | string)[];
  readonly redirects: string[];
  answer: (request: FormRequest | string) => unknown;
  nowMs: number;
}

function harness(): Harness {
  const persistent = store();
  const transient = store();
  const asked: (FormRequest | string)[] = [];
  const redirects: string[] = [];
  const held: Harness = {
    persistent,
    transient,
    asked,
    redirects,
    nowMs: 1_000,
    answer: (request) =>
      request === "/config.json"
        ? configuration
        : typeof request === "string"
          ? discovery
          : { access_token: "access", refresh_token: "renew", expires_in: 600 },
    ports: {
      nowMs: () => held.nowMs,
      fetchJson: (request) => {
        asked.push(request);
        try {
          return Promise.resolve(held.answer(request));
        } catch (failure: unknown) {
          return Promise.reject(
            failure instanceof Error ? failure : new Error("refused"),
          );
        }
      },
      persistent,
      transient,
      digest: (message) => Promise.resolve(message.slice(0, 32)),
      drawBytes: (count) => new Uint8Array(count).fill(7),
      redirect: (url) => redirects.push(url),
    },
  };
  return held;
}

test("a console that cannot read its configuration says so and stops", async () => {
  const held = harness();
  held.answer = () => {
    throw new Error("no such file");
  };
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot().phase).toBe("Unconfigured");
  expect(holder.snapshot().reason).toBe("no such file");
});

test("a stored refresh token is what makes a reload a signed-in session", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot().phase).toBe("SignedIn");
  expect(await holder.bearer()).toBe("access");
});

test("signing in remembers the transaction and sends the audience", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn();
  expect(held.transient.held.has(sessionTransactionKey)).toBe(true);
  const url = new URL(held.redirects[0] ?? "");
  expect(url.searchParams.get("audience")).toBe(configuration.audience);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});

test("a callback whose state does not match this tab is refused", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn();
  const answer = await holder.completeCallback("?code=abc&state=someone-else");
  expect(answer).toEqual({
    result: "Denied",
    reason: "the callback did not match this tab",
  });
  expect(held.transient.held.has(sessionTransactionKey)).toBe(false);
});

test("a completed callback persists the refresh token and no access token", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn();
  const state = new URLSearchParams(
    new URL(held.redirects[0] ?? "").search,
  ).get("state");
  const answer = await holder.completeCallback(
    `?code=abc&state=${String(state)}`,
  );
  expect(answer).toEqual({ result: "SignedIn" });
  expect(held.persistent.held.get(sessionRefreshTokenKey)).toBe("renew");
  expect([...held.persistent.held.values()]).not.toContain("access");
});

test("an issuer that keeps declining ends the session once", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  held.answer = () => {
    throw new Error("invalid_grant");
  };
  for (let attempt = 0; attempt < sessionRefreshFailuresMax; attempt += 1)
    expect(await holder.refresh()).toBe(false);
  expect(holder.snapshot().phase).toBe("SignedOut");
  expect(held.persistent.held.has(sessionRefreshTokenKey)).toBe(false);
  const spent = held.asked.length;
  expect(await holder.refresh()).toBe(false);
  expect(held.asked.length).toBe(spent);
});

test("signing out clears the store and revokes where the issuer offers it", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.bearer();
  await holder.signOut();
  expect(held.persistent.held.has(sessionRefreshTokenKey)).toBe(false);
  expect(holder.snapshot().phase).toBe("SignedOut");
  const revocation = held.asked.at(-1);
  expect(typeof revocation === "object" ? revocation.url : "").toBe(
    discovery.revocation_endpoint,
  );
});

test("a renewal changes the generation, which is what reopens a stream", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  const before = holder.generation();
  await holder.refresh();
  expect(holder.generation()).toBeGreaterThan(before);
});
