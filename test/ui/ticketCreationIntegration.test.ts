import assert from "node:assert/strict";
import test from "node:test";

import { createTicketCreation } from "../../ui/dom/ticketCreationController.js";

const partition = { tenant: "acme", project: "atlas" };
const authoring = {
  dependencies: [],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};
const initialization = {
  configuration: {
    partition,
    revision: "ready",
    parent: undefined,
    canonical: "{}",
    digest: "digest",
  },
  fence: { projectSequence: 4, configurationDigest: "digest" },
  defaults: authoring,
  choices: {
    stages: authoring.program,
    programStagesMax: 1,
    workFanouts: [1],
    reworkPolicies: [authoring.reworkPolicy],
    finalizationPricings: ["DeadlineOnly"],
    resumePricings: ["RetryCharged"],
    finalizers: ["ManagedFinalizer"],
  },
  dependencyCandidates: [],
  dependencyCandidatesTruncated: false,
};

test("controller initializes, creates, emits release, and navigates only after success", async () => {
  const requests: string[] = [];
  const releases: unknown[] = [];
  const navigations: number[] = [];
  const controller = createTicketCreation({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) => {
      requests.push(`${request.method} ${request.url}`);
      return Promise.resolve(
        request.method === "GET"
          ? { outcome: "Ok" as const, body: initialization }
          : {
              outcome: "Ok" as const,
              body: {
                partition,
                ticket: 8,
                authoringVersion: 1,
                state: "Draft",
                configurationRevision: "ready",
                authoring,
              },
            },
      );
    },
    onChanged: () => undefined,
    onRelease: (event) => releases.push(event),
    onNavigate: (ticket) => navigations.push(ticket),
  });
  controller.selectProject(partition, [
    { revision: "ready", readiness: "Ready" },
  ]);
  await controller.selectRevision("ready");
  await controller.submit();
  controller.release();
  assert.deepEqual(navigations, []);
  assert.deepEqual(releases, [
    {
      event: "ReleaseDraft",
      ticket: 8,
      authoringVersion: 1,
      configurationRevision: "ready",
    },
  ]);
  controller.releaseAnswered({ result: "Succeeded" });
  assert.deepEqual(navigations, [8]);
  assert.deepEqual(requests, [
    "GET /api/v1/tenants/acme/projects/atlas/draft-initializations/ready",
    "POST /api/v1/tenants/acme/projects/atlas/drafts",
  ]);
});
