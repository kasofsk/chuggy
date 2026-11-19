/**
 * An access token's write, asked of a real authority: the token holds no
 * authority of its own, so a maker who loses the role is refused the write the
 * same token made before, with no change to the token.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { threeBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  accessTokenExpiresHeader,
  accessTokenPrefix,
} from "../../src/contract/accessToken.ts";
import { nativeHttpMediaType } from "../../src/contract/http.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { Submission } from "../../src/interpreter/operationInbox.ts";
import { oidcPrincipalSubject } from "../../src/interpreter/principal.ts";
import { projectPrincipalGrant } from "../../src/interpreter/projectGrant.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessSomeone,
} from "./harness.ts";

const secret = `${accessTokenPrefix}${"m".repeat(43)}`;
const expiresAt = "2027-02-03T04:05:06.000Z";

/** A port no case reaches, failing any call. */
function unserved(port: string): never {
  return new Proxy(
    {},
    {
      get: () => () => Promise.reject(new Error(`${port} is not served here`)),
    },
  ) as never;
}

/** The app over the real authority, `secret` a Write token of `maker` in `partition`, and every acceptance its inbox was asked. */
function tokenApp(partition: Partition, maker: Principal) {
  const accepted: Submission[] = [];
  const web = nativeWeb(
    ketoHarnessAccess(),
    unserved("reads"),
    {
      accept: (submission: Submission) => {
        accepted.push(submission);
        return Promise.resolve({ accepted: "InvalidCommand" as const });
      },
    } as never,
    unserved("authoring"),
    unserved("notifications"),
    unserved("backlog"),
  );
  const tokens = {
    authenticate: (presented: string) =>
      Promise.resolve(
        presented === secret
          ? {
              partition,
              token: "6f1c2a4e-0b7d-4c3e-9a1f-2d3e4f5a6b7c",
              name: "nightly",
              access: "Write" as const,
              principal: maker,
              expiresAt,
            }
          : undefined,
      ),
  };
  const app = createNativeHttpApp(
    web,
    threeBearerAuthentication(
      {
        authenticateBearer: () =>
          Promise.resolve({ authenticated: "InvalidToken" as const }),
      },
      { authenticate: () => Promise.resolve(undefined) },
      tokens,
    ),
    unserved("readiness"),
    unserved("installation"),
  );
  return { app, accepted };
}

/** One write in `partition` under the token, keyed `key`. */
function submissionOf(partition: Partition, key: string) {
  return {
    method: "POST" as const,
    url: `/api/v1/tenants/${encodeURIComponent(partition.tenant)}/projects/${encodeURIComponent(partition.project)}/operations`,
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": nativeHttpMediaType,
      "idempotency-key": key,
    },
    payload: {
      operation: `operation-${key}`,
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  };
}

test("a maker who loses the role is refused the write their token made before", async () => {
  const partition = ketoHarnessPartition("token-maker");
  const maker = ketoHarnessSomeone("token-maker");
  const subject = oidcPrincipalSubject(ketoHarnessIssuer, maker);
  assert.ok(subject !== undefined);
  const developer = projectPrincipalGrant({
    issuer: ketoHarnessIssuer,
    subject,
    tenant: partition.tenant,
    project: partition.project,
    relation: "developers",
  });
  const grants = ketoHarnessGrants();
  await grants.write(developer);
  const { app, accepted } = tokenApp(partition, maker);
  await using served = app;

  const before = await served.inject(submissionOf(partition, "before"));
  assert.equal(before.headers[accessTokenExpiresHeader], expiresAt);
  assert.equal(accepted.length, 1, before.body);
  assert.equal(accepted[0]?.viaToken?.name, "nightly");

  await grants.remove(developer);
  const after = await served.inject(submissionOf(partition, "after"));
  assert.equal(after.statusCode, 404, after.body);
  assert.equal(after.headers[accessTokenExpiresHeader], expiresAt);
  assert.equal(
    accepted.length,
    1,
    "the write after the loss reached the inbox",
  );
});
