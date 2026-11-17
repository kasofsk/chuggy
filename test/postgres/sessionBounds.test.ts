/** The bounds an installed session holds, against the runtime that writes them. */

import { leadObservationTokensPerDecisionAt009 } from "../../src/adapters/postgres/schema/migrations/009-work-fanout.ts";
import { leadObservationTokensPerDecisionAt011 } from "../../src/adapters/postgres/schema/migrations/011-evaluator-keys.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSessionPromptCharsMax,
  projectChangeResourceCharsMax,
  sessionIdentityCharsMax,
  sessionTurnResultCharsMax,
} from "../../src/contract/http.ts";
import {
  allSessionCapabilities,
  allSessionKinds,
} from "../../src/interpreter/agentSession.ts";
import { allSessionTurnFailures } from "../../src/interpreter/agentSession.ts";
import { allSessionTurnInputKinds } from "../../src/interpreter/agentSession.ts";
import { allSessionAttemptEvidences } from "../../src/interpreter/sessionScheduler.ts";
import { allProjectChangeKinds } from "../../src/interpreter/projectChange.ts";
import { threadSystemPromptCharsMax } from "../../src/interpreter/thread.ts";
import { migratedDatabase } from "./migrationHarness.ts";

test("the objectives column holds the widest objectives a thread composes", async () => {
  await migratedDatabase("session_prompt_bound", async (subject) => {
    const held = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = 'agent_session'::regclass
            AND c.conname = 'agent_session_prompt_is_bounded'`,
      )
    ).rows[0]?.definition;
    assert.ok(
      threadSystemPromptCharsMax <= agentSessionPromptCharsMax,
      "the column holds a thread's own ceiling",
    );
    assert.ok(
      held?.includes(String(agentSessionPromptCharsMax)),
      "the runtime names the ceiling the installed check holds",
    );
  });
});

test("the installed session constraints match the runtime", async () => {
  await migratedDatabase("session_composition", async (subject) => {
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
      await members("session_turn", "session_turn_kind_is_known"),
      [...allSessionTurnInputKinds],
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
    assert.deepEqual(
      await members("agent_session", "agent_session_kind_is_known"),
      [...allSessionKinds],
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

/**
 * The mailbox bound moves as it did at 011: a stage weighs its roster, so the
 * widest observation is wider.
 */
test("the roster arriving widens the mailbox bound", async () => {
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
  });
});
