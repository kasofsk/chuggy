/** What a turn of a member's own session may be spent on. */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionRunnerStanding } from "../../src/contract/rosters.ts";
import { memberScopePartition } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
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
