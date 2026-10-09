/**
 * The runtime configuration as a deployment mounts it: the key a deployment
 * may leave out, and what that key may hold.
 */

import { expect, test } from "vitest";

import { parseConsoleConfiguration } from "../app/core/configuration.ts";

const mounted = {
  issuer: "https://auth.example/",
  clientId: "console",
  audience: "https://api.example",
  redirectUri: "https://chuggy.example/auth/callback",
  scopes: ["openid"],
};

test("a deployment that names no invite cookie domain starts, with none", () => {
  const parsed = parseConsoleConfiguration(mounted);
  expect(parsed.inviteCookieDomain).toBe(undefined);
  expect(parsed.issuer).toBe("https://auth.example");
});

test("a deployment's invite cookie domain is read as it is mounted", () => {
  expect(
    parseConsoleConfiguration({ ...mounted, inviteCookieDomain: "example.com" })
      .inviteCookieDomain,
  ).toBe("example.com");
});

test("an invite cookie domain that is no host name is not a configuration", () => {
  for (const inviteCookieDomain of [
    "",
    "example.com; Path=/x",
    "example.com,other.example",
    ".example.com",
    "exa mple.com",
  ])
    expect(() =>
      parseConsoleConfiguration({ ...mounted, inviteCookieDomain }),
    ).toThrow();
});
