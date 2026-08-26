/**
 * One draft initialization and the forms built from it, shared by the suites
 * that check what a creation screen decides and what it sends.
 *
 * The values are the wire's own shapes, so a schema that gains a field fails
 * here rather than in one suite that happened to be updated.
 */

import type {
  ConfigurationSummary,
  DraftInitializationResponse,
  DraftResponse,
} from "../../../src/contract/responses.ts";
import { creationFormFrom } from "../app/core/ticketCreation.ts";
import type { TicketCreationForm } from "../app/core/ticketCreation.ts";

export const creationDigest = "a".repeat(64);

export const creationPartition = { tenant: "acme", project: "atlas" };

export function creationSummary(
  revision: string,
  readiness: "Ready" | "Incomplete",
): ConfigurationSummary {
  const base = {
    revision,
    digest: creationDigest,
    createdAt: "2026-08-26T00:00:00Z",
    provenance: { source: "Authored" as const },
  };
  return readiness === "Incomplete"
    ? { ...base, readiness }
    : {
        ...base,
        readiness,
        image: "an-image",
        practices: [],
        workInstructionsCount: 1,
        reviewInstructionsCount: 1,
      };
}

export const creationInitialization: DraftInitializationResponse = {
  configuration: {
    partition: creationPartition,
    revision: "r3",
    canonical: "{}",
    digest: creationDigest,
  },
  fence: { projectSequence: 41, configurationDigest: creationDigest },
  defaults: {
    dependencies: [],
    program: [{ fanout: 1, combinator: "UnanimousPass" }],
    workFanout: 1,
    reworkPolicy: { type: "BudgetedRework", value: 0 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    finalizer: "ManagedFinalizer",
  },
  choices: {
    stages: [
      { fanout: 1, combinator: "UnanimousPass" },
      { fanout: 2, combinator: "AnyPass" },
    ],
    programStagesMax: 2,
    workFanouts: [1, 2],
    reworkPolicies: [{ type: "BudgetedRework", value: 0 }],
    finalizationPricings: ["DeadlineOnly"],
    resumePricings: ["RetryCharged"],
    finalizers: ["ManagedFinalizer"],
  },
  dependencyCandidates: [7, 8],
  dependencyCandidatesTruncated: false,
};

export const creationDraft: DraftResponse = {
  partition: creationPartition,
  ticket: 12,
  authoringVersion: 3,
  state: "Draft",
  configurationRevision: "r3",
  authoring: creationInitialization.defaults,
};

export function creationForm(
  over: Partial<TicketCreationForm> = {},
): TicketCreationForm {
  return {
    ...creationFormFrom(creationInitialization),
    intent: "ship it",
    ...over,
  };
}
