/** What a turn of a member's thread may be spent on. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionRunnerStanding } from "../../src/contract/rosters.ts";
import { memberScopePartition } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { sessionSpendRoute } from "../../src/interpreter/sessionPlacement.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";
import { sessionRoutesAt } from "./sessionRoutesFixture.ts";

const member = asPrincipal("principal-spend");
const own = memberScopePartition(asTenantId("tenant-spend"), member);

/** Access that answers nothing and records every question it was asked. */
function refusingEverything(asked: string[]): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) => {
      asked.push(kind);
      return Promise.resolve(undefined);
    },
    authorizeTenant: (_principal, _tenant, kind) => {
      asked.push(kind);
      return Promise.resolve(undefined);
    },
    authorizeSite: projectAccessSiteRefused,
  };
}

test("a member's own turn is spent on their chat host whatever the site routes, asks no grant, and is refused where they have none", async () => {
  for (const [host, spent] of [
    ["Live", { spend: "Admitted", route: "Pool" }],
    ["Offline", { spend: "Admitted", route: "Pool" }],
    ["Unregistered", { spend: "NoRunner" }],
  ] as const satisfies readonly (readonly [SessionRunnerStanding, unknown])[]) {
    const asked: string[] = [];
    assert.deepEqual(
      await sessionSpendRoute(
        refusingEverything(asked),
        sessionRoutesAt(
          { Thread: "InCluster" },
          { mine: "Live", inquiry: host },
        ),
        member,
        own,
      ),
      spent,
      host,
    );
    assert.deepEqual(asked, [], host);
  }
});

const project = {
  tenant: asTenantId("tenant-spend"),
  project: asProjectId("project-spend"),
};

/** Access admitting the member to the project and refusing the tenant's hosted grant, recording each tenant question. */
function grantingNoHostedRuns(asked: string[]): ProjectAccess {
  return {
    authorize: (principal) => Promise.resolve(memberAuthority(principal)),
    authorizeTenant: (_principal, _tenant, kind) => {
      asked.push(kind);
      return Promise.resolve(undefined);
    },
    authorizeSite: projectAccessSiteRefused,
  };
}

test("a member the tenant grants no hosted runs is refused a thread in cluster", async () => {
  const asked: string[] = [];
  assert.deepEqual(
    await sessionSpendRoute(
      grantingNoHostedRuns(asked),
      sessionRoutesAt({ Thread: "InCluster" }),
      member,
      project,
    ),
    { spend: "HostedRunsNotGranted" },
  );
  assert.deepEqual(asked, ["ExecuteHosted"]);
});

test("a project's thread on Pool is spent on its member's chat host, and refused where they have none, whatever their own chat's host stands at", async () => {
  for (const [mine, spent] of [
    ["Live", { spend: "Admitted", route: "Pool" }],
    ["Offline", { spend: "Admitted", route: "Pool" }],
    ["Unregistered", { spend: "NoRunner" }],
  ] as const satisfies readonly (readonly [SessionRunnerStanding, unknown])[]) {
    const asked: string[] = [];
    assert.deepEqual(
      await sessionSpendRoute(
        grantingNoHostedRuns(asked),
        sessionRoutesAt(
          { Thread: "Pool" },
          {
            mine,
            inquiry: mine === "Unregistered" ? "Live" : "Unregistered",
          },
        ),
        member,
        project,
      ),
      spent,
      mine,
    );
    assert.deepEqual(asked, [], mine);
  }
});
