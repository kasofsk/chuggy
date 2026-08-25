export const ticketCreationPartition = { tenant: "acme", project: "atlas" };
export const ticketCreationAuthoring = {
  dependencies: [],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};
export const ticketCreationInitialization = {
  configuration: {
    partition: ticketCreationPartition,
    revision: "ready",
    parent: undefined,
    canonical:
      '{"brief":{"acceptanceCriteria":["The change works."],"constraints":[],"motivation":["The change is needed."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
    digest: "digest",
  },
  fence: { projectSequence: 4, configurationDigest: "digest" },
  defaults: ticketCreationAuthoring,
  choices: {
    stages: ticketCreationAuthoring.program,
    programStagesMax: 1,
    workFanouts: [1],
    reworkPolicies: [ticketCreationAuthoring.reworkPolicy],
    finalizationPricings: ["DeadlineOnly"],
    resumePricings: ["RetryCharged"],
    finalizers: ["ManagedFinalizer"],
  },
  dependencyCandidates: [],
  dependencyCandidatesTruncated: false,
};

export function ticketCreationDraft(configurationRevision = "ready") {
  return {
    partition: ticketCreationPartition,
    ticket: 8,
    authoringVersion: 1,
    state: "Draft",
    configurationRevision,
    authoring: ticketCreationAuthoring,
  };
}
