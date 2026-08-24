import assert from "node:assert/strict";
import test from "node:test";

import { releaseDraftMutation } from "../../ui/app/protocol.js";
import { createConsole } from "../../ui/dom/console.js";
import { createTicketCreation } from "../../ui/dom/ticketCreationController.js";

const partition = { tenant: "acme", project: "atlas" };
const authoring = JSON.parse(
  '{"dependencies":[],"program":[{"fanout":1,"combinator":"UnanimousPass"}],"workFanout":1,"reworkPolicy":{"type":"BudgetedRework","value":0},"finalizationPricing":"DeadlineOnly","resumePricing":"RetryCharged","finalizer":"ManagedFinalizer"}',
);

function shellSend(requests: string[]) {
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
  return (request: { method: string; url: string }) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url.includes("draft-initializations"))
      return Promise.resolve({ outcome: "Ok" as const, body: initialization });
    if (request.url.endsWith("/drafts"))
      return Promise.resolve({
        outcome: "Ok" as const,
        body: {
          partition,
          ticket: 8,
          authoringVersion: 1,
          state: "Draft",
          configurationRevision: "ready",
          authoring,
        },
      });
    return Promise.resolve({
      outcome: "Accepted" as const,
      body: { operation: "release-8", state: "Succeeded" },
      location: "/operations/release-8",
    });
  };
}

test("the shell follows draft release before navigating to ticket detail", async () => {
  const requests: string[] = [];
  const send = shellSend(requests);
  const session = {
    accessToken: () => Promise.resolve("token"),
    signedIn: () => true,
  };
  const operations = createConsole({
    session,
    send,
    nowMs: () => 1,
    onChanged: () => undefined,
  });
  operations.select(partition);
  operations.pause();
  let resolveNavigation: (ticket: number) => void = () => undefined;
  const navigated = new Promise<number>((resolve) => {
    resolveNavigation = resolve;
  });
  const creation = createTicketCreation({
    session,
    send,
    onChanged: () => undefined,
    onRelease: (event) => {
      void operations
        .submitMutation(
          event.ticket,
          releaseDraftMutation(
            event.ticket,
            event.authoringVersion,
            event.configurationRevision,
          ),
        )
        .then((result) => {
          creation.releaseAnswered(result);
        });
    },
    onNavigate: (ticket) => {
      resolveNavigation(ticket);
    },
  });
  creation.selectProject(partition, [
    { revision: "ready", readiness: "Ready" },
  ]);
  await creation.selectRevision("ready");
  await creation.submit();
  creation.release();

  assert.equal(await navigated, 8);
  assert.equal(
    requests.at(-1),
    "POST /api/v1/tenants/acme/projects/atlas/operations",
  );
});
