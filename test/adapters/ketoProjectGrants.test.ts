import assert from "node:assert/strict";
import { test } from "node:test";

import { ketoProjectGrants } from "../../src/adapters/keto/projectGrants.ts";
import {
  checkedProjectGrantSettings,
  projectPrincipalGrant,
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  ProjectAccessUnavailable,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";

const settings = checkedProjectGrantSettings({
  writeUrl: "http://keto.test:4467",
  requestTimeoutMs: 250,
});
const request = {
  issuer: "https://issuer.test/",
  subject: "alice",
  tenant: "acme/co",
  project: "web",
  relation: "developers",
};
const principal = oidcPrincipal(request.issuer, request.subject);

/** The URL one request names, whichever of the three shapes `fetch` was handed. */
const askedUrl = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof URL
    ? input
    : new URL(input instanceof Request ? input.url : input);

interface Asked {
  readonly url: URL;
  readonly method: string;
  readonly body: unknown;
}

function fetcherOf(status: number): {
  readonly fetch: typeof fetch;
  readonly asked: Asked[];
} {
  const asked: Asked[] = [];
  return {
    asked,
    fetch: (input, init) => {
      asked.push({
        url: askedUrl(input),
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      });
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response("{}", { status }),
      );
    },
  };
}

test("a grant is a PUT of the tuple it names", async () => {
  const fetcher = fetcherOf(201);
  await ketoProjectGrants(settings, fetcher.fetch).write(
    projectPrincipalGrant(request),
  );
  const asked = fetcher.asked[0];
  assert.ok(asked !== undefined);
  assert.equal(asked.method, "PUT");
  assert.equal(asked.url.pathname, "/admin/relation-tuples");
  assert.deepEqual(asked.body, {
    namespace: "Project",
    object: `${projectAccessTenantObject(request.tenant)}${request.project}`,
    relation: "developers",
    subject_id: principal,
  });
});

test("a tenant relation is written as the tenant's own subject set", async () => {
  const fetcher = fetcherOf(201);
  await ketoProjectGrants(settings, fetcher.fetch).write(
    projectTenantGrant(request),
  );
  assert.deepEqual(fetcher.asked[0]?.body, {
    namespace: "Project",
    object: `${projectAccessTenantObject(request.tenant)}${request.project}`,
    relation: "tenant",
    subject_set: {
      namespace: "Tenant",
      object: projectAccessTenantObject(request.tenant),
      relation: "",
    },
  });
});

test("a revocation is a DELETE naming the same tuple as a query", async () => {
  const fetcher = fetcherOf(204);
  const grants = ketoProjectGrants(settings, fetcher.fetch);
  await grants.remove(tenantPrincipalGrant({ ...request, relation: "admins" }));
  await grants.remove(projectTenantGrant(request));
  const person = fetcher.asked[0];
  assert.ok(person !== undefined);
  assert.equal(person.method, "DELETE");
  assert.equal(person.url.searchParams.get("namespace"), "Tenant");
  assert.equal(
    person.url.searchParams.get("object"),
    projectAccessTenantObject(request.tenant),
  );
  assert.equal(person.url.searchParams.get("relation"), "admins");
  assert.equal(person.url.searchParams.get("subject_id"), principal);
  const inherited = fetcher.asked[1];
  assert.ok(inherited !== undefined);
  assert.equal(
    inherited.url.searchParams.get("subject_set.namespace"),
    "Tenant",
  );
  assert.equal(
    inherited.url.searchParams.get("subject_set.object"),
    projectAccessTenantObject(request.tenant),
  );
  assert.equal(inherited.url.searchParams.get("subject_set.relation"), "");
  assert.equal(inherited.url.searchParams.get("subject_id"), null);
});

test("a write the authority refused raises rather than reporting success", async () => {
  for (const status of [400, 403, 404, 500, 503]) {
    const grants = ketoProjectGrants(settings, fetcherOf(status).fetch);
    await assert.rejects(
      () => grants.write(projectPrincipalGrant(request)),
      ProjectAccessUnavailable,
      `a ${String(status)} was reported as a written grant`,
    );
    await assert.rejects(
      () => grants.remove(projectPrincipalGrant(request)),
      ProjectAccessUnavailable,
      `a ${String(status)} was reported as a removed grant`,
    );
  }
});
