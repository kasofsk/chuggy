/**
 * Several documents of one browser over the one stored refresh token, with no
 * browser present.
 *
 * The documents share one sign-in here, stored as a console older than the
 * sign-in's mark stored it: a token and nothing beside it. The issuer rotates
 * the refresh token on every renewal and ends the whole session when a spent
 * one is shown to it again, and its revocation is the rig's: naming the token
 * it honours ends the session, and naming one already spent is answered the
 * same and ends nothing.
 */

import { expect, test } from "vitest";

import {
  FetchJsonError,
  sessionEndedReason,
  sessionRefreshTokenKey,
  sessionRenewalLockName,
  sessionRenewalWaitMs,
} from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import { settled, sharedBrowser } from "./sessionBrowserHarness.ts";
import type { SharedBrowser } from "./sessionBrowserHarness.ts";
import {
  sessionHarness,
  sessionHarnessDiscovery as discovery,
} from "./sessionHolderHarness.ts";

const firstToken = "renew-0";

interface RotatingIssuer {
  readonly answer: (request: FormRequest | string) => Promise<unknown>;
  /** The refresh token each renewal presented, in the order they arrived. */
  readonly presented: string[];
  /** The token each revocation named. */
  readonly revoked: string[];
  /** The refresh token the issuer would still renew, none once it is ended. */
  readonly honoured: () => string | undefined;
  /** Whether a spent token was shown again, which ends the session for all. */
  readonly replayed: () => boolean;
  /** Keeps every renewal's answer from arriving until the answer is called. */
  readonly hold: () => () => void;
}

/** An issuer that decides when a renewal reaches it, whenever its answer gets
 * back: the token presented must be the live one, and is spent by being so. */
function rotatingIssuer(): RotatingIssuer {
  const base = sessionHarness().answer;
  const presented: string[] = [];
  const revoked: string[] = [];
  const spent = new Set<string>();
  const held = { live: firstToken as string | undefined, replayed: false };
  let arriving: Promise<void> = Promise.resolve();
  const renewed = (token: string): unknown => {
    if (token !== held.live) {
      if (spent.has(token))
        Object.assign(held, { live: undefined, replayed: true });
      throw new FetchJsonError(
        { fault: "Status", status: 400 },
        "the issuer answered 400",
      );
    }
    spent.add(token);
    held.live = `renew-${String(spent.size)}`;
    return {
      access_token: `access-${String(spent.size)}`,
      refresh_token: held.live,
      expires_in: 600,
    };
  };
  return {
    presented,
    revoked,
    honoured: () => held.live,
    replayed: () => held.replayed,
    hold: () => {
      let release = (): void => undefined;
      arriving = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    answer: async (request) => {
      if (typeof request === "string") return base(request);
      const form = new URLSearchParams(request.body);
      if (request.url === discovery.revocation_endpoint) {
        const named = form.get("token") ?? "";
        revoked.push(named);
        if (named === held.live) held.live = undefined;
        return {};
      }
      const token = form.get("refresh_token") ?? "";
      presented.push(token);
      let decided: () => unknown;
      try {
        const issued = renewed(token);
        decided = () => issued;
      } catch (failure: unknown) {
        decided = () => {
          throw failure;
        };
      }
      await arriving;
      return decided();
    },
  };
}

/** A browser whose store holds the one sign-in's first token. */
function rotatingBrowser(): SharedBrowser & {
  readonly issuer: RotatingIssuer;
} {
  const issuer = rotatingIssuer();
  const browser = sharedBrowser(issuer.answer);
  browser.store.held.set(sessionRefreshTokenKey, firstToken);
  return Object.assign(browser, { issuer });
}

test("a document renews with the token another has since stored, not the one it loaded with", async () => {
  const browser = rotatingBrowser();
  const older = await browser.open({ told: false });
  const newer = await browser.open({ told: false });

  expect(await newer.holder.bearer()).toBe("access-1");
  expect(await older.holder.refresh()).toBe(true);

  expect(browser.issuer.presented).toEqual([firstToken, "renew-1"]);
  expect(browser.issuer.replayed()).toBe(false);
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("renew-2");
  expect(older.holder.snapshot().phase).toBe("SignedIn");
  expect(newer.holder.snapshot().phase).toBe("SignedIn");
});

test("two documents that need a token at once take turns, and each presents a live one", async () => {
  const browser = rotatingBrowser();
  const first = await browser.open();
  const second = await browser.open();
  const release = browser.issuer.hold();

  const asked = [first.holder.bearer(), second.holder.bearer()];
  await settled();
  expect(browser.issuer.presented).toEqual([firstToken]);
  release();

  expect(await Promise.all(asked)).toEqual(["access-1", "access-2"]);
  expect(browser.issuer.presented).toEqual([firstToken, "renew-1"]);
  expect(browser.issuer.replayed()).toBe(false);
});

/** Neither document is told of the other's write, so only a store read once
 * the turn has come can present the live token. */
test("two documents that hear nothing and need a token at once each present a live one", async () => {
  const browser = rotatingBrowser();
  const first = await browser.open({ told: false });
  const second = await browser.open({ told: false });
  const release = browser.issuer.hold();

  const asked = [first.holder.bearer(), second.holder.bearer()];
  await settled();
  release();

  expect(await Promise.all(asked)).toEqual(["access-1", "access-2"]);
  expect(browser.issuer.presented).toEqual([firstToken, "renew-1"]);
  expect(browser.issuer.replayed()).toBe(false);
});

test("a renewal asks for its turn under the origin's one name, and says how long it will wait", async () => {
  const browser = rotatingBrowser();
  const only = await browser.open();

  expect(await only.holder.refresh()).toBe(true);

  expect(browser.turns).toEqual([
    { name: sessionRenewalLockName, waitMs: sessionRenewalWaitMs },
  ]);
});

test("a sign-out in one document ends the session in the other, which asks the issuer nothing", async () => {
  const browser = rotatingBrowser();
  const kept = await browser.open();
  const left = await browser.open();
  expect(await kept.holder.bearer()).toBe("access-1");

  await left.holder.signOut();

  expect(kept.holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: undefined,
  });
  expect(await kept.holder.bearer()).toBeUndefined();
  expect(browser.issuer.presented).toEqual([firstToken]);
});

test("a document that heard nothing finds the session ended when it next renews, and presents nothing", async () => {
  const browser = rotatingBrowser();
  const kept = await browser.open({ told: false });
  const left = await browser.open();

  await left.holder.signOut();
  expect(kept.holder.snapshot().phase).toBe("SignedIn");

  expect(await kept.holder.refresh()).toBe(false);
  expect(kept.holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: undefined,
  });
  expect(browser.issuer.presented).toEqual([]);
});

/** A browser that queues nothing for a document it kept tells it only that it
 * is shown again, and that is when it reads the store. */
test("a document that heard nothing of a sign-out is ended as it is shown again, before it asks for anything", async () => {
  const browser = rotatingBrowser();
  const kept = await browser.open({ told: false });
  const left = await browser.open();
  await left.holder.signOut();
  expect(kept.holder.snapshot().phase).toBe("SignedIn");

  kept.shown();

  expect(kept.holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: undefined,
  });
  expect(browser.issuer.presented).toEqual([]);
});

test("signing out revokes the token the store holds, not the one this document loaded with", async () => {
  const browser = rotatingBrowser();
  const older = await browser.open({ told: false });
  const newer = await browser.open({ told: false });
  expect(await newer.holder.bearer()).toBe("access-1");

  await older.holder.signOut();

  expect(browser.issuer.revoked).toEqual(["renew-1"]);
  expect(browser.issuer.honoured()).toBeUndefined();
  expect(browser.store.held.has(sessionRefreshTokenKey)).toBe(false);
});

/** With no turn to wait for, two documents can present one token inside a
 * single round trip. The one refused is ended; what the other stored is its. */
test("a refused renewal clears the store only of the token it presented", async () => {
  const browser = rotatingBrowser();
  const renewed = await browser.open({ turn: false, told: false });
  const refused = await browser.open({ turn: false, told: false });
  const release = browser.issuer.hold();

  const asked = [renewed.holder.refresh(), refused.holder.refresh()];
  await settled();
  release();

  expect(await Promise.all(asked)).toEqual([true, false]);
  expect(refused.holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: sessionEndedReason,
  });
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("renew-1");
});

/** The sign-out named the token it held, which the renewal had already spent,
 * so the issuer still honours the one the answer brings until that is named. */
test("an answer that arrives after a sign-out is not kept, and the token it brought is revoked", async () => {
  const browser = rotatingBrowser();
  const only = await browser.open();
  const release = browser.issuer.hold();

  const renewing = only.holder.refresh();
  await settled();
  await only.holder.signOut();
  release();

  expect(await renewing).toBe(false);
  expect(only.holder.snapshot().phase).toBe("SignedOut");
  expect(browser.store.held.has(sessionRefreshTokenKey)).toBe(false);
  expect(browser.issuer.revoked).toEqual([firstToken, "renew-1"]);
  expect(browser.issuer.honoured()).toBeUndefined();
});

for (const told of [true, false]) {
  test(`a sign-out in another document while this one's renewal is at the issuer leaves nothing honoured${told ? "" : ", though this one heard nothing"}`, async () => {
    const browser = rotatingBrowser();
    const renewing = await browser.open({ told });
    const leaving = await browser.open();
    const release = browser.issuer.hold();

    const asked = renewing.holder.refresh();
    await settled();
    await leaving.holder.signOut();
    release();

    expect(await asked).toBe(false);
    expect(renewing.holder.snapshot()).toMatchObject({
      phase: "SignedOut",
      reason: undefined,
    });
    expect(browser.issuer.revoked).toEqual([firstToken, "renew-1"]);
    expect(browser.issuer.honoured()).toBeUndefined();
    expect(browser.store.held.size).toBe(0);
  });
}
