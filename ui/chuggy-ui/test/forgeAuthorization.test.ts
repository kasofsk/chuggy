/**
 * The authorization this console starts at the forge, what the callback
 * decides from what came back, and the install or the word a redemption comes
 * to: a return whose state is not this tab's unspent one redeems nothing.
 */

import { expect, test } from "vitest";

import type { ForgeAuthorizationResponse } from "../../../src/contract/responses.ts";
import type {
  ForgeAppClaimName,
  ForgeAppName,
} from "../../../src/contract/rosters.ts";
import {
  forgeAuthorizationInstall,
  forgeAuthorizationWord,
  forgeAuthorizeBegin,
  forgeAuthorizeTake,
  forgeAuthorizeTransactionKey,
  forgeCallbackDecision,
  forgeCallbackQueryOf,
  forgeCallbackRedirectUri,
  forgeCallbackRoutePath,
} from "../app/core/forgeAuthorization.ts";
import type { ForgeAuthorizeTransaction } from "../app/core/forgeAuthorization.ts";
import type { ForgePress } from "../app/core/forgePress.ts";
import { pkceChallengeFromVerifier } from "../app/core/pkce.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const target: ForgePress = {
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: ["portal"],
};

/** A digest that is not SHA-256, so a challenge equal to the verifier fails. */
async function digest(message: Uint8Array): Promise<Uint8Array> {
  return Promise.resolve(message.slice().reverse());
}

let drawn = 0;
function drawBytes(count: number): Uint8Array {
  drawn += 1;
  return new Uint8Array(count).fill(drawn);
}

async function begun(): Promise<{
  readonly url: URL;
  readonly stored: ForgeAuthorizeTransaction;
}> {
  const transient = keyValueDouble();
  const url = new URL(
    await forgeAuthorizeBegin(
      { drawBytes, digest, transient },
      client,
      "https://console.test",
      target,
    ),
  );
  const stored = forgeAuthorizeTake(transient);
  if (stored === undefined) throw new Error("nothing was stored");
  return { url, stored };
}

test("the forge is asked for the portal client, back to this console's callback, under S256", async () => {
  const { url, stored } = await begun();
  expect(`${url.origin}${url.pathname}`).toBe(client.authorizeUrl);
  expect(url.searchParams.get("client_id")).toBe(client.clientId);
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://console.test/forge/github/callback",
  );
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe(stored.state);
  expect(url.searchParams.get("code_challenge")).toBe(
    await pkceChallengeFromVerifier(digest, stored.verifier),
  );
  expect(url.searchParams.get("code_challenge")).not.toBe(stored.verifier);
});

test("the verifier stays in the tab and the state is not the verifier", async () => {
  const { url, stored } = await begun();
  expect(url.toString()).not.toContain(stored.verifier);
  expect(stored.state).not.toBe(stored.verifier);
  expect(stored).toMatchObject(target);
});

test("the transaction is taken once", () => {
  const transient = keyValueDouble();
  transient.write(
    forgeAuthorizeTransactionKey,
    JSON.stringify({ ...target, state: "s", verifier: "v" }),
  );
  expect(forgeAuthorizeTake(transient)?.state).toBe("s");
  expect(forgeAuthorizeTake(transient)).toBeUndefined();
});

test("a stored transaction missing a field is none at all", () => {
  const transient = keyValueDouble();
  const whole = { ...target, state: "s", verifier: "v" };
  for (const field of ["verifier", "state", "tenant", "installs"] as const) {
    transient.write(
      forgeAuthorizeTransactionKey,
      JSON.stringify({ ...whole, [field]: undefined }),
    );
    expect(forgeAuthorizeTake(transient)).toBeUndefined();
  }
  transient.write(forgeAuthorizeTransactionKey, "{");
  expect(forgeAuthorizeTake(transient)).toBeUndefined();
});

const transaction: ForgeAuthorizeTransaction = {
  ...target,
  state: "a-state",
  verifier: "a-verifier",
};

test("a matching state redeems the code the forge returned", () => {
  expect(
    forgeCallbackDecision(
      forgeCallbackQueryOf({ code: "a-code", state: "a-state" }),
      transaction,
    ),
  ).toStrictEqual({ decision: "Redeem", transaction, code: "a-code" });
});

test("another tab's state, no state, or nothing stored redeems nothing", () => {
  const code = { code: "a-code" };
  for (const [query, taken] of [
    [{ ...code, state: "someone-else" }, transaction],
    [code, transaction],
    [{ ...code, state: "a-state" }, undefined],
  ] as const)
    expect(
      forgeCallbackDecision(forgeCallbackQueryOf(query), taken).decision,
    ).toBe("Unexpected");
});

test("a person who declined at the forge is told so, and a state with no code redeems nothing", () => {
  expect(
    forgeCallbackDecision(
      forgeCallbackQueryOf({ error: "access_denied", state: "a-state" }),
      transaction,
    ),
  ).toStrictEqual({ decision: "Declined", transaction });
  expect(
    forgeCallbackDecision(
      forgeCallbackQueryOf({ state: "a-state" }),
      transaction,
    ).decision,
  ).toBe("Unexpected");
  expect(
    forgeCallbackDecision(
      forgeCallbackQueryOf({ error: "access_denied", state: "elsewhere" }),
      transaction,
    ).decision,
  ).toBe("Unexpected");
});

/** The operator registers this address on the portal app; moving it breaks
 * every authorization a deployment already set up against it. */
test("the callback's address is the one the README tells an operator to set", () => {
  expect(forgeCallbackRoutePath).toBe("/forge/github/callback");
  expect(forgeCallbackRedirectUri("https://console.test")).toBe(
    "https://console.test/forge/github/callback",
  );
});

/** One account an authorization reaches, as the api answers it. */
function reached(
  account: string,
  proof: "Proven" | "NotOwner" | "Unavailable",
): ForgeAuthorizationResponse["accounts"][number] {
  return { account, accountKind: "Organization", proof, apps: [] };
}

function wordOf(
  accounts: ForgeAuthorizationResponse["accounts"],
  truncated = false,
): ReturnType<typeof forgeAuthorizationWord> {
  return forgeAuthorizationWord({
    outcome: "Ok",
    value: { accounts, truncated },
  });
}

test("an authorization that connected an account and read every one says nothing", () => {
  expect(
    wordOf([reached("kasofsk", "Proven"), reached("globex", "NotOwner")]),
  ).toBeUndefined();
});

test("reaching no account the person owns says so, and only that returns to the portal's install", () => {
  const uninstalled = { standing: "Uninstalled", status: "Not installed" };
  expect(wordOf([])).toStrictEqual(uninstalled);
  expect(wordOf([reached("globex", "NotOwner")])).toStrictEqual(uninstalled);
});

/** An account the forge could not answer for may be proven by asking again, so
 * it is not a reason to send the person to install anything. */
test("an account the forge could not answer for is a word, and no install", () => {
  const unavailable = { standing: "Unfinished", status: "Unavailable" };
  expect(wordOf([reached("initech", "Unavailable")])).toStrictEqual(
    unavailable,
  );
  expect(
    wordOf([reached("kasofsk", "Proven"), reached("initech", "Unavailable")]),
  ).toStrictEqual(unavailable);
});

test("an answer that reached more than it holds is Partial, offering the install only where it proved nothing", () => {
  expect(wordOf([reached("kasofsk", "Proven")], true)).toStrictEqual({
    standing: "Unfinished",
    status: "Partial",
  });
  expect(wordOf([], true)).toStrictEqual({
    standing: "Uninstalled",
    status: "Partial",
  });
});

test("a refusal is one failed word, a dead code's being Start again", () => {
  const status = (
    result: Parameters<typeof forgeAuthorizationWord>[0],
  ): string | undefined => {
    const word = forgeAuthorizationWord(result);
    expect(word?.standing).toBe("Failed");
    return word?.status;
  };
  expect(
    status({
      outcome: "Rejected",
      code: "AuthorizationRefused",
      status: 422,
      body: undefined,
    }),
  ).toBe("Refused");
  expect(
    status({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toBe("Refused");
  expect(
    status({ outcome: "Fault", code: "AuthorizationSpent", status: 502 }),
  ).toBe("Start again");
  expect(status({ outcome: "Fault", code: "InternalError", status: 500 })).toBe(
    "Failed",
  );
  expect(status({ outcome: "Absent" })).toBe("Not found");
  expect(
    status({
      outcome: "Retryable",
      code: "ForgeUnavailable",
      retryAfterSeconds: 5,
    }),
  ).toBe("Unavailable");
});

/** One account the person owns, with what claiming the worker app on it came to. */
function owned(
  account: string,
  worker: ForgeAppClaimName,
): ForgeAuthorizationResponse["accounts"][number] {
  return {
    account,
    accountKind: "User",
    proof: "Proven",
    apps: [
      { app: "portal", claim: "AlreadyClaimed" },
      { app: "worker", claim: worker },
    ],
  };
}

function installOf(
  accounts: ForgeAuthorizationResponse["accounts"],
  installs: readonly ForgeAppName[] = [],
  truncated = false,
): ForgeAppName | undefined {
  return forgeAuthorizationInstall(
    { outcome: "Ok", value: { accounts, truncated } },
    installs,
  );
}

test("an answer reaching no account the person owns goes on to the portal's install", () => {
  expect(installOf([])).toBe("portal");
  expect(installOf([reached("globex", "NotOwner")])).toBe("portal");
});

/** The account holding the portal app may be one the answer did not read, or
 * one the forge may yet prove. */
test("an answer that is partial, or could not prove an account, installs nothing", () => {
  expect(installOf([], [], true)).toBeUndefined();
  expect(installOf([reached("initech", "Unavailable")])).toBeUndefined();
});

test("an account claimed without the worker app goes on to the worker's install", () => {
  expect(installOf([owned("kasofsk", "Missing")])).toBe("worker");
  expect(
    installOf([owned("gdoteof", "Claimed"), owned("kasofsk", "Missing")]),
  ).toBe("worker");
});

/** A lacking account is one the answer read, so an answer that read only some
 * still names it. */
test("a partial answer that claimed an account without the worker app still goes on to its install", () => {
  expect(installOf([owned("kasofsk", "Missing")], [], true)).toBe("worker");
});

test("an account holding both apps, or a worker claim the forge could not answer, installs nothing", () => {
  for (const worker of ["Claimed", "AlreadyClaimed", "Unavailable"] as const)
    expect(installOf([owned("kasofsk", worker)])).toBeUndefined();
});

test("a press already sent on to an app's install is not sent on to it again", () => {
  expect(installOf([], ["portal"])).toBeUndefined();
  expect(installOf([owned("kasofsk", "Missing")], ["worker"])).toBeUndefined();
  expect(installOf([owned("kasofsk", "Missing")], ["portal"])).toBe("worker");
  expect(installOf([], ["worker"])).toBe("portal");
});

test("a refusal installs nothing", () => {
  const refusals: readonly Parameters<typeof forgeAuthorizationInstall>[0][] = [
    {
      outcome: "Rejected",
      code: "AuthorizationRefused",
      status: 422,
      body: undefined,
    },
    { outcome: "Absent" },
    { outcome: "Retryable", code: "ForgeUnavailable", retryAfterSeconds: 5 },
    { outcome: "Fault", code: "AuthorizationSpent", status: 502 },
    { outcome: "Unauthenticated" },
  ];
  for (const refusal of refusals)
    expect(forgeAuthorizationInstall(refusal, [])).toBeUndefined();
});
