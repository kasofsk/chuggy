import assert from "node:assert/strict";
import test from "node:test";

import { createTicketCreation } from "../../ui/dom/ticketCreationController.js";
import {
  ticketCreationDraft,
  ticketCreationInitialization,
  ticketCreationPartition,
} from "./ticketCreationFixture.ts";

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
          ? { outcome: "Ok" as const, body: ticketCreationInitialization }
          : {
              outcome: "Ok" as const,
              body: ticketCreationDraft(),
            },
      );
    },
    onChanged: () => undefined,
    onRelease: (event) => releases.push(event),
    onNavigate: (ticket) => navigations.push(ticket),
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
