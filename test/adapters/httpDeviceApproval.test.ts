/**
 * A device's approval as its route answers it: a person's bearer and no other,
 * the API's media type alone, the code normalised before it is handed on, each
 * answer by its status and its envelope code, and no route at all where no
 * approvals are composed.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { twoBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  deviceApprovalCodes,
  deviceApprovalResponseSchema,
} from "../../src/contract/deviceApproval.ts";
import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { sessionBearerPrefix } from "../../src/contract/sessionPlane.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import {
  deviceApprovals,
  type DeviceApprovals,
  type DeviceApproved,
  type DeviceUserCodeAnswer,
} from "../../src/interpreter/deviceApproval.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { callerApp } from "./callerAppFixture.ts";

const person = asPrincipal("person");
const headers = {
  authorization: "Bearer valid",
  "content-type": nativeHttpMediaType,
};
const url = nativeHttpRoutes.deviceApprovals;
const body = { challenge: "a-challenge", userCode: "bcdf-ghjk" };

/** Approvals answering `answered` to every call, recording what each was handed. */
function approvalsAnswering(
  answered: DeviceApproved,
  asked: string[] = [],
): DeviceApprovals {
  return {
    approve: (principal, challenge, userCode) => {
      asked.push(`${principal} ${challenge} ${userCode}`);
      return Promise.resolve(answered);
    },
  };
}

async function approved(
  approvals: DeviceApprovals,
  payload: Record<string, unknown> = body,
) {
  await using app = callerApp(person, { deviceApprovals: approvals });
  return await app.inject({ method: "POST", url, headers, payload });
}

test("an approval answers where the browser goes next, the code handed on as the issuer compares it, as the caller", async () => {
  const asked: string[] = [];
  const answered = await approved(
    approvalsAnswering(
      { answer: "Accepted", redirectTo: "https://auth.invalid/next" },
      asked,
    ),
  );
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(deviceApprovalResponseSchema.parse(answered.json()), {
    redirectTo: "https://auth.invalid/next",
  });
  assert.deepEqual(asked, [`${person} a-challenge BCDFGHJK`]);
});

test("each refusal answers its status and its own envelope code", async () => {
  for (const [answer, status, code] of [
    [{ answer: "CodeRefused" }, 422, deviceApprovalCodes.CodeRefused],
    [{ answer: "LinkExpired" }, 422, deviceApprovalCodes.LinkExpired],
    [
      { answer: "TriesSpent", retryAfterSecs: 42 },
      429,
      deviceApprovalCodes.TriesSpent,
    ],
    [{ answer: "Unavailable" }, 503, deviceApprovalCodes.Unavailable],
  ] as const) {
    const answered = await approved(approvalsAnswering(answer));
    assert.equal(answered.statusCode, status, answer.answer);
    assert.equal(
      errorEnvelopeSchema.parse(answered.json()).error.code,
      code,
      answer.answer,
    );
    if (answer.answer === "TriesSpent")
      assert.equal(answered.headers["retry-after"], "42");
    if (answer.answer === "Unavailable")
      assert.ok(answered.headers["retry-after"] !== undefined);
  }
});

test("a spent bound answers 429 without the issuer being asked", async () => {
  let asked = 0;
  const approvals = deviceApprovals(
    {
      codes: {
        accept: (): Promise<DeviceUserCodeAnswer> => {
          asked += 1;
          return Promise.resolve({ answer: "CodeRefused" });
        },
      },
      nowMs: () => 0,
    },
    { refusalsMax: 1, windowMs: 60_000, principalsMax: 1 },
  );
  await using app = callerApp(person, { deviceApprovals: approvals });
  const press = () =>
    app.inject({ method: "POST", url, headers, payload: body });
  assert.equal((await press()).statusCode, 422);
  const spent = await press();
  assert.equal(spent.statusCode, 429);
  assert.equal(spent.headers["retry-after"], "60");
  assert.equal(asked, 1);
});

test("a body that is not the API's media type, or not the request's shape, is refused before anything is asked", async () => {
  const asked: string[] = [];
  await using app = callerApp(person, {
    deviceApprovals: approvalsAnswering({ answer: "CodeRefused" }, asked),
  });
  const unversioned = await app.inject({
    method: "POST",
    url,
    headers: { ...headers, "content-type": "application/json" },
    payload: body,
  });
  assert.equal(unversioned.statusCode, 415);
  for (const payload of [
    { challenge: "a-challenge" },
    { ...body, userCode: "" },
    { ...body, challenge: "c".repeat(8_193) },
    { ...body, extra: true },
  ]) {
    const refused = await app.inject({ method: "POST", url, headers, payload });
    assert.equal(refused.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(asked, []);
});

test("no bearer is unauthenticated, and a session bearer is refused before anything is asked", async () => {
  const asked: string[] = [];
  const sessionToken = `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
  await using app = callerApp(
    person,
    { deviceApprovals: approvalsAnswering({ answer: "CodeRefused" }, asked) },
    twoBearerAuthentication(
      {
        authenticateBearer: () =>
          Promise.resolve({ authenticated: "InvalidToken" as const }),
      },
      {
        authenticate: (secret) =>
          Promise.resolve(
            secret === sessionToken
              ? {
                  partition: {
                    tenant: asTenantId("acme"),
                    project: asProjectId("atlas"),
                  },
                  session: asSessionId("thread"),
                  kind: "Thread" as const,
                  principal: person,
                  scope: "Project" as const,
                  capabilities: ["ProjectRead" as const],
                }
              : undefined,
          ),
      },
    ),
  );
  const bare = await app.inject({
    method: "POST",
    url,
    headers: { "content-type": nativeHttpMediaType },
    payload: body,
  });
  assert.equal(bare.statusCode, 401);
  const session = await app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": nativeHttpMediaType,
    },
    payload: body,
  });
  assert.equal(session.statusCode, 403);
  assert.equal(
    errorEnvelopeSchema.parse(session.json()).error.code,
    "InsufficientScope",
  );
  assert.deepEqual(asked, []);
});

test("a deployment composing no approvals serves no approval route", async () => {
  await using app = callerApp(person, {});
  const answered = await app.inject({
    method: "POST",
    url,
    headers,
    payload: body,
  });
  assert.equal(answered.statusCode, 404);
});
