/** What a turn of a member's own session may be spent on. */

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
    ["Live", { spend: "Admitted", route: "Pool", subsidized: false }],
    ["Offline", { spend: "Admitted", route: "Pool", subsidized: false }],
    ["Unregistered", { spend: "NoRunner" }],
  ] as const satisfies readonly (readonly [SessionRunnerStanding, unknown])[]) {
    const asked: string[] = [];
    assert.deepEqual(
      await sessionSpendRoute(
        refusingEverything(asked),
        sessionRoutesAt(
          { Thread: "InCluster" },
          { mine: "Live", inquiry: host, project: "Live" },
        ),
        member,
        own,
        "Thread",
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

test("a member the tenant grants no hosted runs may ask a subsidized lead in cluster, on the subsidy", async () => {
  const asked: string[] = [];
  assert.deepEqual(
    await sessionSpendRoute(
      grantingNoHostedRuns(asked),
      sessionRoutesAt({ Lead: "InCluster" }, undefined, "Subsidized"),
      member,
      project,
      "Inquiry",
    ),
    { spend: "Admitted", route: "InCluster", subsidized: true },
  );
  assert.deepEqual(asked, ["ExecuteHosted"]);
});

test("a member the tenant grants hosted runs asks a subsidized lead in cluster on their grant, not the subsidy", async () => {
  assert.deepEqual(
    await sessionSpendRoute(
      {
        authorize: (principal) => Promise.resolve(memberAuthority(principal)),
        authorizeTenant: (principal) =>
          Promise.resolve(memberAuthority(principal)),
        authorizeSite: projectAccessSiteRefused,
      },
      sessionRoutesAt({ Lead: "InCluster" }, undefined, "Subsidized"),
      member,
      project,
      "Inquiry",
    ),
    { spend: "Admitted", route: "InCluster", subsidized: false },
  );
});

test("a member the tenant grants no hosted runs is refused an inquiry of an own lead in cluster, and a thread of a subsidized one", async () => {
  for (const [offering, kind] of [
    ["Own", "Inquiry"],
    ["Subsidized", "Thread"],
  ] as const) {
    const asked: string[] = [];
    assert.deepEqual(
      await sessionSpendRoute(
        grantingNoHostedRuns(asked),
        sessionRoutesAt(
          { Thread: "InCluster", Lead: "InCluster" },
          undefined,
          offering,
        ),
        member,
        project,
        kind,
      ),
      { spend: "HostedRunsNotGranted" },
      `${offering} ${kind}`,
    );
    assert.deepEqual(asked, ["ExecuteHosted"], `${offering} ${kind}`);
  }
});
