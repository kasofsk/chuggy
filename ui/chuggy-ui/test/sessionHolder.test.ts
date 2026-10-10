/**
 * The whole sign-in, driven with no browser present.
 *
 * The ports stand in for the network, the clock, the draws, the digest, the two
 * stores and the address bar, so what is checked is the flow: what is
 * persisted, what is asked for, what a mismatched callback does, and what a
 * renewal that brought no tokens leaves — a refusal ends the session at once,
 * no answer keeps it, and an unusable one is counted against a budget.
 */

import { expect, test } from "vitest";

import { sessionRefreshFailuresMax } from "../app/core/authorization.ts";
import {
  FetchJsonError,
  createSessionHolder,
  sessionCallbackPath,
  sessionEndedReason,
  sessionLoadRetryDelayMs,
  sessionRefreshTokenKey,
  sessionTransactionKey,
  sessionUnrenewedReason,
} from "../app/core/sessionHolder.ts";
import type { FormRequest } from "../app/core/authorization.ts";
import {
  sessionHarness as harness,
  sessionHarnessConfiguration as configuration,
  sessionHarnessDiscovery as discovery,
} from "./sessionHolderHarness.ts";

/** A callback arriving at the address this client is registered with. */
function signedInAt(search: string): { pathname: string; search: string } {
  return { pathname: new URL(configuration.redirectUri).pathname, search };
}

/** What the network port rejects with when a request never got an answer. */
function unanswered(): never {
  throw new FetchJsonError({ fault: "Unanswered" }, "Failed to fetch");
}

function isDiscovery(request: FormRequest | string): boolean {
  return typeof request === "string" && request !== "/config.json";
}

function isTokenRequest(request: FormRequest | string): boolean {
  return typeof request !== "string";
}

/** What the network port rejects with when a request was answered `status`. */
function answeredWith(status: number): () => never {
  return () => {
    throw new FetchJsonError(
      { fault: "Status", status },
      `answered ${String(status)}`,
    );
  };
}

/** What a gateway answers for a server it could not reach, Cloudflare's own
 * for an origin it could not among them. */
const gatewayStatuses = [
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
] as const;

/** The harness's answers, except where `failing` names the request. */
function failingAt(
  failing: (request: FormRequest | string) => boolean,
  failure: () => never,
  answer: (request: FormRequest | string) => unknown,
): (request: FormRequest | string) => unknown {
  return (request) => (failing(request) ? failure() : answer(request));
}

test("a configuration that answered with something unusable is not configured, asked once", async () => {
  const held = harness();
  held.answer = () => {
    throw new SyntaxError("Unexpected token '<'");
  };
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unconfigured",
    reason: "/config.json answered nothing usable",
  });
  expect(held.asked).toEqual(["/config.json"]);
  expect(held.slept).toEqual([]);
});

test("a load that got no answer is asked once more after a pause, and no more", async () => {
  const held = harness();
  held.answer = unanswered;
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unreachable",
    reason: "No answer from /config.json",
  });
  expect(held.asked).toEqual(["/config.json", "/config.json"]);
  expect(held.slept).toEqual([sessionLoadRetryDelayMs]);
});

test("a load whose first ask got no answer settles on the second", async () => {
  const held = harness();
  const answered = held.answer;
  held.answer = failingAt(() => held.asked.length === 1, unanswered, answered);
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: undefined,
  });
});

/** A gateway answers for a server it could not reach, so its answer is the same
 * blip as no answer at all. */
test("a gateway's answer is unreachable and asked once more; a server's own error is not", async () => {
  for (const [status, phase, asked] of [
    ...gatewayStatuses.map((gateway) => [gateway, "Unreachable", 2] as const),
    [500, "Unconfigured", 1],
    [404, "Unconfigured", 1],
  ] as const) {
    const held = harness();
    held.answer = () => {
      throw new FetchJsonError(
        { fault: "Status", status },
        `answered ${String(status)}`,
      );
    };
    const holder = createSessionHolder(held.ports);
    await holder.load();
    expect(holder.snapshot()).toMatchObject({
      phase,
      reason: `/config.json answered ${String(status)}`,
    });
    expect(held.asked).toHaveLength(asked);
  }
});

test("an issuer that got no answer is unreachable, named by its host", async () => {
  const held = harness();
  held.answer = failingAt(isDiscovery, unanswered, held.answer);
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unreachable",
    reason: "No answer from auth.example",
  });
});

test("an issuer that answered with something unusable is named by its host, not the configuration", async () => {
  const held = harness();
  const answered = held.answer;
  held.answer = failingAt(
    isDiscovery,
    () => {
      throw new FetchJsonError(
        { fault: "Status", status: 500 },
        "answered 500",
      );
    },
    answered,
  );
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unconfigured",
    reason: "auth.example answered 500",
  });
  held.answer = (request) =>
    isDiscovery(request)
      ? { ...discovery, issuer: "https://elsewhere" }
      : answered(request);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unconfigured",
    reason: "auth.example answered nothing usable",
  });
});

/** A failure at the issuer is named by its host, so an issuer with none would
 * throw from the load rather than be drawn. */
test("a configuration whose issuer is not an absolute address is not configured", async () => {
  const held = harness();
  const answered = held.answer;
  held.answer = (request) =>
    request === "/config.json"
      ? { ...configuration, issuer: "auth.example" }
      : answered(request);
  const holder = createSessionHolder(held.ports);
  await holder.load();
  expect(holder.snapshot()).toMatchObject({
    phase: "Unconfigured",
    reason: "/config.json answered nothing usable",
  });
});

/** The code is the issuer's to redeem once, so a callback refused for want of a
 * configuration would leave the load that later succeeds nothing to sign in. */
test("a callback that arrives before the console has loaded is kept for the load that does", async () => {
  const held = harness();
  const answered = held.answer;
  const started = createSessionHolder(held.ports);
  await started.load();
  await started.signIn();
  const state = new URLSearchParams(
    new URL(held.redirects[0] ?? "").search,
  ).get("state");
  const callback = signedInAt(`?code=abc&state=${String(state)}`);
  const returned = createSessionHolder(held.ports);
  held.answer = unanswered;
  await returned.load();
  expect(await returned.completeCallback(callback)).toEqual({
    result: "None",
  });
  expect(held.transient.held.has(sessionTransactionKey)).toBe(true);
  held.answer = answered;
  await returned.load();
  expect(await returned.completeCallback(callback)).toEqual({
    result: "SignedIn",
    returnPath: undefined,
  });
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
  const answer = await holder.completeCallback(
    signedInAt("?code=abc&state=someone-else"),
  );
  expect(answer).toEqual({
    result: "Denied",
    reason: "the callback did not match this tab",
  });
  expect(held.transient.held.has(sessionTransactionKey)).toBe(false);
});

/** The forge returns its own code and state to a page of its own, which a
 * sign-in in flight must survive rather than be refused by. */
test("a code arriving anywhere but the sign-in's address is not a sign-in", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn();
  const answer = await holder.completeCallback({
    pathname: "/forge/github/callback",
    search: "?code=abc&state=forge-state",
  });
  expect(answer).toEqual({ result: "None" });
  expect(held.transient.held.has(sessionTransactionKey)).toBe(true);
  expect(held.asked.filter((asked) => typeof asked !== "string")).toEqual([]);
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
    signedInAt(`?code=abc&state=${String(state)}`),
  );
  expect(answer).toEqual({ result: "SignedIn", returnPath: undefined });
  expect(held.persistent.held.get(sessionRefreshTokenKey)).toBe("renew");
  expect([...held.persistent.held.values()]).not.toContain("access");
});

/** The issuer redirects to the one address this client is registered with, so
 * a page reached with a query it needs is come back to from the transaction. */
test("a sign-in that names a page answers that page back on the callback", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn("/forge/github/setup?installation_id=9&state=s");
  const state = new URLSearchParams(
    new URL(held.redirects[0] ?? "").search,
  ).get("state");
  const answer = await holder.completeCallback(
    signedInAt(`?code=abc&state=${String(state)}`),
  );
  expect(answer).toEqual({
    result: "SignedIn",
    returnPath: "/forge/github/setup?installation_id=9&state=s",
  });
});

/** The path is in the transaction and nowhere the issuer is given it. */
test("a named page is not sent to the authorization server", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  await holder.signIn("/forge/github/setup?installation_id=9");
  expect(held.redirects[0] ?? "").not.toContain("installation_id");
});

test("an issuer that keeps answering unusably ends the session once", async () => {
  for (const unusable of [
    answeredWith(500),
    () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  ]) {
    const held = harness();
    held.persistent.held.set(sessionRefreshTokenKey, "renew");
    const holder = createSessionHolder(held.ports);
    await holder.load();
    held.answer = unusable;
    for (let attempt = 0; attempt < sessionRefreshFailuresMax; attempt += 1)
      expect(await holder.refresh()).toBe(false);
    expect(holder.snapshot()).toMatchObject({
      phase: "SignedOut",
      reason: sessionUnrenewedReason,
    });
    expect(held.persistent.held.has(sessionRefreshTokenKey)).toBe(false);
    const spent = held.asked.length;
    expect(await holder.refresh()).toBe(false);
    expect(held.asked.length).toBe(spent);
  }
});

/** An issuer that rotates refresh tokens ends the whole session when a spent
 * one is shown to it again, so a refused token is never shown twice. */
test("a renewal the issuer refuses ends the session at once, and is not asked again", async () => {
  for (const status of [400, 401]) {
    const held = harness();
    held.persistent.held.set(sessionRefreshTokenKey, "renew");
    const holder = createSessionHolder(held.ports);
    await holder.load();
    held.answer = failingAt(isTokenRequest, answeredWith(status), held.answer);
    const asked = held.asked.length;

    expect(await holder.bearer()).toBeUndefined();
    expect(holder.snapshot()).toMatchObject({
      phase: "SignedOut",
      reason: sessionEndedReason,
    });
    expect(held.persistent.held.has(sessionRefreshTokenKey)).toBe(false);
    expect(await holder.bearer()).toBeUndefined();
    expect(held.asked.length - asked).toBe(1);
  }
});

/** No answer says nothing about the session, and neither does a gateway's
 * answer for an issuer it could not reach. */
test("a renewal that got no answer keeps the session, however often, and renews when one comes", async () => {
  for (const failure of [unanswered, ...gatewayStatuses.map(answeredWith)]) {
    const held = harness();
    held.persistent.held.set(sessionRefreshTokenKey, "renew");
    const holder = createSessionHolder(held.ports);
    await holder.load();
    const answered = held.answer;
    held.answer = failingAt(isTokenRequest, failure, answered);

    for (let attempt = 0; attempt <= sessionRefreshFailuresMax; attempt += 1)
      expect(await holder.bearer()).toBeUndefined();
    expect(holder.snapshot().phase).toBe("SignedIn");
    expect(held.persistent.held.get(sessionRefreshTokenKey)).toBe("renew");

    held.answer = answered;
    expect(await holder.bearer()).toBe("access");
  }
});

test("a refusal that arrives after a sign-out says nothing over it", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  const answered = held.answer;
  let arrive = (): void => undefined;
  const refusal = new Promise<never>((_resolve, reject) => {
    arrive = () => {
      reject(new FetchJsonError({ fault: "Status", status: 400 }, "refused"));
    };
  });
  held.answer = (request) =>
    typeof request === "object" && request.url === discovery.token_endpoint
      ? refusal
      : answered(request);

  const renewing = holder.refresh();
  await holder.signOut();
  arrive();

  expect(await renewing).toBe(false);
  expect(holder.snapshot()).toMatchObject({
    phase: "SignedOut",
    reason: undefined,
  });
});

test("a renewal whose turn does not come leaves the session as it was and asks the issuer nothing", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder({
    ...held.ports,
    exclusive: () => Promise.reject(new Error("the wait was abandoned")),
  });
  await holder.load();
  const asked = held.asked.length;

  expect(await holder.refresh()).toBe(false);
  expect(holder.snapshot().phase).toBe("SignedIn");
  expect(held.persistent.held.get(sessionRefreshTokenKey)).toBe("renew");
  expect(held.asked.length).toBe(asked);
});

/** A browser that refuses the store reads it as empty, which is then no word
 * that another document ended the session. */
test("a session the store never kept is renewed with the token the document holds", async () => {
  const held = harness();
  const holder = createSessionHolder({
    ...held.ports,
    persistent: {
      read: () => null,
      write: () => undefined,
      remove: () => undefined,
    },
  });
  await holder.load();
  await holder.signIn();
  const state = new URLSearchParams(
    new URL(held.redirects[0] ?? "").search,
  ).get("state");
  await holder.completeCallback(signedInAt(`?code=abc&state=${String(state)}`));
  const asked = held.asked.length;

  expect(await holder.refresh()).toBe(true);
  expect(holder.snapshot().phase).toBe("SignedIn");
  const renewal = held.asked[asked];
  expect(
    typeof renewal === "object"
      ? new URLSearchParams(renewal.body).get("refresh_token")
      : undefined,
  ).toBe("renew");
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

test("concurrent callers share one renewal rather than spending the token twice", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  const asked = held.asked.length;
  const tokens = await Promise.all([
    holder.bearer(),
    holder.bearer(),
    holder.bearer(),
  ]);
  const presented = held.asked
    .slice(asked)
    .filter((request) => typeof request !== "string");
  expect(presented.length).toBe(1);
  expect(tokens).toEqual(["access", "access", "access"]);
});

test("a renewal that has settled does not stop the next one from starting", async () => {
  const held = harness();
  held.persistent.held.set(sessionRefreshTokenKey, "renew");
  const holder = createSessionHolder(held.ports);
  await holder.load();
  const asked = held.asked.length;
  expect(await holder.refresh()).toBe(true);
  expect(await holder.refresh()).toBe(true);
  expect(held.asked.length - asked).toBe(2);
});

test("a sign-in the issuer refused is drawn with the reason it gave", async () => {
  const held = harness();
  const holder = createSessionHolder(held.ports);
  await holder.load();
  const answer = await holder.completeCallback(
    signedInAt("?error=access_denied&error_description=the+operator+said+no"),
  );
  expect(answer.result).toBe("Denied");
  holder.refuse(answer.result === "Denied" ? answer.reason : "");
  expect(holder.snapshot().reason).toContain("the operator said no");
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

/** The process root replaces the address with this and with nothing else, so
 * a refusal landing anywhere but the root would be a page the reader did not
 * ask for drawn over a sign-in that did not happen. */
test("the callback leaves the tab where the sign-in named, and at the root otherwise", () => {
  expect(
    sessionCallbackPath({
      result: "SignedIn",
      returnPath: "/vteng/chuggy/repositories?connected=Connected",
    }),
  ).toBe("/vteng/chuggy/repositories?connected=Connected");
  expect(
    sessionCallbackPath({ result: "SignedIn", returnPath: undefined }),
  ).toBe("/");
  expect(sessionCallbackPath({ result: "Denied", reason: "no" })).toBe("/");
});
