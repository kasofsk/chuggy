import assert from "node:assert/strict";
import test from "node:test";

import { createTicketDetail } from "../../ui/dom/ticketDetailController.js";

const partition = { tenant: "acme", project: "atlas" };

test("select composes ticket, draft, configuration, and ticket executions", async () => {
  const requests: string[] = [];
  const controller = createTicketDetail({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) => {
      requests.push(request.url);
      if (request.url.endsWith("/tickets/7"))
        return Promise.resolve({
          outcome: "Ok" as const,
          body: { ticket: 7, phase: "Working", sequence: 11 },
        });
      if (request.url.endsWith("/drafts/7"))
        return Promise.resolve({
          outcome: "Ok" as const,
          body: {
            partition,
            ticket: 7,
            authoringVersion: 2,
            state: "Released",
            configurationRevision: "revision-1",
            authoring: {
              dependencies: [],
              program: [],
              workFanout: 1,
              reworkPolicy: { type: "BudgetedRework", value: 0 },
              finalizationPricing: "DeadlineOnly",
              resumePricing: "RetryCharged",
              finalizer: "ManagedFinalizer",
            },
          },
        });
      if (request.url.includes("/executions?"))
        return Promise.resolve({
          outcome: "Ok" as const,
          body: { executions: [] },
        });
      return Promise.resolve({
        outcome: "Ok" as const,
        body: {
          partition,
          revision: "revision-1",
          canonical: "{}",
          digest: "digest-1",
        },
      });
    },
    onChanged: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onRelease: () => undefined,
    onExecution: () => undefined,
    onArtifact: () => undefined,
  });

  await controller.select(partition, 7);

  assert.deepEqual(requests.slice(0, 3).sort(), [
    "/api/v1/tenants/acme/projects/atlas/drafts/7",
    "/api/v1/tenants/acme/projects/atlas/executions?limit=50&ticket=7",
    "/api/v1/tenants/acme/projects/atlas/tickets/7",
  ]);
  assert.equal(
    requests[3],
    "/api/v1/tenants/acme/projects/atlas/configurations/revision-1",
  );
  assert.equal(controller.state.detail?.identity.state, "Data");
  assert.equal(controller.state.detail?.configuration.state, "Data");
});

test("navigation callbacks carry stable ticket and resource identities", async () => {
  const calls: (string | number)[][] = [];
  const controller = createTicketDetail({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) =>
      Promise.resolve(
        request.url.endsWith("/drafts/7")
          ? {
              outcome: "Ok" as const,
              body: {
                partition,
                ticket: 7,
                authoringVersion: 1,
                state: "Draft",
                configurationRevision: "revision-1",
                authoring: {
                  dependencies: [],
                  program: [],
                  workFanout: 1,
                  reworkPolicy: { type: "BudgetedRework", value: 0 },
                  finalizationPricing: "DeadlineOnly",
                  resumePricing: "RetryCharged",
                  finalizer: "ManagedFinalizer",
                },
              },
            }
          : request.url.includes("/executions?")
            ? { outcome: "Ok" as const, body: { executions: [] } }
            : request.url.includes("/configurations/")
              ? {
                  outcome: "Ok" as const,
                  body: {
                    partition,
                    revision: "revision-1",
                    canonical: "{}",
                    digest: "digest-1",
                  },
                }
              : {
                  outcome: "Ok" as const,
                  body: { ticket: 7, phase: "Pending", sequence: 1 },
                },
      ),
    onChanged: () => undefined,
    onEdit: (ticket) => calls.push(["edit", ticket]),
    onDelete: (ticket) => calls.push(["delete", ticket]),
    onRelease: (ticket) => calls.push(["release", ticket]),
    onExecution: (execution) => calls.push(["execution", execution]),
    onArtifact: (execution, ordinal) =>
      calls.push(["artifact", execution, ordinal]),
  });
  await controller.select(partition, 7);
  controller.edit();
  controller.delete();
  controller.release();
  controller.openExecution("execution-1");
  controller.openArtifact("execution-1", 2);
  assert.deepEqual(calls, [
    ["edit", 7],
    ["delete", 7],
    ["release", 7],
    ["execution", "execution-1"],
    ["artifact", "execution-1", 2],
  ]);
});
