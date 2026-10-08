/**
 * The landings route over its real service and the real project access, with
 * the store and the artifact port beneath them doubled: what a reader is
 * answered, and who is answered nothing.
 *
 * EVERY BODY IS READ THROUGH THE SCHEMA THE ENDPOINT PUBLISHES, since that
 * schema is what a console is typed from, and then held whole, so a field the
 * schema would let through and the route should not send fails a case.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import {
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  conflictManifestText,
} from "../../src/interpreter/finalizerPreparation.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  ticketLandingReads,
  type TicketLandingRecord,
} from "../../src/interpreter/ticketLandings.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import {
  ticketReadApp,
  ticketReadRefusesWhatTheTicketDoes,
} from "./ticketReadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/tickets/7/landings";
const authorized = { authorization: "Bearer valid" };
const targetCommit = asGitObjectId("a".repeat(40));
const candidateCommit = asGitObjectId("b".repeat(40));
const landedCommit = asGitObjectId("c".repeat(40));
const preparedAt = asPublicInstant("2026-10-07T12:00:00.000000Z");

/** A failed landing whose conflict manifest names one path, and a landing after it that merged. */
const failedThenLanded: readonly TicketLandingRecord[] = [
  {
    cycle: 1,
    generation: 1,
    request: "Fulfilled",
    concluded: "NeedsWork",
    attempts: 1,
    attempt: {
      outcome: "Failed",
      failureKind: "MergeConflict",
      targetRef: "refs/heads/main",
      targetCommit,
      preparedAt,
    },
    conflictManifest: asProjectArtifactId("conflict-1"),
    approvalOpen: false,
  },
  {
    cycle: 2,
    generation: 1,
    request: "Fulfilled",
    concluded: "Succeeded",
    hold: {
      kind: "ProposalAbsent",
      passes: 1,
      since: preparedAt,
    },
    attempts: 1,
    attempt: {
      outcome: "Prepared",
      targetRef: "refs/heads/main",
      targetCommit,
      candidateCommit,
      preparedAt,
    },
    approvalOpen: false,
    proposal: {
      url: "https://forge.example/acme/atlas/pull/9",
      headRef: "refs/heads/chuggy/7",
      baseRef: "refs/heads/main",
      creation: "Created",
    },
    landedCommit,
  },
];

const manifest = new TextEncoder().encode(
  conflictManifestText({
    request: "request-1",
    attempt: asFinalizationAttemptId("attempt-1"),
    strategy: "Merge",
    candidate: candidateCommit,
    target: { ref: asGitRefName("refs/heads/main"), commit: targetCommit },
    conflict: { paths: ["one.ts"], truncated: false },
  }),
);

/** The app with the landings route over its real service, the caller holding the kinds of access given. */
function appOver(
  access: readonly ProjectAccessKind[],
  records: readonly TicketLandingRecord[] | undefined,
  read: string[],
) {
  const project = memoryProjectAccess();
  project.grant({ partition, principal: caller, access: new Set(access) });
  const landings = ticketLandingReads({
    access: project,
    store: {
      landings: (_partition, ticket) => {
        read.push(`landings ${String(ticket)}`);
        return Promise.resolve(records);
      },
    },
    artifacts: {
      readArtifact: (request) => {
        read.push(`artifact ${request.artifact}`);
        return Promise.resolve({ read: "Content", content: manifest });
      },
    },
  });
  return ticketReadApp(caller, { landings });
}

const notFound = {
  error: { code: "NotFound", message: "Resource not found." },
};

test("the route is the one the route table names", () => {
  assert.equal(
    nativeHttpRoutes.ticketLandings.replace(/:([a-z]+)/gu, (_whole, name) =>
      name === "tenant" ? "acme" : name === "project" ? "atlas" : "7",
    ),
    url,
  );
  assert.equal(nativeHttpEndpoints.ticketLandings.method, "GET");
  assert.equal(
    nativeHttpEndpoints.ticketLandings.path,
    nativeHttpRoutes.ticketLandings,
  );
});

test("a reader is answered each landing oldest first, a failed one with its conflict and a landed one with its commit and its pull request", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], failedThenLanded, read);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  const body: unknown = found.json();
  assert.deepEqual(
    nativeHttpEndpoints.ticketLandings.response.parse(body),
    body,
  );
  assert.deepEqual(body, {
    landings: [
      {
        state: "Failed",
        cycle: 1,
        generation: 1,
        attempts: 1,
        attempt: {
          outcome: "Failed",
          failureKind: "MergeConflict",
          targetRef: "refs/heads/main",
          targetCommit,
          preparedAt,
        },
        conflict: { paths: ["one.ts"], truncated: false },
      },
      {
        state: "Landed",
        landedCommit,
        cycle: 2,
        generation: 1,
        attempts: 1,
        attempt: {
          outcome: "Prepared",
          targetRef: "refs/heads/main",
          targetCommit,
          candidateCommit,
          preparedAt,
        },
        proposal: {
          url: "https://forge.example/acme/atlas/pull/9",
          headRef: "refs/heads/chuggy/7",
          baseRef: "refs/heads/main",
          creation: "Created",
        },
      },
    ],
    truncated: false,
  });
  assert.deepEqual(read, ["landings 7", "artifact conflict-1"]);
});

test("a ticket that has had no landing answers none", async () => {
  await using app = appOver(["Read"], [], []);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { landings: [], truncated: false });
});

test("a caller who may not read the project is not found, as one asking after a ticket it does not have is, and nothing is read for the first", async () => {
  for (const held of [
    [],
    ["Administer"],
    ["Mutate", "Execute"],
  ] as readonly ProjectAccessKind[][]) {
    const read: string[] = [];
    await using app = appOver(held, failedThenLanded, read);
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 404, held.join());
    assert.deepEqual(found.json(), notFound);
    assert.deepEqual(read, [], held.join());
  }
  const read: string[] = [];
  await using app = appOver(["Read"], undefined, read);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 404);
  assert.deepEqual(found.json(), notFound);
  assert.deepEqual(read, ["landings 7"]);
});

test("a caller who presents no bearer, or one that is not valid, is answered before anything is read", async () => {
  for (const headers of [{}, { authorization: "Bearer other" }]) {
    const read: string[] = [];
    await using app = appOver(["Read"], failedThenLanded, read);
    const found = await app.inject({ url, headers });
    assert.equal(found.statusCode, 401);
    assert.deepEqual(read, []);
  }
});

test("a ticket named by something other than its number is refused as the ticket's own read refuses it", async () => {
  await ticketReadRefusesWhatTheTicketDoes(
    (read) => appOver(["Read"], failedThenLanded, read),
    "landings",
  );
});

test("the route takes no write", async () => {
  await using app = appOver(["Read", "Mutate", "Administer"], [], []);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const)
    assert.equal(
      (await app.inject({ method, url, headers: authorized })).statusCode,
      404,
      method,
    );
});
