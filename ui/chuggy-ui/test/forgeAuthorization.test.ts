/**
 * The authorization this console starts at the forge, what the callback
 * decides from what came back, and the word a redemption returns with: a return
 * whose state is not this tab's unspent one redeems nothing.
 */

import { expect, test } from "vitest";

import type { ForgeAuthorizationResponse } from "../../../src/contract/responses.ts";
import {
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
import { pkceChallengeFromVerifier } from "../app/core/pkce.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const target = {
  tenant: "vteng",
  project: "chuggy",
  returnPath: "/vteng/chuggy/repositories",
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
  transient.write(
    forgeAuthorizeTransactionKey,
    JSON.stringify({ ...target, state: "s" }),
  );
  expect(forgeAuthorizeTake(transient)).toBeUndefined();
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
