/**
 * The hosted-runs read: whether the project's tenant grants the caller the
 * hosted runs a thread or an inquiry spends, answered by the predicate every
 * hosted refusal asks.
 *
 * THE REFUSED CASE IS THE ONE WITH TEETH. A read whose project gate was dropped
 * answers a stranger the same `false` a member without the grant is told, so
 * only a case where the tenant does grant the stranger can tell the two apart.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import { ProjectAccessUnavailable } from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "./nativeWebFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");

function boundary(standing: {
  readonly reads: boolean;
  readonly hosted: boolean;
}) {
  const access = memoryProjectAccess();
  if (standing.reads)
    access.grant({ partition, principal: member, access: new Set(["Read"]) });
  if (standing.hosted)
    access.grantTenant({
      tenant: partition.tenant,
      principal: member,
      access: new Set(["ExecuteHosted"]),
    });
  return { access, web: nativeWeb(access, ...unaskedNativeWebPorts) };
}

test("a member whose tenant grants them hosted runs is told so", async () => {
  const { web } = boundary({ reads: true, hosted: true });

  assert.deepEqual(await web.hostedRuns(member, partition), {
    result: "Authorized",
    value: true,
  });
});

test("a member whose tenant grants them none is told so", async () => {
  const { web } = boundary({ reads: true, hosted: false });

  assert.deepEqual(await web.hostedRuns(member, partition), {
    result: "Authorized",
    value: false,
  });
});

test("a caller who may not read the project is not found, whatever the tenant grants", async () => {
  const { web } = boundary({ reads: false, hosted: true });

  assert.deepEqual(await web.hostedRuns(member, partition), {
    result: "NotFound",
  });
});

/** The project question answers and the tenant question does not, so the
 * outage a case sees is the grant's own and not the gate's in front of it. */
test("a tenant question the authority cannot answer is an outage, not a refusal", async () => {
  const { access } = boundary({ reads: true, hosted: true });
  const web = nativeWeb(
    {
      ...access,
      authorizeTenant: () =>
        Promise.reject(
          new ProjectAccessUnavailable("the tenant did not answer"),
        ),
    },
    ...unaskedNativeWebPorts,
  );

  await assert.rejects(
    web.hostedRuns(member, partition),
    ProjectAccessUnavailable,
  );
});
