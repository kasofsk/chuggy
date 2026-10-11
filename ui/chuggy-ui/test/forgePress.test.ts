/**
 * One press carried through both transactions, and the installs it has been
 * sent on to.
 *
 * NO SEQUENCE OF ANSWERS SENDS A PRESS ON TO ONE APP'S INSTALL TWICE. The forge
 * decides what each authorization answers and the person decides whether they
 * install anything, so the console cannot assume an install it sent somebody
 * to was made. What it can hold is its own list, and the last cases drive a
 * press through the console's own deciders and both stored transactions under
 * every sequence of answers to show the list is enough.
 */

import { expect, test } from "vitest";

import type { ForgeAuthorizationResponse } from "../../../src/contract/responses.ts";
import { forgeApps } from "../../../src/contract/rosters.ts";
import type { ForgeAppName } from "../../../src/contract/rosters.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  forgeAuthorizationInstall,
  forgeAuthorizeBegin,
  forgeAuthorizeTake,
  forgeCallbackDecision,
} from "../app/core/forgeAuthorization.ts";
import {
  forgeInstallBegin,
  forgeInstallTake,
} from "../app/core/forgeInstallation.ts";
import { forgePressOf, forgePressSentOn } from "../app/core/forgePress.ts";
import type { ForgePress } from "../app/core/forgePress.ts";
import { forgeSetupDecision } from "../app/core/forgeSetup.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const press: ForgePress = {
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: ["portal"],
};

test("a stored press is read back, and one missing a field is none at all", () => {
  expect(forgePressOf({ ...press, state: "s" })).toStrictEqual(press);
  for (const field of ["tenant", "returnPath", "installs"] as const)
    expect(forgePressOf({ ...press, [field]: undefined })).toBeUndefined();
});

/** The list is what stops a second send, so one that is not a list of this
 * deployment's apps is no press rather than a press sent nowhere yet. */
test("a list holding anything but the two apps, or one of them twice, is no press", () => {
  for (const installs of [["neither"], ["portal", "portal"], "portal", null])
    expect(forgePressOf({ ...press, installs })).toBeUndefined();
  expect(
    forgePressOf({ ...press, installs: ["worker", "portal"] })?.installs,
  ).toStrictEqual(["portal", "worker"]);
  expect(forgePressOf({ ...press, installs: [] })?.installs).toStrictEqual([]);
});

/** The press is read from the authorization's transaction, whose verifier an
 * install transaction has no business holding. */
test("a press sent on gains the app and carries nothing else of what it was read from", () => {
  const taken = { ...press, state: "a-state", verifier: "a-verifier" };
  expect(forgePressSentOn(taken, "worker")).toStrictEqual({
    ...press,
    installs: ["portal", "worker"],
  });
});

type Answer = ApiResult<ForgeAuthorizationResponse>;

function answered(
  accounts: ForgeAuthorizationResponse["accounts"],
  truncated = false,
): Answer {
  return { outcome: "Ok", value: { accounts, truncated } };
}

function owned(
  worker: "Claimed" | "Missing" | "Unavailable",
): ForgeAuthorizationResponse["accounts"][number] {
  return {
    account: "kasofsk",
    accountKind: "Organization",
    proof: "Proven",
    apps: [
      { app: "portal", claim: "Claimed" },
      { app: "worker", claim: worker },
    ],
  };
}

const notOwned: ForgeAuthorizationResponse["accounts"][number] = {
  account: "globex",
  accountKind: "Organization",
  proof: "NotOwner",
  apps: [],
};

const nothing = answered([]);
const workerless = answered([owned("Missing")]);
const connected = answered([owned("Claimed")]);

/** Every kind of answer a redemption comes to: what the forge may say of the
 * person's accounts, read whole or in part, and what the api may refuse with. */
const answers: readonly Answer[] = [
  nothing,
  answered([notOwned]),
  answered([], true),
  answered([{ ...notOwned, proof: "Unavailable" }]),
  workerless,
  answered([owned("Missing")], true),
  answered([notOwned, owned("Missing")]),
  answered([owned("Unavailable")]),
  connected,
  { outcome: "Retryable", code: "ForgeUnavailable", retryAfterSeconds: 5 },
  { outcome: "Fault", code: "AuthorizationSpent", status: 502 },
];

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const ports = {
  drawBytes: (count: number) => new Uint8Array(count).fill(1),
  digest: (message: Uint8Array) => Promise.resolve(message),
};

/** The setup landing reached with the state the install was begun under, going
 * on to the authorization, whose transaction the callback takes in turn. */
async function landedOnSetup(
  transient: ReturnType<typeof keyValueDouble>,
): Promise<ForgePress> {
  const landed = forgeSetupDecision(
    { action: "install", state: "a-state" },
    forgeInstallTake(transient),
  );
  if (landed.decision !== "Authorize")
    throw new Error("the landing did not match the transaction it was begun");
  const sent = new URL(
    await forgeAuthorizeBegin(
      { ...ports, transient },
      client,
      "https://console.test",
      {
        tenant: landed.transaction.tenant,
        returnPath: landed.transaction.returnPath,
        installs: landed.transaction.installs,
      },
    ),
  );
  const decided = forgeCallbackDecision(
    {
      code: "a-code",
      state: sent.searchParams.get("state") ?? undefined,
      error: undefined,
    },
    forgeAuthorizeTake(transient),
  );
  if (decided.decision !== "Redeem")
    throw new Error("the callback did not match the transaction it was begun");
  return decided.transaction;
}

/**
 * One press driven through the answers in turn as the two landings drive it,
 * answering every install it was sent on to. A press an answer sends nowhere
 * has returned to its page, so the answers after it are never asked for.
 */
async function sentOnBy(
  began: ForgePress,
  sequence: readonly Answer[],
): Promise<readonly ForgeAppName[]> {
  const transient = keyValueDouble();
  const sent: ForgeAppName[] = [];
  let held = began;
  for (const answer of sequence) {
    const app = forgeAuthorizationInstall(answer, held.installs);
    if (app === undefined) return sent;
    sent.push(app);
    forgeInstallBegin(transient, {
      ...forgePressSentOn(held, app),
      state: "a-state",
    });
    held = await landedOnSetup(transient);
  }
  return sent;
}

function sequencesOf(length: number): readonly (readonly Answer[])[] {
  if (length === 0) return [[]];
  return sequencesOf(length - 1).flatMap((shorter) =>
    answers.map((answer) => [...shorter, answer]),
  );
}

/** Every list a press may begin with: none from Connect GitHub, and one app
 * from that app's own install link. */
const beginnings: readonly (readonly ForgeAppName[])[] = [
  [],
  ["portal"],
  ["worker"],
];

/** The paths the property is about are reached, so it does not hold only
 * because nothing is ever sent on. */
test("a press that began with neither app is sent on to each install in turn", async () => {
  const began = { ...press, installs: [] };
  expect(await sentOnBy(began, [nothing, workerless, connected])).toStrictEqual(
    ["portal", "worker"],
  );
  expect(await sentOnBy(began, [nothing, nothing, workerless])).toStrictEqual([
    "portal",
  ]);
  expect(
    await sentOnBy(began, [workerless, workerless, nothing]),
  ).toStrictEqual(["worker"]);
});

/** A press sent on by every answer of a sequence one longer than the roster of
 * apps would have to repeat an install, and each sequence asked is longer again. */
test("no sequence of answers sends a press on to one app's install twice", async () => {
  for (const installs of beginnings)
    for (const sequence of sequencesOf(forgeApps.length + 2)) {
      const sent = await sentOnBy({ ...press, installs }, sequence);
      expect(new Set(sent).size).toBe(sent.length);
      expect(sent.filter((app) => installs.includes(app))).toStrictEqual([]);
    }
});
