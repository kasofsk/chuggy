/**
 * The authorization this console starts at the forge, and what the callback
 * decides from what came back: a return whose state is not this tab's unspent
 * one redeems nothing.
 */

import { expect, test } from "vitest";

import {
  forgeAuthorizationOutcome,
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
import { forgeAccountProofTone } from "../app/core/tones.ts";
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

test("each account is one line, with the apps left to install", () => {
  const outcome = forgeAuthorizationOutcome({
    outcome: "Ok",
    value: {
      accounts: [
        {
          account: "kasofsk",
          accountKind: "Organization",
          proof: "Proven",
          apps: [
            { app: "portal", claim: "Claimed" },
            { app: "worker", claim: "Missing" },
          ],
        },
        {
          account: "globex",
          accountKind: "Organization",
          proof: "NotOwner",
          apps: [],
        },
        {
          account: "initech",
          accountKind: "Organization",
          proof: "Unavailable",
          apps: [],
        },
      ],
      truncated: true,
    },
  });
  expect(outcome).toStrictEqual({
    outcome: "Authorized",
    truncated: true,
    lines: [
      {
        account: "kasofsk",
        proof: "Proven",
        status: "Connected",
        install: ["worker"],
      },
      {
        account: "globex",
        proof: "NotOwner",
        status: "Not owner",
        install: [],
      },
      {
        account: "initech",
        proof: "Unavailable",
        status: "Unavailable",
        install: [],
      },
    ],
  });
  expect(forgeAccountProofTone("Proven")).toBe("pass");
  expect(forgeAccountProofTone("NotOwner")).not.toBe("pass");
  expect(forgeAccountProofTone("Unavailable")).not.toBe("pass");
});

test("a refusal is one word in place of the lines, and a dead code asks for another", () => {
  const status = (
    result: Parameters<typeof forgeAuthorizationOutcome>[0],
  ): readonly [string, string] | undefined => {
    const outcome = forgeAuthorizationOutcome(result);
    return outcome.outcome === "Authorized"
      ? undefined
      : [outcome.outcome, outcome.status];
  };
  expect(
    status({
      outcome: "Rejected",
      code: "AuthorizationRefused",
      status: 422,
      body: undefined,
    }),
  ).toStrictEqual(["Again", "Refused"]);
  expect(
    status({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toStrictEqual(["Refused", "Refused"]);
  expect(
    status({ outcome: "Fault", code: "AuthorizationSpent", status: 502 }),
  ).toStrictEqual(["Again", "Start again"]);
  expect(
    status({ outcome: "Fault", code: "InternalError", status: 500 }),
  ).toStrictEqual(["Refused", "Failed"]);
  expect(status({ outcome: "Absent" })).toStrictEqual(["Refused", "Not found"]);
  expect(
    status({
      outcome: "Retryable",
      code: "ForgeUnavailable",
      retryAfterSeconds: 5,
    }),
  ).toStrictEqual(["Refused", "Unavailable"]);
});
