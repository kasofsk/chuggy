/**
 * The agreement gate decided with no renderer: what each standing draws, what
 * a send names, and what each answer of that send is followed by.
 */

import { expect, test } from "vitest";

import { agreementPoliciesChangedCode } from "../../../src/contract/agreementPlane.ts";
import type { AgreementStanding } from "../../../src/contract/agreementPlane.ts";

import {
  agreementAnswered,
  agreementGateDrawn,
  agreementGateUnread,
  agreementPending,
  agreementReadable,
  agreementSendable,
  agreementSent,
  agreementStandingGate,
} from "../app/core/agreementGate.ts";
import type {
  AgreementAsking,
  AgreementGate,
} from "../app/core/agreementGate.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  agreementPrivacy as privacy,
  agreementTerms as terms,
} from "./agreementPolicies.ts";

function read(standing: AgreementStanding): ApiResult<AgreementStanding> {
  return { outcome: "Ok", value: standing };
}

const agreedAt = "2026-11-27T10:00:00Z";

const asking: AgreementAsking = {
  gate: "Asking",
  policies: [terms],
  notice: "None",
  busy: false,
};

test("the opening card is drawn until the first read answers", () => {
  expect(agreementGateDrawn(agreementGateUnread)).toStrictEqual({
    drawn: "Opening",
  });
  expect(
    agreementGateDrawn(agreementPending(agreementGateUnread)),
  ).toStrictEqual({ drawn: "Opening" });
});

test("a standing whose every policy is agreed, an empty one included, draws the router", () => {
  for (const standing of [
    { policies: [] },
    {
      policies: [
        { ...terms, agreedAt },
        { ...privacy, agreedAt },
      ],
    },
  ])
    expect(
      agreementGateDrawn(agreementStandingGate(read(standing), "None")),
    ).toStrictEqual({ drawn: "Router" });
});

test("a standing with a policy unagreed draws the page listing those unagreed, in its order", () => {
  expect(
    agreementGateDrawn(
      agreementStandingGate(
        read({ policies: [{ ...terms, agreedAt }, privacy] }),
        "None",
      ),
    ),
  ).toStrictEqual({
    drawn: "Page",
    policies: [privacy],
    notice: undefined,
    busy: false,
  });
  expect(
    agreementGateDrawn(
      agreementStandingGate(read({ policies: [terms, privacy] }), "Changed"),
    ),
  ).toStrictEqual({
    drawn: "Page",
    policies: [terms, privacy],
    notice: { tone: "info", line: { id: "agreements-changed" } },
    busy: false,
  });
});

test("a standing that could not be read is no pass, whatever kept it from being read", () => {
  const failures: readonly ApiResult<AgreementStanding>[] = [
    { outcome: "Unreachable", reason: "no answer" },
    { outcome: "Unreadable", reason: "not JSON" },
    { outcome: "Unauthenticated" },
    { outcome: "Absent" },
    { outcome: "Fault", code: "InternalError", status: 500 },
  ];
  for (const failure of failures)
    expect(
      agreementGateDrawn(agreementStandingGate(failure, "None")),
    ).toStrictEqual({ drawn: "NotRead", busy: false });
});

test("the first read is asked for once, and a retry only from a page that could not read and is not reading", () => {
  const notRead: AgreementGate = { gate: "NotRead", busy: false };
  expect(agreementReadable(agreementGateUnread, "First")).toBe(true);
  expect(agreementReadable({ gate: "Reading" }, "First")).toBe(false);
  expect(agreementReadable(notRead, "First")).toBe(false);
  expect(agreementReadable({ gate: "Passed" }, "First")).toBe(false);
  expect(agreementReadable(notRead, "Retry")).toBe(true);
  expect(agreementReadable(agreementPending(notRead), "Retry")).toBe(false);
  expect(agreementReadable(agreementGateUnread, "Retry")).toBe(false);
  expect(agreementGateDrawn(agreementPending(notRead))).toStrictEqual({
    drawn: "NotRead",
    busy: true,
  });
});

test("a send names exactly the policies listed, each at the version and digest the standing gave, and goes once while unanswered", () => {
  expect(agreementSent([terms, privacy])).toStrictEqual({
    agreements: [
      { policy: terms.policy, version: terms.version, digest: terms.digest },
      {
        policy: privacy.policy,
        version: privacy.version,
        digest: privacy.digest,
      },
    ],
  });
  expect(() => agreementSent([])).toThrow();
  expect(agreementSendable(asking)).toBe(true);
  expect(agreementSendable(agreementPending(asking))).toBe(false);
  expect(agreementSendable({ gate: "Passed" })).toBe(false);
});

test("a send answered with a standing is drawn as that standing", () => {
  expect(
    agreementAnswered(asking, read({ policies: [{ ...terms, agreedAt }] })),
  ).toStrictEqual({ follows: "Gate", gate: { gate: "Passed" } });
  expect(
    agreementAnswered(
      asking,
      read({ policies: [{ ...terms, agreedAt }, privacy] }),
    ),
  ).toStrictEqual({
    follows: "Gate",
    gate: { gate: "Asking", policies: [privacy], notice: "None", busy: false },
  });
});

test("policies that changed are read again, and any other refusal keeps the list under the danger notice, pressable", () => {
  expect(
    agreementAnswered(asking, {
      outcome: "Conflict",
      code: agreementPoliciesChangedCode,
      body: undefined,
    }),
  ).toStrictEqual({ follows: "ReadAgain" });
  const others: readonly ApiResult<AgreementStanding>[] = [
    { outcome: "Conflict", code: "Conflict", body: undefined },
    {
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    },
    { outcome: "Unreachable", reason: "no answer" },
  ];
  for (const other of others) {
    const answered = agreementAnswered({ ...asking, busy: true }, other);
    expect(answered).toStrictEqual({
      follows: "Gate",
      gate: { ...asking, notice: "NotRecorded" },
    });
    if (answered.follows === "Gate")
      expect(agreementGateDrawn(answered.gate)).toStrictEqual({
        drawn: "Page",
        policies: [terms],
        notice: { tone: "danger", line: { id: "agreements-not-recorded" } },
        busy: false,
      });
  }
});
