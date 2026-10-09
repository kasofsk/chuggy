/**
 * What the invite page holds for the life of the page: the token leaves the
 * address as the holder is made, which listens for the next by itself, a token
 * read once is kept, the cookie is written only when asked, and one token is
 * sent once without a name however often it is asked for and once with a name
 * for every time it is, with what each answer decides performed once.
 */

import { expect, test } from "vitest";

import {
  accessTenantTakenCode,
  accessWorkspaceLinkNameWantedCode,
} from "../../../src/contract/accessPlane.ts";
import type { AccessInviteLinkRedeemed } from "../../../src/contract/accessPlane.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  inviteCookieCleared,
  inviteCookieWritten,
} from "../app/core/invitePage.ts";
import { inviteBrowser as held } from "./inviteDouble.ts";

test("a token arriving in the fragment is kept and leaves the address at once", () => {
  const { browser, holder } = held({ anchor: "t0ken" });
  expect(browser.replaced).toStrictEqual(["/invite"]);
  expect(holder.opened(false)).toMatchObject({
    page: "Invited",
    token: "t0ken",
  });
  expect(browser.written).toStrictEqual([]);
});

test("the address keeps its query when the fragment leaves it", () => {
  const { browser } = held({ anchor: "t0ken", search: "?flow=f-1" });
  expect(browser.replaced).toStrictEqual(["/invite?flow=f-1"]);
});

test("a fragment at any other address is not the invite page's to take", () => {
  const { browser, holder } = held({
    pathname: "/acme/atlas",
    anchor: "t0ken",
  });
  expect(browser.replaced).toStrictEqual([]);
  browser.pathname = "/invite";
  expect(holder.opened(false)).toMatchObject({ page: "SignedOut" });
});

test("an address with no fragment is left as it is", () => {
  const { browser, holder } = held({});
  expect(browser.replaced).toStrictEqual([]);
  expect(holder.opened(true)).toMatchObject({ page: "Elsewhere" });
});

test("a fragment that is no token still leaves the address, and nothing is kept", () => {
  const { browser, holder } = held({ anchor: "t".repeat(4096) });
  expect(browser.replaced).toStrictEqual(["/invite"]);
  expect(holder.opened(false)).toMatchObject({ page: "SignedOut" });
});

test("a link opened in a tab already at the page loads the document again, and takes nothing from the page it leaves", () => {
  const { browser, holder } = held({ anchor: "first" });
  browser.anchored("second");
  expect(browser.reloads).toBe(1);
  expect(browser.replaced).toStrictEqual(["/invite"]);
  expect(holder.opened(true)).toMatchObject({ token: "first" });
});

test("a fragment that changes at any other address loads nothing", () => {
  const { browser } = held({ pathname: "/acme/atlas" });
  browser.anchored("s");
  expect(browser.reloads).toBe(0);
});

test("a fragment taken away from the page's address loads nothing", () => {
  const { browser } = held({ anchor: "first" });
  browser.anchored("");
  expect(browser.reloads).toBe(0);
});

test("a token read from the cookie is kept once the cookie is gone", () => {
  const { browser, holder } = held({ cookies: "chuggy_invite=crossed" });
  expect(holder.opened(true)).toMatchObject({
    page: "Redeeming",
    token: "crossed",
  });
  browser.cookies = "";
  expect(holder.opened(true)).toMatchObject({
    page: "Redeeming",
    token: "crossed",
  });
});

test("the cookie is written when the page is left for a sign-in, and by nothing before it", () => {
  const { browser, holder } = held({ anchor: "t0ken" });
  holder.opened(false);
  expect(browser.written).toStrictEqual([]);
  holder.leave("t0ken", "example.com");
  expect(browser.written).toStrictEqual([
    inviteCookieWritten("t0ken", "example.com"),
  ]);
});

function sender(answer: ApiResult<AccessInviteLinkRedeemed>): {
  readonly sent: string[];
  readonly send: (
    token: string,
  ) => Promise<ApiResult<AccessInviteLinkRedeemed>>;
} {
  const sent: string[] = [];
  return {
    sent,
    send: (token) => {
      sent.push(token);
      return Promise.resolve(answer);
    },
  };
}

const granted: ApiResult<AccessInviteLinkRedeemed> = {
  outcome: "Ok",
  value: {
    tenant: "acme",
    role: "Member",
    projects: [{ project: "atlas", roles: ["Viewer"] }],
  },
};

test("one token is redeemed once however often it is asked for, and its answer performed once", async () => {
  const { browser, holder } = held({});
  const { sent, send } = sender(granted);
  const first = holder.redeem("t0ken", undefined, send);
  const second = holder.redeem("t0ken", undefined, send);
  expect(await first).toMatchObject({ outcome: "Redeemed" });
  expect(await second).toMatchObject({ outcome: "Redeemed" });
  expect(await holder.redeem("t0ken", undefined, send)).toMatchObject({
    outcome: "Redeemed",
  });
  expect(sent).toStrictEqual(["t0ken"]);
  expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});

test("another token is another redemption", async () => {
  const { holder } = held({});
  const { sent, send } = sender(granted);
  await holder.redeem("first", undefined, send);
  await holder.redeem("second", undefined, send);
  expect(sent).toStrictEqual(["first", "second"]);
});

test("a link that is not valid clears the cookie with the deployment's domain and sends its reader nowhere", async () => {
  const { browser, holder } = held({});
  const { send } = sender({ outcome: "Absent" });
  expect(await holder.redeem("t0ken", "example.com", send)).toMatchObject({
    outcome: "NotValid",
  });
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual([]);
});

test("a redemption that failed keeps the cookie, and is sent again only once it is retried", async () => {
  const { browser, holder } = held({});
  const { sent, send } = sender({
    outcome: "Fault",
    code: "InternalError",
    status: 500,
  });
  expect(await holder.redeem("t0ken", undefined, send)).toMatchObject({
    outcome: "Failed",
  });
  await holder.redeem("t0ken", undefined, send);
  expect(sent).toStrictEqual(["t0ken"]);
  holder.retry();
  await holder.redeem("t0ken", undefined, send);
  expect(sent).toStrictEqual(["t0ken", "t0ken"]);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
});

test("a reader with nothing to open is sent to the landing page in this entry's place", () => {
  const { browser, holder } = held({});
  holder.elsewhere();
  expect(browser.left).toStrictEqual(["/"]);
});

function conflict(code: string): ApiResult<AccessInviteLinkRedeemed> {
  return { outcome: "Conflict", code, body: {} };
}

/** A plane answering every send with a name the same way, each one kept. */
function namer(answer: ApiResult<AccessInviteLinkRedeemed>): {
  readonly sent: (readonly [string, string])[];
  readonly send: (
    token: string,
    workspace: string,
  ) => Promise<ApiResult<AccessInviteLinkRedeemed>>;
} {
  const sent: (readonly [string, string])[] = [];
  return {
    sent,
    send: (token, workspace) => {
      sent.push([token, workspace]);
      return Promise.resolve(answer);
    },
  };
}

const made: ApiResult<AccessInviteLinkRedeemed> = {
  outcome: "Ok",
  value: { tenant: "northwind", role: "Admin", projects: [] },
};

test("a link that asks for its workspace's name keeps the cookie and sends its reader nowhere", async () => {
  const { browser, holder } = held({});
  const { send } = sender(conflict(accessWorkspaceLinkNameWantedCode));
  expect(await holder.redeem("t0ken", "example.com", send)).toMatchObject({
    outcome: "NameWanted",
  });
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
});

test("a name is sent every time it is asked for, and the answer that asked for it stays held", async () => {
  const { browser, holder } = held({});
  const wanted = sender(conflict(accessWorkspaceLinkNameWantedCode));
  await holder.redeem("t0ken", undefined, wanted.send);
  const taken = namer(conflict(accessTenantTakenCode));
  expect(
    await holder.named("t0ken", undefined, "northwind", taken.send),
  ).toMatchObject({ outcome: "Refused" });
  await holder.named("t0ken", undefined, "northwind", taken.send);
  expect(taken.sent).toStrictEqual([
    ["t0ken", "northwind"],
    ["t0ken", "northwind"],
  ]);
  expect(await holder.redeem("t0ken", undefined, wanted.send)).toMatchObject({
    outcome: "NameWanted",
  });
  expect(wanted.sent).toStrictEqual(["t0ken"]);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
});

test("a workspace made is performed once: the cookie cleared with the deployment's domain, and the reader sent to where its first project is made", async () => {
  const { browser, holder } = held({});
  const { send } = namer(made);
  expect(
    await holder.named("t0ken", "example.com", "northwind", send),
  ).toMatchObject({ outcome: "Redeemed" });
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual(["/projects/new?workspace=northwind"]);
});

test("a name sent for a link the plane no longer knows clears the cookie and sends its reader nowhere", async () => {
  const { browser, holder } = held({});
  const { send } = namer({ outcome: "Absent" });
  expect(
    await holder.named("t0ken", undefined, "northwind", send),
  ).toMatchObject({ outcome: "NotValid" });
  expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
  expect(browser.left).toStrictEqual([]);
});

test("a name that failed keeps the cookie, and a retry of it leaves the held answer where it is", async () => {
  const { browser, holder } = held({});
  const wanted = sender(conflict(accessWorkspaceLinkNameWantedCode));
  await holder.redeem("t0ken", undefined, wanted.send);
  const failing = namer({
    outcome: "Fault",
    code: "InternalError",
    status: 500,
  });
  expect(
    await holder.named("t0ken", undefined, "northwind", failing.send),
  ).toMatchObject({ outcome: "Failed" });
  await holder.named("t0ken", undefined, "northwind", failing.send);
  await holder.redeem("t0ken", undefined, wanted.send);
  expect(wanted.sent).toStrictEqual(["t0ken"]);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
});
