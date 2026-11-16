/**
 * A lead routed to its project's runners is handed to a pool only where a live
 * runner's owner has their Claude account unpaused, on a credential the runner
 * named or, where it named none, on the whole agent, against a real server:
 * `lead_runner_standing` and the pool plane's claim read one rule over the same
 * rows.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { postgresSelectorRuntimeControl } from "../../src/adapters/postgres/selector.ts";
import { leadSystemPrompt } from "../../src/interpreter/leadTools.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  agentAccountHarnessCommitted,
  agentAccountHarnessCredentialsOver,
} from "./agentAccountHarness.ts";
import {
  leadRigNamed,
  leadRigOpen,
  leadRigPooled,
  leadRigProject,
  type LeadRig,
} from "./leadHarness.ts";
import { sessionRigSession, sessionRigTurn } from "./sessionHarness.ts";

let rig: LeadRig;

before(async () => {
  rig = await leadRigOpen();
});

after(async () => {
  await rig.close();
});

/** A project holding a lead whose prompt the selector's settings compose, so no pass replaces it. */
async function usagePauseProject(label: string): Promise<Partition> {
  const partition = await leadRigProject(rig, label);
  const settings = await postgresSelectorRuntimeControl(
    rig.selectorPool,
  ).projectSettings(partition);
  await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
    systemPrompt: leadSystemPrompt({ basePrompt: settings.basePrompt }),
    autoCompactWindow: settings.limits.autoCompactWindow,
  });
  return partition;
}

function usagePauseOwner(label: string) {
  return asPrincipal(`https://issuer.invalid#owner-${label}-${randomUUID()}`);
}

/** Which of the project's sessions one pool is handed, as the pool plane asks. */
async function usagePauseAwaiting(partition: Partition, pool: string) {
  return rig.sessions.harness.query(
    `SELECT s.session FROM worker_pool w
       CROSS JOIN LATERAL pool_sessions_awaiting_claim(
         w.tenant,w.project,w.pool,w.principal,0,8) s
      WHERE w.tenant=$1 AND w.project=$2 AND w.pool=$3`,
    [partition.tenant, partition.project, pool],
  );
}

/** One pool's case of the named rule: why, the Claude credentials it named or none, when each paused credential's pause ends, and whose pause the standing answers it ends at, where it is paused. */
const usagePauseNamedCases = [
  ["one of two named paused", ["work", "home"], { work: 3600, spare: 1800 }],
  [
    "both named paused",
    ["work", "home"],
    { work: 7200, home: 3600, spare: 1800 },
    "home",
  ],
  ["none named and one paused", undefined, { work: 3600, spare: 1800 }, "work"],
] as const;

test("a pool that named credentials takes its lead while one is free and is paused until the earliest of its own ends while none is, and one that named none while any is paused", async () => {
  for (const [why, named, ends, endedBy] of usagePauseNamedCases) {
    const partition = await usagePauseProject(`usage-named-${why}`);
    const owner = usagePauseOwner("named");
    const pool = await leadRigPooled(rig, partition, owner);
    await leadRigNamed(rig, partition, pool, named);
    await agentAccountHarnessCommitted(
      rig.sessions.harness,
      owner,
      "Claude",
      agentAccountHarnessCredentialsOver(ends),
    );
    const [lead] = await rig.sessions.harness.query(
      `SELECT session FROM agent_session WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    );
    await sessionRigTurn(
      rig.sessions,
      partition,
      asSessionId(String(lead?.["session"])),
      why,
    );
    const until =
      endedBy === undefined
        ? null
        : (
            await rig.sessions.harness.query(
              `SELECT resets_at FROM agent_account_usage
                WHERE principal=$1 AND credential=$2`,
              [owner, endedBy],
            )
          )[0]?.["resets_at"];
    assert.deepEqual(
      await rig.sessions.harness.query(
        `SELECT standing,paused_until FROM lead_runner_standing($1,$2,60)`,
        [partition.tenant, partition.project],
      ),
      [
        {
          standing: endedBy === undefined ? "Live" : "Paused",
          paused_until: until,
        },
      ],
      why,
    );
    assert.equal(
      (await usagePauseAwaiting(partition, pool)).length,
      endedBy === undefined ? 1 : 0,
      why,
    );
  }
});
