/**
 * The repository tree route over its real service and the real project
 * access, with the bindings and the tree source beneath them doubled.
 *
 * EVERY BODY IS READ THROUGH THE SCHEMA THE ENDPOINT PUBLISHES, and then held
 * whole, so a field the schema would let through and the route should not
 * send fails a case.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asRepositoryLanding } from "../../src/interpreter/repositoryBinding.ts";
import {
  repositoryTreeReads,
  type RepositoryTreeSource,
} from "../../src/interpreter/repositoryTree.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { callerApp } from "./callerAppFixture.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const caller = asPrincipal("issuer geoff");
const route = "/api/v1/tenants/acme/projects/atlas/repositories/tree";
const authorized = { authorization: "Bearer valid" };
const bound = asRepositoryId("https://forge.example/acme/atlas.git");
const head = asGitObjectId("a".repeat(40));
const named = asGitObjectId("b".repeat(40));

function url(fields: Readonly<Record<string, string>>): string {
  return `${route}?${new URLSearchParams(fields).toString()}`;
}

/** The app with the tree route over its real service, the caller holding the kinds of access given and every ask of git written down. */
function appOver(
  access: readonly ProjectAccessKind[],
  asked: string[],
  readable: RepositoryTreeSource["readable"] = "Scratch",
) {
  const project = memoryProjectAccess();
  project.grant({ partition, principal: caller, access: new Set(access) });
  const source: RepositoryTreeSource =
    readable === "Unconfigured"
      ? { readable }
      : {
          readable,
          heads: {
            defaultBranch: () => {
              asked.push("head");
              return Promise.resolve({
                read: "Branch",
                branch: asGitRefName("refs/heads/main"),
                commit: head,
              });
            },
          },
          trees: {
            list: (request) => {
              asked.push(`tree ${request.commit} ${request.directory}`);
              return Promise.resolve({
                read: "Listed",
                entries: [
                  { name: "lib", kind: "Directory" },
                  { name: "index.ts", kind: "File", executable: false },
                  { name: "current", kind: "Symlink" },
                  { name: "vendor", kind: "Submodule" },
                ],
                truncated: false,
              });
            },
          },
        };
  const repositoryTree = repositoryTreeReads({
    access: project,
    landing: {
      landing: (_partition, repository) =>
        Promise.resolve(
          repository === bound
            ? {
                repository: bound,
                boundAt: "2026-10-01T00:00:00.000000Z",
                landing: asRepositoryLanding("Push"),
              }
            : undefined,
        ),
    },
    bindings: {
      binding: (_partition, repository) =>
        Promise.resolve(
          repository === bound
            ? {
                partition,
                repository: bound,
                recoveryEpoch: asRecoveryEpoch("epoch"),
              }
            : undefined,
        ),
    },
    source,
  });
  return callerApp(caller, { repositoryTree });
}

const notFound = {
  error: { code: "NotFound", message: "Resource not found." },
};

test("the route is the one the route table names, beside the other repository routes", () => {
  assert.equal(
    nativeHttpRoutes.projectRepositoryTree.replace(
      /:([a-z]+)/gu,
      (_whole, name) => (name === "tenant" ? "acme" : "atlas"),
    ),
    route,
  );
  assert.equal(nativeHttpEndpoints.repositoryTree.method, "GET");
});

test("a reader lists the root at the head, and a subdirectory at the commit that read named", async () => {
  const asked: string[] = [];
  await using app = appOver(["Read"], asked);
  const root = await app.inject({
    url: url({ repository: bound }),
    headers: authorized,
  });
  assert.equal(root.statusCode, 200);
  const body: unknown = root.json();
  assert.deepEqual(
    nativeHttpEndpoints.repositoryTree.response.parse(body),
    body,
  );
  assert.deepEqual(body, {
    read: "Listed",
    entries: [
      { name: "lib", kind: "Directory" },
      { name: "index.ts", kind: "File", executable: false },
      { name: "current", kind: "Symlink" },
      { name: "vendor", kind: "Submodule" },
    ],
    truncated: false,
    commit: head,
    directory: "",
  });
  const lib = await app.inject({
    url: url({ repository: bound, directory: "lib", commit: named }),
    headers: authorized,
  });
  assert.equal(lib.statusCode, 200);
  assert.equal(lib.json<{ commit: string }>().commit, named);
  assert.deepEqual(asked, ["head", `tree ${head} `, `tree ${named} lib`]);
});

test("a repository the project does not bind is not found, as a caller who may not read the project is, and git is asked nothing", async () => {
  const asked: string[] = [];
  await using app = appOver(["Read"], asked);
  const other = await app.inject({
    url: url({ repository: "https://forge.example/other/secret.git" }),
    headers: authorized,
  });
  assert.equal(other.statusCode, 404);
  assert.deepEqual(other.json(), notFound);
  await using denied = appOver(["Mutate", "Administer"], asked);
  const refused = await denied.inject({
    url: url({ repository: bound }),
    headers: authorized,
  });
  assert.equal(refused.statusCode, 404);
  assert.deepEqual(refused.json(), notFound);
  assert.deepEqual(asked, []);
});

test("a deployment with no scratch answers that it cannot read", async () => {
  await using app = appOver(["Read"], [], "Unconfigured");
  const found = await app.inject({
    url: url({ repository: bound }),
    headers: authorized,
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), {
    read: "Unavailable",
    unavailable: "Scratch",
  });
});

test("a read naming no repository, an unknown field, a directory git would misread or a commit of no width is refused", async () => {
  const asked: string[] = [];
  await using app = appOver(["Read"], asked);
  for (const fields of [
    {},
    { repository: bound, path: "lib" },
    { repository: bound, directory: "../lib" },
    { repository: bound, directory: "lib/" },
    { repository: bound, commit: "HEAD" },
  ]) {
    const found = await app.inject({ url: url(fields), headers: authorized });
    assert.equal(found.statusCode, 400, JSON.stringify(fields));
  }
  assert.deepEqual(asked, []);
});

test("the route takes no write", async () => {
  await using app = appOver(["Read", "Mutate", "Administer"], []);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const)
    assert.equal(
      (
        await app.inject({
          method,
          url: url({ repository: bound }),
          headers: authorized,
        })
      ).statusCode,
      404,
      method,
    );
});
