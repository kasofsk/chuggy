/**
 * A project's access tokens decided with no renderer: where a token stands at
 * an instant a case names, the days it has left while it nears its end, what a
 * mint's form sends, and the line each refusal is drawn as.
 */

import { expect, test } from "vitest";

import {
  accessTokenLimitReachedCode,
  accessTokenMintForbiddenCode,
  accessTokenNameCharsMax,
  accessTokenNameTakenCode,
  accessTokenWarningDays,
} from "../../../src/contract/accessToken.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import {
  accessTokenDaysLeft,
  accessTokenDeletionNote,
  accessTokenFormBlank,
  accessTokenLifetimeLabel,
  accessTokenLifetimesDays,
  accessTokenMintBody,
  accessTokenMintRefusal,
  accessTokenMintSendable,
  accessTokenNameFault,
  accessTokenStatusAt,
} from "../app/core/accessTokens.ts";

const dayMs = 24 * 60 * 60 * 1000;
const expiresAt = "2026-12-01T00:00:00.000Z";
const expiresMs = Date.parse(expiresAt);
const warnedMs = expiresMs - accessTokenWarningDays * dayMs;

test("a token is Active until its warning days, Expiring from their first instant, and Expired from its expiry on", () => {
  expect(accessTokenStatusAt(expiresAt, warnedMs - 1)).toBe("Active");
  expect(accessTokenStatusAt(expiresAt, warnedMs)).toBe("Expiring");
  expect(accessTokenStatusAt(expiresAt, expiresMs - 1)).toBe("Expiring");
  expect(accessTokenStatusAt(expiresAt, expiresMs)).toBe("Expired");
  expect(accessTokenStatusAt(expiresAt, expiresMs + dayMs)).toBe("Expired");
});

test("an Expiring token counts its days left, a part day as one, and no other standing has any", () => {
  expect(accessTokenDaysLeft(expiresAt, warnedMs - 1)).toBeUndefined();
  expect(accessTokenDaysLeft(expiresAt, warnedMs)).toBe(accessTokenWarningDays);
  expect(accessTokenDaysLeft(expiresAt, expiresMs - 1)).toBe(1);
  expect(accessTokenDaysLeft(expiresAt, expiresMs)).toBeUndefined();
});

test("a mint opens on Read for thirty days, and a year is sent as its days", () => {
  expect(accessTokenFormBlank).toStrictEqual({
    name: "",
    access: "Read",
    lifetimeDays: 30,
  });
  expect(
    accessTokenLifetimesDays.map((days) =>
      copyTextEn(accessTokenLifetimeLabel(days)),
    ),
  ).toStrictEqual(["7 days", "30 days", "60 days", "90 days", "1 year"]);
  expect(
    accessTokenMintBody({
      name: " deploy ",
      access: "Write",
      lifetimeDays: 365,
    }),
  ).toStrictEqual({ name: "deploy", access: "Write", lifetimeDays: 365 });
});

test("a name is sent only where it is not blank and within its bound, and only a long one is a fault", () => {
  const named = (name: string) => ({ ...accessTokenFormBlank, name });
  const longest = "n".repeat(accessTokenNameCharsMax);
  expect(accessTokenMintSendable(named(""))).toBe(false);
  expect(accessTokenMintSendable(named("   "))).toBe(false);
  expect(accessTokenMintSendable(named(longest))).toBe(true);
  expect(accessTokenMintSendable(named(`${longest}n`))).toBe(false);
  expect(accessTokenNameFault("")).toBeUndefined();
  expect(accessTokenNameFault(longest)).toBeUndefined();
  const fault = accessTokenNameFault(`${longest}n`);
  expect(fault === undefined ? undefined : copyTextEn(fault)).toBe(
    `At most ${String(accessTokenNameCharsMax)} characters`,
  );
});

test("each of the mint's refusals is read by its code, and any other answer is the plane's line", () => {
  const conflict = (code: string) => ({
    outcome: "Conflict" as const,
    code,
    body: {},
  });
  expect(
    copyTextEn(accessTokenMintRefusal(conflict(accessTokenLimitReachedCode))),
  ).toBe("Token limit reached");
  expect(
    copyTextEn(accessTokenMintRefusal(conflict(accessTokenNameTakenCode))),
  ).toBe("Name already in use");
  expect(
    copyTextEn(
      accessTokenMintRefusal({
        outcome: "Rejected",
        code: accessTokenMintForbiddenCode,
        status: 403,
        body: {},
      }),
    ),
  ).toBe("Not permitted to make tokens");
  expect(
    copyTextEn(
      accessTokenMintRefusal({ outcome: "Fault", code: "x", status: 500 }),
    ),
  ).toBe("Failed");
});

test("a deletion done or of a token already gone says nothing, and any other refusal its line", () => {
  expect(
    accessTokenDeletionNote({ outcome: "Ok", value: undefined }),
  ).toBeUndefined();
  expect(accessTokenDeletionNote({ outcome: "Absent" })).toBeUndefined();
  const note = accessTokenDeletionNote({
    outcome: "Fault",
    code: "x",
    status: 500,
  });
  expect(note === undefined ? undefined : copyTextEn(note)).toBe("Failed");
});
