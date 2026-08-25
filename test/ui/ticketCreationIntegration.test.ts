import assert from "node:assert/strict";
import test from "node:test";

import { createTicketCreation } from "../../ui/dom/ticketCreationController.js";
import type { ApiOutcome } from "../../ui/app/protocol.js";
import {
  ticketCreationDraft,
  ticketCreationInitialization,
  ticketCreationPartition,
} from "./ticketCreationFixture.ts";
import { deferred } from "./deferred.ts";

test("controller initializes, creates, emits release, and navigates only after success", async () => {
  const requests: string[] = [];
  const releases: unknown[] = [];
  const navigations: number[] = [];
  const controller = createTicketCreation({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) => {
      requests.push(`${request.method} ${request.url}`);
      return Promise.resolve(
        request.url.endsWith("/configurations")
          ? {
              outcome: "Ok" as const,
              body: {
                ...ticketCreationInitialization.configuration,
                revision: "ticket-test",
                parent: "ready",
              },
            }
          : request.method === "GET"
            ? {
                outcome: "Ok" as const,
                body: request.url.endsWith("/ticket-test")
                  ? {
                      ...ticketCreationInitialization,
                      configuration: {
                        ...ticketCreationInitialization.configuration,
                        revision: "ticket-test",
                        parent: "ready",
                      },
                    }
                  : ticketCreationInitialization,
              }
            : {
                outcome: "Ok" as const,
                body: ticketCreationDraft("ticket-test"),
              },
      );
    },
    onChanged: () => undefined,
    onRelease: (event) => releases.push(event),
    onNavigate: (ticket) => navigations.push(ticket),
    revision: () => "ticket-test",
  });
  controller.selectProject(ticketCreationPartition, [
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
      configurationRevision: "ticket-test",
    },
  ]);
  controller.releaseAnswered({ result: "Succeeded" });
  assert.deepEqual(navigations, [8]);
  assert.deepEqual(requests, [
    "GET /api/v1/tenants/acme/projects/atlas/draft-initializations/ready",
    "POST /api/v1/tenants/acme/projects/atlas/configurations",
    "GET /api/v1/tenants/acme/projects/atlas/draft-initializations/ticket-test",
    "POST /api/v1/tenants/acme/projects/atlas/drafts",
  ]);
});

test("a late initialization cannot replace the newer revision", async () => {
  const first = deferred<ApiOutcome>();
  const controller = createTicketCreation({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) =>
      request.url.endsWith("/older")
        ? first.promise
        : Promise.resolve({
            outcome: "Ok" as const,
            body: {
              ...ticketCreationInitialization,
              configuration: {
                ...ticketCreationInitialization.configuration,
                revision: "newer",
              },
            },
          }),
    onChanged: () => undefined,
    onRelease: () => undefined,
    onNavigate: () => undefined,
  });
  controller.selectProject(ticketCreationPartition, [
    { revision: "older", readiness: "Ready" },
    { revision: "newer", readiness: "Ready" },
  ]);
  const oldRead = controller.selectRevision("older");
  await controller.selectRevision("newer");
  first.answer({ outcome: "Ok", body: ticketCreationInitialization });
  await oldRead;
  assert.equal(controller.state.creation.step, "Editing");
  if (controller.state.creation.step === "Editing")
    assert.equal(
      controller.state.creation.initialization.configuration.revision,
      "newer",
    );
});
