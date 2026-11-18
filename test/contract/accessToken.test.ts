/**
 * An access token's secret is admitted by its pattern alone, and what a mint
 * asks for and a list answers are refused one past each bound.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { accessTokenSecrets } from "../../src/adapters/crypto/accessTokenMint.ts";
import { sessionBearerPrefix } from "../../src/contract/sessionPlane.ts";
import {
  accessTokenLifetimeDaysMax,
  accessTokenMintRequestSchema,
  accessTokenNameCharsMax,
  accessTokenPattern,
  accessTokenPrefix,
  accessTokensProjectMax,
  accessTokensResponseSchema,
} from "../../src/contract/accessToken.ts";

const drawn = accessTokenSecrets().mint().secret;

test("the pattern admits a drawn secret", () => {
  assert.match(drawn, accessTokenPattern);
});

test("the pattern refuses a secret one character short or long, another prefix's, a JWS and the prefix in capitals", () => {
  for (const refused of [
    drawn.slice(0, -1),
    `${drawn}A`,
    `${sessionBearerPrefix}${drawn.slice(accessTokenPrefix.length)}`,
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl",
    `${accessTokenPrefix.toUpperCase()}${drawn.slice(accessTokenPrefix.length)}`,
  ])
    assert.doesNotMatch(refused, accessTokenPattern, refused);
});

test("a mint's name and lifetime are admitted at their bounds and refused one past them", () => {
  const at = {
    name: "n".repeat(accessTokenNameCharsMax),
    access: "Write",
    lifetimeDays: accessTokenLifetimeDaysMax,
  };
  assert.ok(accessTokenMintRequestSchema.safeParse(at).success);
  assert.ok(
    accessTokenMintRequestSchema.safeParse({ ...at, lifetimeDays: 1 }).success,
  );
  for (const past of [
    { ...at, name: "n".repeat(accessTokenNameCharsMax + 1) },
    { ...at, lifetimeDays: accessTokenLifetimeDaysMax + 1 },
    { ...at, lifetimeDays: 0 },
  ])
    assert.equal(
      accessTokenMintRequestSchema.safeParse(past).success,
      false,
      JSON.stringify(past).slice(0, 80),
    );
});

test("a name is counted in code points, on one line and not blank", () => {
  const astral = "\u{1F511}".repeat(accessTokenNameCharsMax);
  assert.ok(
    accessTokenMintRequestSchema.safeParse({
      name: astral,
      access: "Read",
      lifetimeDays: 1,
    }).success,
  );
  for (const name of ["", " \t ", "one\ntwo", "one\rtwo", "one two"])
    assert.equal(
      accessTokenMintRequestSchema.safeParse({
        name,
        access: "Read",
        lifetimeDays: 1,
      }).success,
      false,
      JSON.stringify(name),
    );
});

test("a list holds at most a project's bound of tokens", () => {
  const token = {
    token: "t",
    name: "n",
    access: "Read",
    maker: "m",
    createdAt: "2026-11-18T00:00:00.000Z",
    expiresAt: "2026-11-19T00:00:00.000Z",
  };
  const listed = (count: number) =>
    accessTokensResponseSchema.safeParse({
      tokens: Array.from({ length: count }, () => token),
    }).success;
  assert.ok(listed(accessTokensProjectMax));
  assert.equal(listed(accessTokensProjectMax + 1), false);
});
