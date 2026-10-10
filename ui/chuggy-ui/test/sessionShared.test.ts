/**
 * Several documents of one browser over the one stored refresh token, with no
 * browser present.
 *
 * Each document is a holder of its own with a clock of its own. What they
 * share is the store, the turn a renewal is taken under, and an issuer that
 * rotates the refresh token on every renewal and ends the whole session when a
 * spent one is shown to it again.
 */

import { expect, test } from "vitest";

import {
  FetchJsonError,
  createSessionHolder,
  sessionEndedReason,
  sessionRefreshTokenKey,
} from "../app/core/sessionHolder.ts";
import type {
  KeyValuePort,
  SessionHolder,
  SessionHolderPorts,
} from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import { keyValueDouble } from "./keyValueDouble.ts";
import type { HeldStore } from "./keyValueDouble.ts";
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
        revoked.push(form.get("token") ?? "");
        held.live = undefined;
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

interface SharedDocument {
  readonly holder: SessionHolder;
}

interface SharedBrowser {
  readonly issuer: RotatingIssuer;
  readonly store: HeldStore;
  /** A document, loaded. One that is not `told` hears nothing of what the
   * others store, as one kept in the back-forward cache hears nothing; one
   * with no `turn` renews without waiting for any other. */
  readonly open: (options?: {
    readonly told?: boolean;
    readonly turn?: boolean;
  }) => Promise<SharedDocument>;
}

function sharedBrowser(): SharedBrowser {
  const issuer = rotatingIssuer();
  const store = keyValueDouble();
  store.held.set(sessionRefreshTokenKey, firstToken);
  const hearing = new Map<number, () => void>();
  let turns: Promise<void> = Promise.resolve();
  const exclusive: NonNullable<SessionHolderPorts["exclusive"]> = (
    _name,
    _waitMs,
    body,
  ) => {
    const taken = turns.then(body);
    turns = taken.then(
      () => undefined,
      () => undefined,
    );
    return taken;
  };
  /** The store as one document writes it: the others are told of a change,
   * and the writer is not, which is how a browser tells them. */
  const storeOf = (document: number): KeyValuePort => {
    const changed = (): void => {
      for (const [other, heard] of hearing) if (other !== document) heard();
    };
    return {
      read: store.read,
      write: (key, value) => {
        if (store.read(key) === value) return;
        store.write(key, value);
        changed();
      },
      remove: (key) => {
        if (store.read(key) === null) return;
        store.remove(key);
        changed();
      },
    };
  };
  return {
    issuer,
    store,
    open: async (options = {}) => {
      const document = hearing.size;
      const harness = sessionHarness();
      harness.answer = issuer.answer;
      const holder = createSessionHolder({
        ...harness.ports,
        persistent: storeOf(document),
        ...(options.turn === false ? {} : { exclusive }),
        storedHeard: (heard) => {
          hearing.set(
            document,
            options.told === false ? () => undefined : heard,
          );
        },
      });
      await holder.load();
      return { holder };
    },
  };
}

/** Lets everything already able to run do so, and nothing held arrive. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a document renews with the token another has since stored, not the one it loaded with", async () => {
  const browser = sharedBrowser();
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
  const browser = sharedBrowser();
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

test("a sign-out in one document ends the session in the other, which asks the issuer nothing", async () => {
  const browser = sharedBrowser();
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
  const browser = sharedBrowser();
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

test("signing out revokes the token the store holds, not the one this document loaded with", async () => {
  const browser = sharedBrowser();
  const older = await browser.open({ told: false });
  const newer = await browser.open({ told: false });
  expect(await newer.holder.bearer()).toBe("access-1");

  await older.holder.signOut();

  expect(browser.issuer.revoked).toEqual(["renew-1"]);
  expect(browser.store.held.has(sessionRefreshTokenKey)).toBe(false);
});

/** With no turn to wait for, two documents can present one token inside a
 * single round trip. The one refused is ended; what the other stored is its. */
test("a refused renewal clears the store only of the token it presented", async () => {
  const browser = sharedBrowser();
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

test("an answer that arrives after a sign-out does not sign the document back in", async () => {
  const browser = sharedBrowser();
  const only = await browser.open();
  const release = browser.issuer.hold();

  const renewing = only.holder.refresh();
  await settled();
  await only.holder.signOut();
  release();

  expect(await renewing).toBe(false);
  expect(only.holder.snapshot().phase).toBe("SignedOut");
  expect(browser.store.held.has(sessionRefreshTokenKey)).toBe(false);
});
