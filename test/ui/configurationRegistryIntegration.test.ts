import assert from "node:assert/strict";
import test from "node:test";

import { createConfigurationRegistry } from "../../ui/dom/configurationRegistryController.js";

const partition = { tenant: "acme", project: "atlas" };
const commit = "a".repeat(40);

function page(revision: string) {
  return {
    configurations: [
      {
        revision,
        digest: `${revision}-digest`,
        createdAt: "2026-08-24T12:00:00Z",
        readiness: "Incomplete",
        provenance: { source: "Authored" },
      },
    ],
  };
}

test("selecting a project reads its registry and loading more is a no-op without a cursor", async () => {
  const requests: { method: string; url: string }[] = [];
  const controller = createConfigurationRegistry({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request: { method: string; url: string }) => {
      requests.push({ method: request.method, url: request.url });
      return Promise.resolve({ outcome: "Ok" as const, body: page("initial") });
    },
    onChanged: () => undefined,
  });

  await controller.select(partition);
  await controller.next();

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: "/api/v1/tenants/acme/projects/atlas/configurations?limit=50",
    },
  ]);
  assert.equal(controller.state.registry.state, "Data");
});

test("a successful import refreshes the selected project's registry", async () => {
  const requests: string[] = [];
  const controller = createConfigurationRegistry({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request: { method: string; url: string }) => {
      requests.push(`${request.method} ${request.url}`);
      return Promise.resolve(
        request.method === "POST"
          ? { outcome: "Ok" as const, body: { imported: true } }
          : { outcome: "Ok" as const, body: page("current") },
      );
    },
    onChanged: () => undefined,
  });

  await controller.select(partition);
  controller.editImport(commit);
  await controller.import();

  assert.deepEqual(requests, [
    "GET /api/v1/tenants/acme/projects/atlas/configurations?limit=50",
    "POST /api/v1/tenants/acme/projects/atlas/configurations/imports",
    "GET /api/v1/tenants/acme/projects/atlas/configurations?limit=50",
  ]);
  assert.deepEqual(controller.state.import, { status: "Succeeded", commit });
});
