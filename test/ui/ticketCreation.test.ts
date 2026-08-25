import assert from "node:assert/strict";
import test from "node:test";

import {
  ticketCreationConfigurationSubmitted,
  ticketCreationCreated,
  ticketCreationEdited,
  ticketCreationInitialized,
  ticketCreationReleaseEvent,
  ticketCreationSelected,
  ticketCreationSubmitted,
} from "../../ui/app/ticketCreation.js";
import { parseDraftInitialization } from "../../ui/app/resources.js";

const partition = { tenant: "acme", project: "atlas" };
type DraftInitialization = ReturnType<typeof parseDraftInitialization>;
type DraftAuthoring = DraftInitialization["defaults"];
const defaults: DraftAuthoring = {
  dependencies: [1],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};
const initialization = parseDraftInitialization({
  configuration: {
    partition,
    revision: "revision-1",
    parent: undefined,
    canonical:
      '{"brief":{"acceptanceCriteria":["It works."],"constraints":[],"motivation":["It matters."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
    digest: "digest-1",
  },
  fence: { projectSequence: 19, configurationDigest: "digest-1" },
  defaults,
  choices: {
    stages: [
      { fanout: 1, combinator: "UnanimousPass" },
      { fanout: 2, combinator: "AnyPass" },
    ],
    programStagesMax: 2,
    workFanouts: [1, 2],
    reworkPolicies: [
      { type: "BudgetedRework", value: 0 },
      { type: "BudgetedRework", value: 1 },
    ],
    finalizationPricings: ["DeadlineOnly", { type: "Budgeted", value: 3 }],
    resumePricings: ["RetryCharged", "RetryFree"],
    finalizers: ["ManagedFinalizer", "NoFinalizer"],
  },
  dependencyCandidates: [1, 2],
  dependencyCandidatesTruncated: false,
});

test("selection reads initialization and adopts every server default", () => {
  const selected = ticketCreationSelected("token", partition, "revision-1");
  assert.equal(
    selected.request.url,
    "/api/v1/tenants/acme/projects/atlas/draft-initializations/revision-1",
  );
  const state = ticketCreationInitialized("revision-1", {
    outcome: "Ok",
    body: initialization,
  });
  assert.equal(state.step, "Editing");
  if (state.step === "Editing") assert.deepEqual(state.authoring, defaults);
  if (state.step === "Editing")
    assert.deepEqual(state.brief, {
      motivation: ["It matters."],
      acceptanceCriteria: ["It works."],
    });
});

test("ticket briefing is saved as an immutable child configuration", () => {
  const state = ticketCreationInitialized("revision-1", {
    outcome: "Ok",
    body: initialization,
  });
  assert.equal(state.step, "Editing");
  if (state.step !== "Editing") return;
  const submitted = ticketCreationConfigurationSubmitted(
    {
      ...state,
      brief: {
        motivation: ["Fix the bug."],
        acceptanceCriteria: ["The regression passes."],
      },
    },
    "token",
    partition,
    "ticket-7",
  );
  assert.ok(submitted.request);
  const body = JSON.parse(submitted.request?.body ?? "") as {
    revision: string;
    parent: string;
    canonical: string;
  };
  assert.equal(body.revision, "ticket-7");
  assert.equal(body.parent, "revision-1");
  const canonical = JSON.parse(body.canonical) as {
    brief: Record<string, unknown>;
  };
  assert.deepEqual(canonical.brief, {
    acceptanceCriteria: ["The regression passes."],
    constraints: [],
    motivation: ["Fix the bug."],
  });
});

test("every authoring field can change within returned choices and creation keeps the fence", () => {
  const authoring: DraftAuthoring = {
    dependencies: [2],
    program: [{ fanout: 2, combinator: "AnyPass" }],
    workFanout: 2,
    reworkPolicy: { type: "BudgetedRework", value: 1 },
    finalizationPricing: { type: "Budgeted", value: 3 },
    resumePricing: "RetryFree",
    finalizer: "NoFinalizer",
  };
  const edited = ticketCreationEdited(initialization, authoring);
  assert.equal(edited.step, "Editing");
  const submitted = ticketCreationSubmitted(edited, "token", partition);
  assert.ok(submitted.request);
  assert.deepEqual(JSON.parse(submitted.request.body ?? ""), {
    configurationRevision: "revision-1",
    configurationDigest: "digest-1",
    expectedProjectSequence: 19,
    authoring,
  });
});

test("stale draft creation returns visibly to editing", () => {
  const state = ticketCreationCreated(initialization, defaults, {
    outcome: "Conflict",
    code: "DraftInitializationStale",
    body: {},
  });
  assert.equal(state.step, "Editing");
  if (state.step === "Editing") assert.match(state.issue ?? "", /stale/i);
});

test("created draft exports the exact release event", () => {
  const state = ticketCreationCreated(initialization, defaults, {
    outcome: "Ok",
    body: {
      partition,
      ticket: 7,
      authoringVersion: 1,
      state: "Draft",
      configurationRevision: "revision-1",
      authoring: defaults,
    },
  });
  assert.equal(state.step, "DraftCreated");
  if (state.step !== "DraftCreated") return;
  assert.deepEqual(ticketCreationReleaseEvent(state.draft), {
    event: "ReleaseDraft",
    ticket: 7,
    authoringVersion: 1,
    configurationRevision: "revision-1",
  });
});

test("incomplete and unavailable initializations are visible failures", () => {
  const incomplete = ticketCreationInitialized("revision-1", {
    outcome: "Conflict",
    code: "ConfigurationIncomplete",
    body: {},
  });
  const unavailable = ticketCreationInitialized("revision-1", {
    outcome: "Retryable",
    code: "DraftInitializationUnavailable",
    retryAfterSeconds: 1,
  });
  assert.equal(incomplete.step, "InitializationFailed");
  assert.equal(unavailable.step, "InitializationFailed");
});
