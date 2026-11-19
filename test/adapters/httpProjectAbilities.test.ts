/**
 * The abilities route over the real boundary: what a member is answered, what
 * a stranger is, what an access token narrows them to, and what an authority
 * that cannot answer becomes on the wire.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  accessTokenExpiresHeader,
  type AccessTokenAccess,
} from "../../src/contract/accessToken.ts";
import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";

import { asInstallationId, asTicketId } from "../../src/domain/ids.ts";
import type { AuthoringStore } from "../../src/interpreter/authoring.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import {
  allProjectAccessKinds,
  ProjectAccessUnavailable,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { briefFinalizationDefault } from "../../src/interpreter/ticketBrief.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "../interpreter/nativeWebFixtures.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/abilities";
const authorized = { authorization: "Bearer valid" };

function appOver(access: ProjectAccess) {
  const web = nativeWeb(access, ...unaskedNativeWebPorts);
  return servedNativeHttpApp({
    ...unservedNativeWeb,
    abilities: (principal, partition) => web.abilities(principal, partition),
  });
}

function accessOf(kinds: readonly ProjectAccessKind[]): ProjectAccess {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: caller, access: new Set(kinds) });
  return access;
}

test("a member is answered exactly its abilities", async () => {
  await using app = appOver(
    accessOf([
      "Read",
      "DispatchTicket",
      "OverrideTicketConfig",
      "SkipPlannedEvaluations",
    ]),
  );
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  const body: unknown = found.json();
  assert.deepEqual(body, {
    principal: caller,
    mutate: false,
    dispatch: true,
    manageSelector: false,
    overrideTicketConfig: true,
    skipPlannedEvaluations: true,
    mergeProposals: false,
    makeAccessTokens: false,
    administer: false,
    writeEpic: false,
  });
  assert.deepEqual(nativeHttpEndpoints.abilities.response.parse(body), body);
});

/** The store writes the authority's subject with the draft, and a ticket reads it back as `creator`. */
test("the principal a caller is answered is the creator its own draft records", async () => {
  const recorded: string[] = [];
  const authoring = {
    configuration: () => Promise.resolve(undefined),
    createDraft: (input) => {
      recorded.push(input.authority.subject);
      return Promise.resolve({
        created: "Created",
        draft: {
          partition: input.partition,
          ticket: asTicketId(1),
          authoringVersion: 1,
          state: "Draft",
          configurationRevision: input.configurationRevision,
          authoring: input.authoring,
          brief: { ...input.brief, finalization: briefFinalizationDefault },
        },
      });
    },
  } satisfies Pick<AuthoringStore, "configuration" | "createDraft">;
  const [reads, inbox, , ...rest] = unaskedNativeWebPorts;
  const web = nativeWeb(
    accessOf(["Read", "Mutate"]),
    reads,
    inbox,
    authoring as unknown as AuthoringStore,
    ...rest,
  );
  await using app = servedNativeHttpApp({
    ...unservedNativeWeb,
    abilities: (principal, partition) => web.abilities(principal, partition),
    createDraft: (principal, input) => web.createDraft(principal, input),
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/drafts",
    headers: {
      ...authorized,
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      configurationRevision: "revision",
      configurationDigest: "a".repeat(64),
      expectedProjectSequence: 7,
      authoring: {
        dependencies: [],
        program: [{ key: 1, evaluators: [{ key: 1 }] }],
      },
      brief: { intent: "Learn who I act as.", links: [] },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(recorded, [caller]);
  assert.equal(
    nativeHttpEndpoints.abilities.response.parse(found.json()).principal,
    recorded[0],
  );
});

test("a caller who may not read the project is not found", async () => {
  await using app = appOver(accessOf(["Mutate", "Administer"]));
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 404);
});

test("an ability the authority cannot answer is a 503 a reader may retry", async () => {
  const access = accessOf(["Read"]);
  await using app = appOver({
    ...access,
    authorize: (principal, partition, kind) =>
      kind === "Administer"
        ? Promise.reject(new ProjectAccessUnavailable("administer is down"))
        : access.authorize(principal, partition, kind),
  });
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 503);
  assert.equal(found.headers["retry-after"], "1");
});

test("a caller with no bearer is unauthenticated", async () => {
  await using app = appOver(accessOf(["Read"]));
  const found = await app.inject({ url });
  assert.equal(found.statusCode, 401);
});

const expiresAt = "2027-03-04T05:06:07.000Z";

/** The abilities route under a token of `access` its maker `caller` presents, holding every permit. */
function tokenAppOver(access: AccessTokenAccess) {
  const web = nativeWeb(
    accessOf(allProjectAccessKinds),
    ...unaskedNativeWebPorts,
  );
  return createNativeHttpApp(
    {
      ...unservedNativeWeb,
      abilities: (principal, partition, viaToken) =>
        web.abilities(principal, partition, viaToken),
    },
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: {
            principal: caller,
            viaToken: {
              token: "token",
              name: "nightly",
              access,
              partition,
              expiresAt,
            },
          },
        }),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
  );
}

test("under a Read token every ability is false, and the answer names the token's expiry", async () => {
  await using app = tokenAppOver("Read");
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.equal(found.headers[accessTokenExpiresHeader], expiresAt);
  assert.deepEqual(found.json(), {
    principal: caller,
    mutate: false,
    dispatch: false,
    manageSelector: false,
    overrideTicketConfig: false,
    skipPlannedEvaluations: false,
    mergeProposals: false,
    makeAccessTokens: false,
    administer: false,
    writeEpic: false,
  });
});

test("under a Write token a maker holding everything may neither make tokens nor merge", async () => {
  await using app = tokenAppOver("Write");
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.equal(found.headers[accessTokenExpiresHeader], expiresAt);
  assert.deepEqual(found.json(), {
    principal: caller,
    mutate: true,
    dispatch: true,
    manageSelector: true,
    overrideTicketConfig: true,
    skipPlannedEvaluations: true,
    mergeProposals: false,
    makeAccessTokens: false,
    administer: true,
    writeEpic: true,
  });
});

test("a token refused a route is answered 403 naming its expiry, under either access", async () => {
  for (const access of ["Read", "Write"] as const) {
    await using app = tokenAppOver(access);
    const refused = await app.inject({
      url: "/api/v1/tenants/acme/projects/atlas/access-tokens",
      headers: authorized,
    });
    assert.equal(refused.statusCode, 403, access);
    assert.equal(refused.headers[accessTokenExpiresHeader], expiresAt, access);
  }
  await using app = tokenAppOver("Read");
  const written = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/operations",
    headers: {
      ...authorized,
      "content-type": "application/vnd.chuggy.v1+json",
      "idempotency-key": "key",
    },
    body: {},
  });
  assert.equal(written.statusCode, 403);
  assert.equal(written.headers[accessTokenExpiresHeader], expiresAt);
});
