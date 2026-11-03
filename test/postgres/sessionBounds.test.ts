/**
 * The bounds an installed session holds, and the lead settings an installation
 * is seeded with, against the runtime that writes them.
 */

import { sessionCapabilities } from "../../src/contract/rosters.ts";
import {
  builtInToolCapabilities,
  chuggyToolNames,
} from "../../src/contract/sessionTools.ts";
import { leadToolAllowlist } from "../../src/interpreter/leadTools.ts";
import { leadObservationTokensPerDecisionAt009 } from "../../src/adapters/postgres/schema/migrations/009-work-fanout.ts";
import { leadObservationTokensPerDecisionAt011 } from "../../src/adapters/postgres/schema/migrations/011-evaluator-keys.ts";
import { leadDispatchesPerDecision } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSessionPromptCharsMax,
  projectChangeResourceCharsMax,
  sessionIdentityCharsMax,
  sessionPromptCeilings,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../src/interpreter/agentSession.ts";
import { allSessionAttemptEvidences } from "../../src/interpreter/sessionScheduler.ts";
import { allProjectChangeKinds } from "../../src/interpreter/projectChange.ts";
import { migratedDatabase } from "./migrationHarness.ts";

test("the objectives column holds the widest ceiling any kind of session composes", async () => {
  await migratedDatabase("lead_tool_prompt_bound", async (subject) => {
    const held = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = 'agent_session'::regclass
            AND c.conname = 'agent_session_prompt_is_bounded'`,
      )
    ).rows[0]?.definition;
    for (const ceiling of sessionPromptCeilings)
      assert.ok(
        ceiling <= agentSessionPromptCharsMax,
        "the column holds every kind's own ceiling",
      );
    assert.ok(
      held?.includes(String(agentSessionPromptCharsMax)),
      "a kind with a wider ceiling widens this, and its migration replaces the check",
    );
  });
});

test("the installed session constraints match the runtime", async () => {
  await migratedDatabase("lead_composition", async (subject) => {
    const definition = async (relation: string, constraint: string) =>
      (
        await subject.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c
            WHERE c.conrelid = $1::regclass AND c.conname = $2`,
          [relation, constraint],
        )
      ).rows[0]?.definition;

    const members = async (relation: string, constraint: string) => {
      const held = await definition(relation, constraint);
      assert.ok(held !== undefined, `${constraint} was not found`);
      return [...held.matchAll(/'([^']+)'::text/gu)].map((each) => each[1]);
    };

    assert.deepEqual(
      await members("project_change", "project_change_kind_is_known"),
      [...allProjectChangeKinds],
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("session_turn", "session_turn_failure_is_known"),
      [...allSessionTurnFailures],
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("session_attempt", "session_attempt_evidence_is_known"),
      [...allSessionAttemptEvidences],
      "the installed roster matches the runtime",
    );
    assert.deepEqual(
      await members("agent_session", "agent_session_capabilities_are_known"),
      [...allSessionCapabilities],
      "the installed roster matches the runtime",
    );
    for (const [relation, constraint, bound] of [
      [
        "project_change",
        "project_change_resource_is_bounded",
        projectChangeResourceCharsMax,
      ],
      [
        "session_turn",
        "session_turn_identity_is_bounded",
        sessionIdentityCharsMax,
      ],
    ] as const) {
      const held = await definition(relation, constraint);
      assert.ok(held?.includes(String(bound)), `${constraint} holds its bound`);
    }
    const input = await definition(
      "session_turn",
      "session_turn_text_is_bounded",
    );
    assert.ok(input?.includes(String(leadObservationTokensPerDecisionAt011)));
    assert.ok(input?.includes(String(sessionTurnResultCharsMax)));
  });
});

test("fresh selector settings carry current controls and only their initial history", async () => {
  await migratedDatabase("defaults", async (subject) => {
    const current = (
      await subject.query<{
        revision: string;
        mode: string;
        dispatch_mode: string;
        controls: string;
      }>(
        "SELECT revision::text,mode,dispatch_mode,controls FROM selector_runtime_settings",
      )
    ).rows[0];
    assert.ok(current !== undefined);
    assert.equal(current.revision, "1");
    assert.equal(current.mode, "Running");
    assert.equal(current.dispatch_mode, "ApprovalRequired");
    const controls = JSON.parse(current.controls) as {
      toolAllowlist: readonly string[];
      limits: { tokensPerDecision: number; dispatchesPerDecision: number };
    };
    const held = new Set([
      ...sessionCapabilities.flatMap(
        (capability) => builtInToolCapabilities[capability],
      ),
      ...chuggyToolNames(sessionCapabilities),
    ]);
    assert.deepEqual(
      controls.toolAllowlist.filter((tool) => held.has(tool)),
      leadToolAllowlist,
      "the seeded allowlist is the lead's own beside tools no session holds",
    );
    assert.equal(
      controls.limits.tokensPerDecision,
      leadObservationTokensPerDecisionAt011,
    );
    assert.equal(
      controls.limits.dispatchesPerDecision,
      leadDispatchesPerDecision,
    );
    assert.deepEqual(
      (
        await subject.query(
          "SELECT revision::text,mode,dispatch_mode,controls FROM selector_runtime_settings_history",
        )
      ).rows,
      [current],
    );
  });
});

/**
 * The mailbox bound and the seeded budget move together, as they did at 009:
 * a stage weighs its roster, so the widest observation is wider and the
 * floor argued from it follows.
 */
test("the roster arriving widens the mailbox bound and re-seeds the budget with it", async () => {
  await migratedDatabase("evaluatorkeys_mailbox", async (subject) => {
    const bound = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = 'session_turn'::regclass
            AND c.conname = 'session_turn_text_is_bounded'`,
      )
    ).rows[0]?.definition;
    assert.ok(bound !== undefined, "the mailbox bound was not found");
    assert.ok(bound.includes(String(leadObservationTokensPerDecisionAt011)));
    assert.ok(!bound.includes(String(leadObservationTokensPerDecisionAt009)));
    for (const relation of [
      "selector_runtime_settings",
      "selector_runtime_settings_history",
    ]) {
      const rows = (
        await subject.query<{ controls: string }>(
          `SELECT controls FROM ${relation}`,
        )
      ).rows;
      assert.ok(rows.length >= 1, `${relation} is seeded`);
      for (const { controls } of rows) {
        assert.ok(
          controls.includes(
            `"tokensPerDecision":${String(leadObservationTokensPerDecisionAt011)}`,
          ),
          `${relation} carries the re-seeded budget`,
        );
        assert.ok(
          !controls.includes(String(leadObservationTokensPerDecisionAt009)),
          `${relation} no longer carries 009's`,
        );
      }
    }
  });
});
