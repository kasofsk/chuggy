/**
 * The gate between a signed-in session and the router, decided with no
 * renderer: what a standing draws, what a send names, and what each answer of
 * that send comes to.
 *
 * A STANDING THAT COULD NOT BE READ IS NOT A PASS. Only a standing read whole,
 * every policy in it carrying `agreedAt`, draws the router; any other answer
 * draws a page that says so and offers the read again.
 *
 * A SEND NAMES WHAT THE PAGE LISTS, each policy at the version and digest the
 * standing gave, so a policy that moved while the page was open is refused
 * whole by the plane and read again here rather than agreed to unseen.
 *
 * A PASS STANDS UNTIL THE API SAYS OTHERWISE. A deployment that does not ask
 * passes the gate with no read, and an answer refusing the person for want of
 * agreement, heard while the gate is passed, reads the standing again under the
 * router. A standing that says every policy is agreed leaves the pass as it
 * was, so an API and a plane that disagree for a moment ask nothing more.
 */

import {
  agreementPoliciesChangedCode,
  type AgreementRequest,
  type AgreementStanding,
  type AgreementStandingEntry,
} from "../../../../src/contract/agreementPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";

/** What the page says above its list: nothing, that the list moved under a
 * send, or that a send was not recorded. */
export type AgreementNotice = "None" | "Changed" | "NotRecorded";

/** The page while it lists what is still to be agreed, busy while a send or
 * the read after it is unanswered. */
export interface AgreementAsking {
  readonly gate: "Asking";
  readonly policies: readonly AgreementStandingEntry[];
  readonly notice: AgreementNotice;
  readonly busy: boolean;
}

/** What a pass stands on: a standing read, or a deployment that did not ask. */
export type AgreementPassedBy = "Standing" | "Unasked";

/** The gate passed, `reading` while a read of the standing an answer asked for
 * is unanswered. */
export interface AgreementPassed {
  readonly gate: "Passed";
  readonly by: AgreementPassedBy;
  readonly reading: boolean;
}

/** Where the gate stands: nothing asked yet, the first read unanswered, the
 * page, a standing not read, or passed. */
export type AgreementGate =
  | { readonly gate: "Unread" }
  | { readonly gate: "Reading" }
  | AgreementAsking
  | { readonly gate: "NotRead"; readonly busy: boolean }
  | AgreementPassed;

export const agreementGateUnread: AgreementGate = { gate: "Unread" };

/** The words of the page and of the page that could not read. */
export const agreementWords = {
  title: { id: "agreements-title" },
  needed: { id: "agreements-needed" },
  agree: { id: "agreements-agree" },
  signOut: { id: "agreements-sign-out" },
  notReadTitle: { id: "agreements-not-read-title" },
  notRead: { id: "agreements-not-read" },
  retry: { id: "agreements-retry" },
} as const satisfies Readonly<Record<string, Copy>>;

/** A notice as the page draws it: its tone and its line. */
export interface AgreementNoticeDrawn {
  readonly tone: "info" | "danger";
  readonly line: Copy;
}

/** What the gate draws in place of the router, or the router. */
export type AgreementGateDrawn =
  | { readonly drawn: "Opening" }
  | {
      readonly drawn: "Page";
      readonly policies: readonly AgreementStandingEntry[];
      readonly notice: AgreementNoticeDrawn | undefined;
      readonly busy: boolean;
    }
  | { readonly drawn: "NotRead"; readonly busy: boolean }
  | { readonly drawn: "Router" };

function agreementNoticeDrawn(
  notice: AgreementNotice,
): AgreementNoticeDrawn | undefined {
  switch (notice) {
    case "None":
      return undefined;
    case "Changed":
      return { tone: "info", line: { id: "agreements-changed" } };
    case "NotRecorded":
      return { tone: "danger", line: { id: "agreements-not-recorded" } };
  }
}

/** The opening card until the first read answers, and then what it answered:
 * the router for a pass, a read under it included. */
export function agreementGateDrawn(gate: AgreementGate): AgreementGateDrawn {
  switch (gate.gate) {
    case "Unread":
    case "Reading":
      return { drawn: "Opening" };
    case "Asking":
      return {
        drawn: "Page",
        policies: gate.policies,
        notice: agreementNoticeDrawn(gate.notice),
        busy: gate.busy,
      };
    case "NotRead":
      return { drawn: "NotRead", busy: gate.busy };
    case "Passed":
      return { drawn: "Router" };
  }
}

/** The gate as a signed-in root first stands on it: passed with no read where
 * the deployment does not ask and nothing has moved it, and as it is
 * otherwise. */
export function agreementGateOpened(
  gate: AgreementGate,
  asked: boolean,
): AgreementGate {
  if (asked || gate.gate !== "Unread") return gate;
  return { gate: "Passed", by: "Unasked", reading: false };
}

/** Which read of the standing is asked for: the one at sign-in, or a press
 * of `Retry` on the page that could not read. */
export type AgreementRead = "First" | "Retry";

/** Whether a read may start: the first where none has, and a retry where the
 * last could not read and no retry of it is unanswered. */
export function agreementReadable(
  gate: AgreementGate,
  read: AgreementRead,
): boolean {
  switch (read) {
    case "First":
      return gate.gate === "Unread";
    case "Retry":
      return gate.gate === "NotRead" && !gate.busy;
  }
}

/** Whether a send may start: the page lists something and nothing it sent is
 * unanswered. */
export function agreementSendable(
  gate: AgreementGate,
): gate is AgreementAsking {
  return gate.gate === "Asking" && !gate.busy && gate.policies.length > 0;
}

/** The gate while a read or a send of it is unanswered: the opening card for
 * the first read, the pass reading under the router, and the page it was asked
 * from, busy, for any other. */
export function agreementPending(gate: AgreementGate): AgreementGate {
  switch (gate.gate) {
    case "Unread":
    case "Reading":
      return { gate: "Reading" };
    case "Asking":
    case "NotRead":
      return { ...gate, busy: true };
    case "Passed":
      return { ...gate, reading: true };
  }
}

/** What an answer refusing for want of agreement makes of the gate: a pass
 * with no read out reads the standing, and in any other state nothing
 * follows. */
export function agreementHeard(
  gate: AgreementGate,
): AgreementPassed | undefined {
  if (gate.gate !== "Passed" || gate.reading) return undefined;
  return { ...gate, reading: true };
}

/** The standing a heard answer asked for, drawn as any read one is, under the
 * changed notice where the pass stood on a standing the person was shown. */
export function agreementHeardAnswered(
  passed: AgreementPassed,
  result: ApiResult<AgreementStanding>,
): AgreementGate {
  return agreementStandingGate(
    result,
    passed.by === "Standing" ? "Changed" : "None",
  );
}

/** A standing as the gate stands on it: passed where every policy carries
 * `agreedAt`, an empty standing included, the page listing those that do not
 * otherwise, and not read where it could not be. */
export function agreementStandingGate(
  result: ApiResult<AgreementStanding>,
  notice: AgreementNotice,
): AgreementGate {
  if (result.outcome !== "Ok") return { gate: "NotRead", busy: false };
  const policies = result.value.policies.filter(
    (entry) => entry.agreedAt === undefined,
  );
  if (policies.length === 0)
    return { gate: "Passed", by: "Standing", reading: false };
  return { gate: "Asking", policies, notice, busy: false };
}

/** The agreement a press sends: each policy listed, at the version and digest
 * the standing gave. */
export function agreementSent(
  policies: readonly AgreementStandingEntry[],
): AgreementRequest {
  if (policies.length === 0)
    throw new Error("an agreement names at least one policy");
  return {
    agreements: policies.map(({ policy, version, digest }) => ({
      policy,
      version,
      digest,
    })),
  };
}

/** What follows a send's answer: the gate it leaves, or a read of the
 * standing, whose answer the page draws under the changed notice. */
export type AgreementAnswer =
  | { readonly follows: "Gate"; readonly gate: AgreementGate }
  | { readonly follows: "ReadAgain" };

/**
 * A standing answered is drawn as any read one is, and policies that changed
 * are read again; any other answer keeps the same list under the danger
 * notice, pressable again.
 */
export function agreementAnswered(
  asking: AgreementAsking,
  result: ApiResult<AgreementStanding>,
): AgreementAnswer {
  if (result.outcome === "Ok")
    return { follows: "Gate", gate: agreementStandingGate(result, "None") };
  if (
    result.outcome === "Conflict" &&
    result.code === agreementPoliciesChangedCode
  )
    return { follows: "ReadAgain" };
  return {
    follows: "Gate",
    gate: { ...asking, notice: "NotRecorded", busy: false },
  };
}
