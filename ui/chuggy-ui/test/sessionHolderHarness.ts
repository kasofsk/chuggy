/**
 * A session holder driven with no browser present, shared by the suites that
 * need a real one rather than a double: the ports stand in for the network, the
 * clock, the two stores, the digest and the address bar.
 */

import type { SessionHolderPorts } from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import { keyValueDouble } from "./keyValueDouble.ts";
import type { HeldStore } from "./keyValueDouble.ts";

export const sessionHarnessConfiguration = {
  issuer: "https://auth.example/",
  clientId: "chuggy-web",
  audience: "https://chuggy.example/api",
  redirectUri: "https://chuggy.example/auth/callback",
  scopes: ["openid", "offline_access"],
};

export const sessionHarnessDiscovery = {
  issuer: "https://auth.example",
  authorization_endpoint: "https://auth.example/oauth2/auth",
  token_endpoint: "https://auth.example/oauth2/token",
  revocation_endpoint: "https://auth.example/oauth2/revoke",
};

export interface SessionHarness {
  readonly ports: SessionHolderPorts;
  readonly persistent: HeldStore;
  readonly transient: HeldStore;
  readonly asked: (FormRequest | string)[];
  readonly redirects: string[];
  answer: (request: FormRequest | string) => unknown;
  nowMs: number;
}

export function sessionHarness(): SessionHarness {
  const persistent = keyValueDouble();
  const transient = keyValueDouble();
  const asked: (FormRequest | string)[] = [];
  const redirects: string[] = [];
  const held: SessionHarness = {
    persistent,
    transient,
    asked,
    redirects,
    nowMs: 1_000,
    answer: (request) =>
      request === "/config.json"
        ? sessionHarnessConfiguration
        : typeof request === "string"
          ? sessionHarnessDiscovery
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
