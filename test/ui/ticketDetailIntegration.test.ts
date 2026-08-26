import assert from "node:assert/strict";
import test from "node:test";

import { createTicketDetail } from "../../ui/console/dom/ticketDetailController.js";
import { deferred } from "./deferred.ts";

const partition = { tenant: "acme", project: "atlas" };

function raceOutcome(url: string, continuation = false) {
  const ticket = Number(/\/(?:tickets|drafts)\/(\d+)/.exec(url)?.[1] ?? 7);
  if (url.includes("/drafts/"))
    return {
      outcome: "Ok" as const,
      body: {
        partition,
        ticket,
        authoringVersion: 1,
        state: "Draft",
        configurationRevision: `revision-${String(ticket)}`,
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
    };
  if (url.includes("/executions?"))
    return {
      outcome: "Ok" as const,
      body: { executions: [], ...(continuation ? { nextAfter: "next" } : {}) },
    };
  if (url.includes("/configurations/"))
    return {
      outcome: "Ok" as const,
      body: {
        partition,
        revision: url.endsWith("revision-8") ? "revision-8" : "revision-7",
        parent: undefined,
        canonical: "{}",
        digest: "digest",
      },
    };
  return {
    outcome: "Ok" as const,
    body: { ticket, phase: "Pending", sequence: ticket },
  };
}

function raceController(
  accessToken: () => Promise<string | undefined>,
  continuation = false,
) {
  const requests: string[] = [];
  const controller = createTicketDetail({
    session: { accessToken },
    send: (request) => {
      requests.push(request.url);
      return Promise.resolve(raceOutcome(request.url, continuation));
    },
    onChanged: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onRelease: () => undefined,
    onExecution: () => undefined,
    onArtifact: () => undefined,
  });
  return { controller, requests };
}

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
    ["release", 7],
    ["execution", "execution-1"],
    ["artifact", "execution-1", 2],
  ]);
});

test("a selection waiting for credentials cannot overtake a newer ticket", async () => {
  const firstToken = deferred<string | undefined>();
  let tokens = 0;
  const controller = createTicketDetail({
    session: {
      accessToken: () => {
        tokens += 1;
        return tokens === 1 ? firstToken.promise : Promise.resolve("token");
      },
    },
    send: (request) => {
      if (request.url.includes("/drafts/"))
        return Promise.resolve({ outcome: "Absent" as const });
      if (request.url.includes("/executions?"))
        return Promise.resolve({
          outcome: "Ok" as const,
          body: { executions: [] },
        });
      return Promise.resolve({
        outcome: "Ok" as const,
        body: { ticket: 8, phase: "Pending", sequence: 2 },
      });
    },
    onChanged: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onRelease: () => undefined,
    onExecution: () => undefined,
    onArtifact: () => undefined,
  });
  const oldRead = controller.select(partition, 7);
  await controller.select(partition, 8);
  firstToken.answer("token");
  await oldRead;
  assert.equal(controller.state.detail?.ticket, 8);
});

test("a configuration credential delay cannot overwrite a newer ticket", async () => {
  const delayedToken = deferred<string | undefined>();
  const credentialRequested = deferred<void>();
  let tokens = 0;
  const { controller, requests } = raceController(() => {
    tokens += 1;
    if (tokens !== 2) return Promise.resolve("token");
    credentialRequested.answer();
    return delayedToken.promise;
  });
  const oldRead = controller.select(partition, 7);
  await credentialRequested.promise;
  await controller.select(partition, 8);
  delayedToken.answer("token");
  await oldRead;
  assert.equal(controller.state.detail?.ticket, 8);
  assert.equal(
    requests.includes(
      "/api/v1/tenants/acme/projects/atlas/configurations/revision-7",
    ),
    false,
  );
});

test("a load-more credential delay cannot mark a newer ticket loading", async () => {
  const delayedToken = deferred<string | undefined>();
  let tokens = 0;
  const { controller } = raceController(() => {
    tokens += 1;
    return tokens === 3 ? delayedToken.promise : Promise.resolve("token");
  }, true);
  await controller.select(partition, 7);
  const oldRead = controller.nextExecutions();
  await controller.select(partition, 8);
  delayedToken.answer("token");
  await oldRead;
  assert.equal(controller.state.detail?.ticket, 8);
  assert.notEqual(controller.state.detail?.executions.state, "Loading");
});
