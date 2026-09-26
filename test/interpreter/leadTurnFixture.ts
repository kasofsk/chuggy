/**
 * The view a lead decision is read against, and the decision bodies the
 * lead-turn suites build. They are one fixture because both the reader's own
 * suite and the contract's agreement suite read them, and a view restated in
 * the second would drift from the one the first proves against.
 */

import { asTicketId } from "../../src/domain/ids.ts";
import type { AgenticRefusalRecord } from "../../src/interpreter/agenticRefusal.ts";
import type { DispatchCandidate } from "../../src/interpreter/dispatchView.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { SelectorObservation } from "../../src/interpreter/selector.ts";

export const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

export const candidate: DispatchCandidate = {
  ticket: asTicketId(41),
  ticketVersion: 3,
  dependencies: [],
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
  configurationRevision: "revision",
  configurationDigest: "d".repeat(64),
  configurationCanonical: "{}",
};

export const token = {
  ...partition,
  recoveryEpoch: "epoch",
  schemaVersion: 1,
  watermark: 2,
  digest: "a".repeat(64),
};

export const operationalContext = {
  version: 2,
  observedAt: "2026-09-02T12:00:00.000Z",
  observedAtEpochMs: 1_788_000_000_000,
  reviewFeedback: [],
  activeWork: { queued: 0, admitted: 0, launching: 0, running: 0 },
  capacity: {
    account: "account",
    accountMaximum: 8,
    accountActive: 1,
    accountReservationDeficit: 0,
    clusterSlotsMax: 8,
    clusterActive: 1,
  },
  backlog: {
    project: { queued: 0, ceiling: 100 },
    installation: { queued: 0, ceiling: 1_000 },
  },
} as const;

export const standingRefusal: AgenticRefusalRecord = {
  ticket: asTicketId(40),
  ticketVersion: 2,
  reason: "its dependency has not passed",
  decision: "selector-decision-one",
  recordedAt: "2026-09-02T11:00:00.000Z",
};

export const standing: readonly AgenticRefusalRecord[] = [standingRefusal];

export const observation: SelectorObservation = {
  token,
  candidates: [candidate],
  refusals: standing,
  notificationCursor: 1_204,
  changes: [{ ordinal: 1_205, kind: "Ticket", resource: "41" }],
  operationalContext,
  handoffNote: { watching: "41" },
  nextCandidateScan: { state: "Exhausted", token },
};

/**
 * The same view with ticket 40 in it and a refusal of 39 standing, so a decision
 * may name 40 and 41 alike and lift one the page's standing carries.
 */
export const parcelledObservation: SelectorObservation = {
  ...observation,
  candidates: [
    candidate,
    { ...candidate, ticket: asTicketId(40), ticketVersion: 2 },
  ],
  refusals: [...standing, { ...standingRefusal, ticket: asTicketId(39) }],
};

/** One decision body naming what the case varies, and the free decision otherwise. */
export function decision(body: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    version: 1,
    attention: "Monitoring",
    handoffNote: {},
    ...body,
  });
}
