/**
 * More than one sign-in in one browser, with no browser present.
 *
 * A document is one sign-in's for its whole life: it follows the store through
 * a renewal of that sign-in, and ends where the store comes to hold another.
 * The issuer here keeps a session per sign-in, each named for whose it is, so
 * a case can say whose token a document would send, whose it presented and
 * whose is still honoured. A sign-in is pressed in one document and completed
 * by the one the issuer's redirect loads in the same tab, which is told the
 * address it was loaded at.
 */

import { expect, test } from "vitest";

import {
  FetchJsonError,
  createSessionHolder,
  sessionChangedReason,
  sessionRefreshTokenKey,
  sessionSignInKey,
  sessionTransactionKey,
} from "../app/core/sessionHolder.ts";
import type { SessionLocation } from "../app/core/sessionHolder.ts";
import { setupTokenStore } from "../app/core/setupStore.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import { keyValueDouble } from "./keyValueDouble.ts";
import type { HeldStore } from "./keyValueDouble.ts";
import { settled, sharedBrowser } from "./sessionBrowserHarness.ts";
import type { SharedBrowser, SharedDocument } from "./sessionBrowserHarness.ts";
import {
  sessionHarness,
  sessionHarnessConfiguration as configuration,
  sessionHarnessDiscovery as discovery,
} from "./sessionHolderHarness.ts";

type Asked = "Renewal" | "Exchange";

interface SignInIssuer {
  readonly answer: (request: FormRequest | string) => Promise<unknown>;
  /** Who the next code is exchanged for. */
  subject: string;
  /** Whether a code is exchanged for a refresh token as well. */
  renewable: boolean;
  /** The refresh token each renewal presented, in the order they arrived. */
  readonly presented: string[];
  /** The token each revocation named. */
  readonly revoked: string[];
  /** Every refresh token still honoured, and whose it is. */
  readonly honoured: () => Record<string, string>;
  /** A sign-in made before the case began: its refresh token, honoured. */
  readonly seeded: (subject: string) => string;
  /** Keeps every answer of one kind from arriving until the answer is called. */
  readonly hold: (asked: Asked) => () => void;
}

/** The sessions an issuer keeps: which refresh tokens it honours, whose each
 * is, and which were spent by a renewal. */
function signInSessions() {
  const live = new Map<string, { subject: string; session: number }>();
  const spent = new Map<string, number>();
  const count = { issued: 0, sessions: 0 };
  const issue = (subject: string, session: number): unknown => {
    count.issued += 1;
    const refresh = `${subject}-renew-${String(count.issued)}`;
    live.set(refresh, { subject, session });
    return {
      access_token: `${subject}-access-${String(count.issued)}`,
      refresh_token: refresh,
      expires_in: 600,
    };
  };
  const ended = (session: number | undefined): void => {
    for (const [token, of] of live)
      if (of.session === session) live.delete(token);
  };
  return {
    live,
    last: () => count.issued,
    opened: (subject: string): unknown => {
      count.sessions += 1;
      return issue(subject, count.sessions);
    },
    /** An access token and nothing to renew it by. */
    lent: (subject: string): unknown => {
      count.issued += 1;
      return {
        access_token: `${subject}-access-${String(count.issued)}`,
        expires_in: 600,
      };
    },
    /** Naming a token it honours ends that session; any other ends nothing. */
    revoked: (token: string): void => {
      ended(live.get(token)?.session);
    },
    /** A spent token shown again ends its session, and brings nothing. */
    renewed: (token: string): unknown => {
      const of = live.get(token);
      if (of === undefined) {
        ended(spent.get(token));
        return undefined;
      }
      live.delete(token);
      spent.set(token, of.session);
      return issue(of.subject, of.session);
    },
  };
}

/**
 * An issuer with a session per sign-in. It decides a request as it arrives,
 * whenever the answer gets back, and its revocation is the rig's: naming a
 * token it honours ends that session, and naming a spent one ends nothing.
 */
function signInIssuer(): SignInIssuer {
  const base = sessionHarness().answer;
  const sessions = signInSessions();
  const arriving: Record<Asked, Promise<void>> = {
    Renewal: Promise.resolve(),
    Exchange: Promise.resolve(),
  };
  const held: SignInIssuer = {
    subject: "nobody",
    renewable: true,
    presented: [],
    revoked: [],
    honoured: () =>
      Object.fromEntries(
        [...sessions.live].map(([token, of]) => [token, of.subject]),
      ),
    seeded: (subject) => {
      sessions.opened(subject);
      return `${subject}-renew-${String(sessions.last())}`;
    },
    hold: (asked) => {
      let release = (): void => undefined;
      arriving[asked] = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    answer: async (request) => {
      if (typeof request === "string") return base(request);
      const form = new URLSearchParams(request.body);
      if (request.url === discovery.revocation_endpoint) {
        held.revoked.push(form.get("token") ?? "");
        sessions.revoked(form.get("token") ?? "");
        return {};
      }
      if (form.get("grant_type") === "authorization_code") {
        const issued = held.renewable
          ? sessions.opened(held.subject)
          : sessions.lent(held.subject);
        await arriving.Exchange;
        return issued;
      }
      const token = form.get("refresh_token") ?? "";
      held.presented.push(token);
      const issued = sessions.renewed(token);
      await arriving.Renewal;
      if (issued === undefined)
        throw new FetchJsonError(
          { fault: "Status", status: 400 },
          "the issuer answered 400",
        );
      return issued;
    },
  };
  return held;
}

function signIns(): SharedBrowser & { readonly issuer: SignInIssuer } {
  const issuer = signInIssuer();
  return Object.assign(sharedBrowser(issuer.answer), { issuer });
}

const callbackPath = new URL(configuration.redirectUri).pathname;

/** Presses Sign in in `from`, and answers the address the issuer sends the
 * tab back to once it has signed `subject` in. */
async function pressed(
  browser: { readonly issuer: SignInIssuer },
  from: SharedDocument,
  subject: string,
): Promise<SessionLocation> {
  browser.issuer.subject = subject;
  await from.holder.signIn();
  const state = new URL(from.redirects.at(-1) ?? "").searchParams.get("state");
  return {
    pathname: callbackPath,
    search: `?code=granted&state=${String(state)}`,
  };
}

/** A sign-in pressed in `from`, a document of the tab whose store is `tab`,
 * and completed as `subject` by the document the redirect loads there. */
async function signedIn(
  browser: SharedBrowser & { readonly issuer: SignInIssuer },
  from: SharedDocument,
  tab: HeldStore,
  subject: string,
): Promise<SharedDocument> {
  const at = await pressed(browser, from, subject);
  const landed = await browser.open({ transient: tab, at });
  expect((await landed.holder.completeCallback(at)).result).toBe("SignedIn");
  return landed;
}

/** Alice signed in in one tab; another, which showed the signed-out card
 * since before she did, is then signed in as Bob. Nobody signs out. */
async function aliceThenBobElsewhere(options: { readonly told: boolean }) {
  const browser = signIns();
  const hers = keyValueDouble();
  const his = keyValueDouble();
  const stale = await browser.open({ transient: his });
  const first = await browser.open({ transient: hers });
  const at = await pressed(browser, first, "alice");
  const alice = await browser.open({ ...options, transient: hers, at });
  await alice.holder.completeCallback(at);
  expect(await alice.holder.bearer()).toBe("alice-access-1");
  const bob = await signedIn(browser, stale, his, "bob");
  return { browser, alice, bob };
}

const changed = { phase: "SignedOut", reason: sessionChangedReason };

test("a document ends where another tab signs in, and from then sends, presents and revokes nothing", async () => {
  const { browser, alice, bob } = await aliceThenBobElsewhere({ told: true });

  expect(alice.holder.snapshot()).toMatchObject(changed);
  expect(await alice.holder.bearer()).toBeUndefined();
  alice.clock.nowMs += 600_000;
  expect(await alice.holder.refresh()).toBe(false);
  await alice.holder.signOut();

  expect(browser.issuer.presented).toEqual([]);
  expect(browser.issuer.revoked).toEqual([]);
  expect(browser.issuer.honoured()).toEqual({
    "alice-renew-1": "alice",
    "bob-renew-2": "bob",
  });
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
  expect(await bob.holder.bearer()).toBe("bob-access-2");
});

test("a document that heard nothing of the other sign-in ends when its renewal falls due, having presented nothing", async () => {
  const { browser, alice } = await aliceThenBobElsewhere({ told: false });
  expect(await alice.holder.bearer()).toBe("alice-access-1");

  alice.clock.nowMs += 600_000;
  expect(await alice.holder.bearer()).toBeUndefined();

  expect(alice.holder.snapshot()).toMatchObject(changed);
  expect(browser.issuer.presented).toEqual([]);
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
});

test("Sign out pressed in a document that heard nothing of the other sign-in revokes nothing and leaves the store", async () => {
  const { browser, alice, bob } = await aliceThenBobElsewhere({ told: false });

  await alice.holder.signOut();

  expect(alice.holder.snapshot()).toMatchObject(changed);
  expect(browser.issuer.revoked).toEqual([]);
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
  expect(bob.holder.snapshot().phase).toBe("SignedIn");
});

/** The store is empty for a moment between the two, which a kept document
 * never sees: it is shown the store as it is by then. Its session is one a
 * console older than the mark stored, a token with nothing beside it. */
test("a document kept through a sign-out and another sign-in ends as it is shown again", async () => {
  const browser = signIns();
  const tab = keyValueDouble();
  browser.store.held.set(
    sessionRefreshTokenKey,
    browser.issuer.seeded("alice"),
  );
  const kept = await browser.open({ told: false });
  expect(await kept.holder.bearer()).toBe("alice-access-2");
  const later = await browser.open({ transient: tab });
  await later.holder.signOut();
  expect(browser.issuer.honoured()).toEqual({});
  await signedIn(browser, later, tab, "bob");

  kept.shown();

  expect(kept.holder.snapshot()).toMatchObject(changed);
  expect(await kept.holder.bearer()).toBeUndefined();
  kept.clock.nowMs += 600_000;
  expect(await kept.holder.bearer()).toBeUndefined();
  expect(browser.issuer.presented).toEqual(["alice-renew-1"]);
});

/** What another process stores arrives a write at a time, so a document can
 * read the store between a sign-in's two. */
test("a document that reads the store between another sign-in's mark and its token ends there", async () => {
  const { browser, alice } = await aliceThenBobElsewhere({ told: false });
  const bobs = browser.store.held.get(sessionRefreshTokenKey) ?? "";
  browser.store.held.set(sessionRefreshTokenKey, "alice-renew-1");

  alice.shown();
  expect(alice.holder.snapshot()).toMatchObject(changed);
  browser.store.held.set(sessionRefreshTokenKey, bobs);
  alice.shown();

  expect(alice.holder.snapshot()).toMatchObject(changed);
  expect(await alice.holder.bearer()).toBeUndefined();
});

/** Nothing holds a store still between two reads of it, so the order a
 * document reads in is what keeps it from Bob's token under Alice's mark. */
test("a document reading the store as another sign-in is written to it does not follow that sign-in's token", async () => {
  const browser = signIns();
  const tab = keyValueDouble();
  const alice = await signedIn(
    browser,
    await browser.open({ transient: tab }),
    tab,
    "alice",
  );
  let reads = 0;
  browser.beforeRead = () => {
    reads += 1;
    if (reads !== 2) return;
    browser.store.held.set(sessionSignInKey, "another sign-in's");
    browser.store.held.set(sessionRefreshTokenKey, "and its token");
  };

  alice.shown();

  expect(reads).toBe(2);
  expect(alice.holder.snapshot()).toMatchObject(changed);
  expect(await alice.holder.bearer()).toBeUndefined();
});

test("a sign-in stores its mark before its token, and a sign-out removes the token before the mark", async () => {
  const browser = signIns();
  const tab = keyValueDouble();
  const alice = await signedIn(
    browser,
    await browser.open({ transient: tab }),
    tab,
    "alice",
  );
  expect(browser.stored).toEqual([sessionSignInKey, sessionRefreshTokenKey]);

  await alice.holder.signOut();

  expect(browser.stored.slice(2)).toEqual([
    sessionRefreshTokenKey,
    sessionSignInKey,
  ]);
  expect(browser.store.held.size).toBe(0);
});

test("every sign-in draws a mark of its own, and a renewal leaves the one it found", async () => {
  const browser = signIns();
  const tab = keyValueDouble();
  const alice = await signedIn(
    browser,
    await browser.open({ transient: tab }),
    tab,
    "alice",
  );
  const hers = browser.store.held.get(sessionSignInKey);
  expect(hers).toBeDefined();

  expect(await alice.holder.refresh()).toBe(true);
  expect(browser.store.held.get(sessionSignInKey)).toBe(hers);
  const other = await browser.open({ transient: tab });
  expect(await other.holder.refresh()).toBe(true);
  expect(alice.holder.snapshot().phase).toBe("SignedIn");
  expect(await alice.holder.refresh()).toBe(true);
  expect(browser.issuer.presented).toEqual([
    "alice-renew-1",
    "alice-renew-2",
    "alice-renew-3",
  ]);

  await alice.holder.signOut();
  await signedIn(browser, alice, tab, "alice");
  expect(browser.store.held.get(sessionSignInKey)).not.toBe(hers);
});

/** The tab pressed Sign in while it showed the signed-out card, and by the
 * time the issuer sent it back the store held Alice's session from another. */
async function redirectedOverAlice() {
  const browser = signIns();
  const tab = keyValueDouble();
  const stale = await browser.open({ transient: tab });
  const alices = browser.issuer.seeded("alice");
  browser.store.held.set(sessionRefreshTokenKey, alices);
  const at = await pressed(browser, stale, "bob");
  return { browser, tab, at, alices };
}

test("a document the redirect brought back is nobody's until its own sign-in has answered", async () => {
  const { browser, tab, at } = await redirectedOverAlice();
  const release = browser.issuer.hold("Exchange");

  const landed = await browser.open({ transient: tab, at });
  const completing = landed.holder.completeCallback(at);
  await settled();
  expect(landed.holder.snapshot().phase).toBe("Loading");
  expect(await landed.holder.bearer()).toBeUndefined();
  expect(await landed.holder.refresh()).toBe(false);
  expect(browser.issuer.presented).toEqual([]);
  release();

  expect((await completing).result).toBe("SignedIn");
  expect(await landed.holder.bearer()).toBe("bob-access-2");
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
  expect(browser.issuer.presented).toEqual([]);
});

/** A document whose renewal of the stored session is at the issuer as its
 * own sign-in is answered, and is answered after it. A holder that is not told
 * its address holds the stored session at once, as the terminal's does, so
 * both can be asked. */
async function signedInOverItsRenewal(
  browser: SharedBrowser & { readonly issuer: SignInIssuer },
  tab: HeldStore,
  at: SessionLocation,
): Promise<SharedDocument> {
  const landed = await browser.open({ transient: tab });
  const release = browser.issuer.hold("Renewal");
  const renewing = landed.holder.refresh();
  await settled();
  expect((await landed.holder.completeCallback(at)).result).toBe("SignedIn");
  release();
  expect(await renewing).toBe(false);
  return landed;
}

test("a renewal answered after a sign-in replaced its session changes nothing, and what it brought is revoked", async () => {
  const { browser, tab, at, alices } = await redirectedOverAlice();

  const landed = await signedInOverItsRenewal(browser, tab, at);

  expect(await landed.holder.bearer()).toBe("bob-access-3");
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-3");
  expect(browser.issuer.presented).toEqual([alices]);
  expect(browser.issuer.revoked).toEqual(["alice-renew-2"]);
  expect(browser.issuer.honoured()).toEqual({ "bob-renew-3": "bob" });
});

test("a sign-in answered after a renewal of the session it replaces is the one then held", async () => {
  const { browser, tab, at, alices } = await redirectedOverAlice();
  const landed = await browser.open({ transient: tab });
  const release = browser.issuer.hold("Exchange");

  const completing = landed.holder.completeCallback(at);
  await settled();
  expect(await landed.holder.refresh()).toBe(true);
  release();

  expect((await completing).result).toBe("SignedIn");
  expect(await landed.holder.bearer()).toBe("bob-access-2");
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
  expect(browser.issuer.presented).toEqual([alices]);
});

test("a refusal answered after a sign-in replaced its session does not end the new one", async () => {
  const { browser, tab, at } = await redirectedOverAlice();
  browser.store.held.set(sessionRefreshTokenKey, "not-honoured");

  const landed = await signedInOverItsRenewal(browser, tab, at);

  expect(landed.holder.snapshot()).toMatchObject({
    phase: "SignedIn",
    reason: undefined,
  });
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-2");
});

test("a sign-in the issuer declined leaves the document the stored session, once it has said so", async () => {
  const { browser, tab, alices } = await redirectedOverAlice();
  const at = { pathname: callbackPath, search: "?error=access_denied" };

  const landed = await browser.open({ transient: tab, at });
  expect(landed.holder.snapshot().phase).toBe("Loading");
  expect((await landed.holder.completeCallback(at)).result).toBe("Denied");

  expect(landed.holder.snapshot().phase).toBe("SignedIn");
  expect(await landed.holder.bearer()).toBe("alice-access-2");
  expect(browser.issuer.presented).toEqual([alices]);
});

test("a callback address the tab began no sign-in for loads the stored session at once", async () => {
  const { browser, at, alices } = await redirectedOverAlice();

  const replayed = await browser.open({ transient: keyValueDouble(), at });

  expect(replayed.holder.snapshot().phase).toBe("SignedIn");
  expect((await replayed.holder.completeCallback(at)).result).toBe("Denied");
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe(alices);
});

/** Such a sign-in has nothing to keep in the store, and what the store held
 * was another sign-in's, so it is emptied and nothing of it is used. */
test("a sign-in sent no refresh token holds its own access token, and nothing of the session it replaced", async () => {
  const { browser, tab, at } = await redirectedOverAlice();
  const landed = await browser.open({ transient: tab });
  browser.issuer.renewable = false;

  expect((await landed.holder.completeCallback(at)).result).toBe("SignedIn");

  expect(await landed.holder.bearer()).toBe("bob-access-2");
  expect(browser.stored).toEqual([sessionRefreshTokenKey]);
  expect(browser.store.held.size).toBe(0);
  landed.clock.nowMs += 600_000;
  expect(await landed.holder.bearer()).toBeUndefined();
  expect(browser.issuer.presented).toEqual([]);
});

test("an address that answers no sign-in loads the stored session at once, though the tab began one", async () => {
  const { browser, tab } = await redirectedOverAlice();
  const at = { pathname: "/projects", search: "?code=theirs&state=theirs" };

  const elsewhere = await browser.open({ transient: tab, at });

  expect(elsewhere.holder.snapshot().phase).toBe("SignedIn");
  expect((await elsewhere.holder.completeCallback(at)).result).toBe("None");
  expect(tab.held.has(sessionTransactionKey)).toBe(true);
});

test("a callback answered a second time in the same document changes nothing of the sign-in it completed", async () => {
  const { browser, tab, at } = await redirectedOverAlice();
  const landed = await browser.open({ transient: tab, at });
  expect((await landed.holder.completeCallback(at)).result).toBe("SignedIn");

  expect((await landed.holder.completeCallback(at)).result).toBe("Denied");

  expect(await landed.holder.bearer()).toBe("bob-access-2");
  expect(browser.issuer.presented).toEqual([]);
});

/** The document heard nothing, so what tells it of the other sign-in is the
 * store it reads again as its own answer arrives. */
test("a refusal answered after another tab signed in ends the document as changed, and leaves the store", async () => {
  const browser = signIns();
  const tab = keyValueDouble();
  const stale = await browser.open({ transient: tab });
  browser.store.held.set(sessionRefreshTokenKey, "not-honoured");
  const kept = await browser.open({ told: false });
  const release = browser.issuer.hold("Renewal");

  const renewing = kept.holder.refresh();
  await settled();
  await signedIn(browser, stale, tab, "bob");
  release();

  expect(await renewing).toBe(false);
  expect(kept.holder.snapshot()).toMatchObject(changed);
  expect(browser.store.held.get(sessionRefreshTokenKey)).toBe("bob-renew-1");
  expect(browser.store.held.has(sessionSignInKey)).toBe(true);
});

/** The terminal's store is a file with room for the token and nothing else,
 * so the mark of a sign-in made over it is none. */
test("a store that keeps the token and no mark holds a sign-in through its renewals and its sign-out", async () => {
  const issuer = signInIssuer();
  const harness = sessionHarness();
  harness.answer = issuer.answer;
  const texts = new Map<string, string>();
  const store = setupTokenStore(
    {
      read: (file) => texts.get(file),
      write: (file, text) => texts.set(file, text),
      remove: (file) => texts.delete(file),
      sweep: () => undefined,
    },
    "https://chuggy.example",
    undefined,
  );
  const holder = createSessionHolder({ ...harness.ports, persistent: store });
  await holder.load();
  issuer.subject = "alice";
  await holder.signIn();
  const state = new URL(harness.redirects[0] ?? "").searchParams.get("state");
  const at = {
    pathname: callbackPath,
    search: `?code=granted&state=${String(state)}`,
  };
  expect((await holder.completeCallback(at)).result).toBe("SignedIn");

  expect(await holder.refresh()).toBe(true);
  expect(await holder.refresh()).toBe(true);
  expect(holder.snapshot().phase).toBe("SignedIn");
  expect(store.read(sessionRefreshTokenKey)).toBe("alice-renew-3");
  await holder.signOut();

  expect(issuer.revoked).toEqual(["alice-renew-3"]);
  expect(store.read(sessionRefreshTokenKey)).toBeNull();
});
