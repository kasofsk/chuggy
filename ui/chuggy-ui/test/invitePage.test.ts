/**
 * The page an invite link is opened at, decided with no renderer: what counts
 * as a token, the cookie that carries one across a sign-in, the card for every
 * combination of what the page is opened with, and what a redemption came to.
 */

import { expect, test } from "vitest";

import { accessInviteLinkTokenCharsMax } from "../../../src/contract/accessPlane.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { AccessInviteLinkRedeemed } from "../../../src/contract/accessPlane.ts";
import {
  inviteCookieCleared,
  inviteCookieMaxAgeSeconds,
  inviteCookieName,
  inviteCookieToken,
  inviteCookieWritten,
  inviteFlowCarried,
  invitePageDecided,
  inviteRedemption,
  inviteTokenRead,
} from "../app/core/invitePage.ts";
import type { InviteArrival } from "../app/core/invitePage.ts";

const longest = "t".repeat(accessInviteLinkTokenCharsMax);

test("a fragment is a token unless it is empty or longer than a redemption is read with", () => {
  expect(inviteTokenRead("t0ken")).toBe("t0ken");
  expect(inviteTokenRead(longest)).toBe(longest);
  expect(inviteTokenRead("")).toBe(undefined);
  expect(inviteTokenRead(`${longest}t`)).toBe(undefined);
});

test("the cookie is the console host's own where the deployment names no domain", () => {
  expect(inviteCookieName).toBe("chuggy_invite");
  expect(inviteCookieWritten("t0ken-_", undefined)).toBe(
    `chuggy_invite=t0ken-_; Path=/; Max-Age=${String(inviteCookieMaxAgeSeconds)}; Secure; SameSite=Lax`,
  );
});

test("the cookie carries the domain the deployment names", () => {
  expect(inviteCookieWritten("t0ken-_", "example.com")).toBe(
    `chuggy_invite=t0ken-_; Path=/; Max-Age=${String(inviteCookieMaxAgeSeconds)}; Secure; SameSite=Lax; Domain=example.com`,
  );
});

test("the cookie is ended with the path and the domain it was written with", () => {
  expect(inviteCookieCleared(undefined)).toBe(
    "chuggy_invite=; Path=/; Max-Age=0; Secure; SameSite=Lax",
  );
  expect(inviteCookieCleared("example.com")).toBe(
    "chuggy_invite=; Path=/; Max-Age=0; Secure; SameSite=Lax; Domain=example.com",
  );
});

test("a token a stranger wrote adds no attribute to the cookie, and is read back as it was", () => {
  const hostile = "t; Domain=evil.example; Path=/x";
  const written = inviteCookieWritten(hostile, undefined);
  const [pair] = written.split("; ");
  expect(written.split("; ").slice(1)).toStrictEqual([
    "Path=/",
    `Max-Age=${String(inviteCookieMaxAgeSeconds)}`,
    "Secure",
    "SameSite=Lax",
  ]);
  expect(inviteCookieToken(pair ?? "")).toBe(hostile);
});

test("the token is read from among the browser's cookies, and is none where they hold none, an empty one or one too long", () => {
  expect(inviteCookieToken("theme=dark; chuggy_invite=t0ken; other=1")).toBe(
    "t0ken",
  );
  expect(inviteCookieToken("")).toBe(undefined);
  expect(inviteCookieToken("theme=dark; not_chuggy_invite=t0ken")).toBe(
    undefined,
  );
  expect(inviteCookieToken("chuggy_invite=")).toBe(undefined);
  expect(inviteCookieToken(`chuggy_invite=${longest}t`)).toBe(undefined);
  expect(inviteCookieToken("chuggy_invite=%E0%A4%A")).toBe(undefined);
});

test("an address the sign-in service sent back carries its flow", () => {
  expect(inviteFlowCarried("?flow=f-1")).toBe(true);
  expect(inviteFlowCarried("?other=1&flow=f-1")).toBe(true);
  expect(inviteFlowCarried("")).toBe(false);
  expect(inviteFlowCarried("?flowing=1")).toBe(false);
});

const bare: InviteArrival = {
  flow: false,
  signedIn: false,
  tokenKept: undefined,
  cookies: "",
};

const sessions = [false, true] as const;

test("an address carrying a flow is the refused person's card and clears the cookie, whatever else is held", () => {
  for (const signedIn of sessions)
    for (const tokenKept of [undefined, "kept"])
      for (const cookies of ["", "chuggy_invite=crossed"])
        expect(
          invitePageDecided({ flow: true, signedIn, tokenKept, cookies }),
        ).toStrictEqual({ page: "Needed", cookieCleared: true });
});

test("with no token a reader is sent elsewhere and anyone else is drawn the ordinary card", () => {
  expect(invitePageDecided({ ...bare, signedIn: true })).toStrictEqual({
    page: "Elsewhere",
    cookieCleared: false,
  });
  expect(invitePageDecided(bare)).toStrictEqual({
    page: "SignedOut",
    cookieCleared: false,
  });
});

test("a token and no session waits for a press, from the fragment or from the cookie", () => {
  expect(invitePageDecided({ ...bare, tokenKept: "kept" })).toStrictEqual({
    page: "Invited",
    token: "kept",
    cookieCleared: false,
  });
  expect(
    invitePageDecided({ ...bare, cookies: "chuggy_invite=crossed" }),
  ).toStrictEqual({ page: "Invited", token: "crossed", cookieCleared: false });
});

test("a token and a session redeems it, from the fragment or from the cookie", () => {
  expect(
    invitePageDecided({ ...bare, signedIn: true, tokenKept: "kept" }),
  ).toStrictEqual({ page: "Redeeming", token: "kept", cookieCleared: false });
  expect(
    invitePageDecided({
      ...bare,
      signedIn: true,
      cookies: "chuggy_invite=crossed",
    }),
  ).toStrictEqual({
    page: "Redeeming",
    token: "crossed",
    cookieCleared: false,
  });
});

test("the token this page was opened with is the one used, over a cookie's", () => {
  for (const signedIn of sessions)
    expect(
      invitePageDecided({
        ...bare,
        signedIn,
        tokenKept: "kept",
        cookies: "chuggy_invite=crossed",
      }),
    ).toMatchObject({ token: "kept" });
});

function redeemed(
  projects: AccessInviteLinkRedeemed["projects"],
): ApiResult<AccessInviteLinkRedeemed> {
  return { outcome: "Ok", value: { tenant: "acme", role: "Member", projects } };
}

test("a link taken sends its reader to the first project it granted, and clears the cookie", () => {
  expect(
    inviteRedemption(
      redeemed([
        { project: "beacon", roles: ["Viewer"] },
        { project: "atlas", roles: ["Admin"] },
      ]),
    ),
  ).toStrictEqual({
    outcome: "Redeemed",
    path: "/acme/beacon",
    cookieCleared: true,
  });
});

test("a link taken that granted no project sends its reader to the landing page", () => {
  expect(inviteRedemption(redeemed([]))).toStrictEqual({
    outcome: "Redeemed",
    path: "/",
    cookieCleared: true,
  });
});

test("a link the plane does not know, and a request it will not read, are not valid and clear the cookie", () => {
  for (const result of [
    { outcome: "Absent" },
    { outcome: "Rejected", code: "InvalidRequest", status: 400, body: {} },
  ] as const)
    expect(inviteRedemption(result)).toStrictEqual({
      outcome: "NotValid",
      cookieCleared: true,
    });
});

test("any other failure keeps the cookie and says its own line", () => {
  expect(
    inviteRedemption({ outcome: "Fault", code: "InternalError", status: 500 }),
  ).toMatchObject({ outcome: "Failed", cookieCleared: false });
  expect(
    inviteRedemption({ outcome: "Unreachable", reason: "no answer" }),
  ).toMatchObject({ outcome: "Failed", cookieCleared: false });
  expect(
    inviteRedemption({
      outcome: "Retryable",
      code: "Retryable",
      retryAfterSeconds: 1,
    }),
  ).toMatchObject({ outcome: "Failed", cookieCleared: false });
});
