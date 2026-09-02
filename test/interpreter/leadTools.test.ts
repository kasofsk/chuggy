/**
 * The chuggy tool roster: that every tool is gated by exactly one capability,
 * that the qualified names a control plane must name are derivable from a
 * session's own roster, and that a lead's objectives carry the standing rules
 * its tools mean nothing without.
 *
 * The roster is compared against a list written out here rather than against
 * itself, because a roster that only agreed with its own derivation would
 * accept a tool silently added to it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeHttpBodyBytesMax,
  selectorSettingsTextCharsMax,
} from "../../src/contract/http.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import {
  allChuggyTools,
  allDependentRelations,
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPagesMax,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServerName,
  chuggyToolTimeoutMs,
  dependentRelationsAdmitted,
  dependentRelationsRefused,
  leadSystemPrompt,
  sessionSystemPromptCharsMax,
} from "../../src/interpreter/leadTools.ts";
import type { SelectorResolvedSettings } from "../../src/interpreter/selector.ts";

const settings = (
  basePrompt: string,
  northStar?: string,
): Pick<SelectorResolvedSettings, "basePrompt" | "northStar"> => ({
  basePrompt,
  ...(northStar === undefined ? {} : { northStar }),
});

test("the roster names every tool the plan gives it, in roster order", () => {
  assert.deepEqual(allChuggyTools, [
    "list_tickets",
    "read_ticket",
    "read_draft",
    "list_drafts",
    "list_configurations",
    "read_configuration",
    "read_decision_log",
    "read_refusals",
    "read_ticket_refusals",
    "read_projects",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_operation",
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
});

test("no tool creates a ticket from nothing, and none re-authors a released one", () => {
  for (const refused of [
    "create_draft",
    "revoke",
    "merge_tickets",
    "split_ticket",
    "supersede_ticket",
    "set_dependencies",
  ])
    assert.ok(
      !(allChuggyTools as readonly string[]).includes(refused),
      `the roster holds ${refused}`,
    );
});

test("every capability is mapped and every tool is gated by exactly one", () => {
  assert.deepEqual(
    Object.keys(chuggyToolCapabilities).sort(),
    [...allSessionCapabilities].sort(),
  );
  const gates = new Map<string, number>();
  for (const capability of allSessionCapabilities)
    for (const tool of chuggyToolCapabilities[capability])
      gates.set(tool, (gates.get(tool) ?? 0) + 1);
  for (const tool of allChuggyTools)
    assert.equal(gates.get(tool), 1, `${tool} is gated once`);
  assert.equal(gates.size, allChuggyTools.length);
});

test("each capability admits the tools the roster gives it and no other", () => {
  assert.deepEqual(chuggyToolCapabilities.ProjectRead, [
    "list_tickets",
    "read_ticket",
    "read_draft",
    "list_drafts",
    "list_configurations",
    "read_configuration",
    "read_decision_log",
    "read_refusals",
    "read_ticket_refusals",
    "read_projects",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_operation",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftAuthor, [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ]);
  assert.deepEqual(chuggyToolCapabilities.LeadDecision, [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
});

test("a capability that maps built-ins alone admits no chuggy tool", () => {
  for (const capability of [
    "RepositoryRead",
    "RepositoryWrite",
    "RunCommands",
  ] as const)
    assert.deepEqual(chuggyToolCapabilities[capability], []);
});

test("the qualified names are the roster's own, prefixed, and never repeated", () => {
  assert.deepEqual(chuggyToolNames([]), []);
  assert.deepEqual(
    chuggyToolNames(["LeadDecision"]),
    [
      "dispatch",
      "refuse",
      "lift",
      "set_attention",
      "set_handoff_note",
      "set_planning_intent",
    ].map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  const lead = chuggyToolNames([
    "RepositoryRead",
    "ProjectRead",
    "DraftAuthor",
    "LeadDecision",
  ]);
  assert.equal(new Set(lead).size, lead.length);
  assert.deepEqual(
    lead,
    allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  assert.deepEqual(
    chuggyToolNames(["ProjectRead", "ProjectRead"]),
    chuggyToolNames(["ProjectRead"]),
  );
  assert.deepEqual(chuggyToolNames(["LeadDecision", "ProjectRead"]), [
    ...chuggyToolNames(["ProjectRead"]),
    ...chuggyToolNames(["LeadDecision"]),
  ]);
  assert.equal(chuggyToolPrefix, `mcp__${chuggyToolServerName}__`);
});

test("every bound a tool call is held to is named, an unnamed one being unbounded", () => {
  assert.equal(chuggyToolResponseBytesMax, nativeHttpBodyBytesMax);
  assert.equal(chuggyToolTimeoutMs, 30_000);
  assert.equal(chuggyToolPagesMax, 1);
});

test("a dependent may be a follow-up and may not be a prerequisite", () => {
  assert.deepEqual(allDependentRelations, ["FollowUp", "Prerequisite"]);
  assert.deepEqual(dependentRelationsAdmitted, ["FollowUp"]);
  assert.deepEqual(dependentRelationsRefused, ["Prerequisite"]);
  assert.deepEqual(
    [...dependentRelationsAdmitted, ...dependentRelationsRefused].sort(),
    [...allDependentRelations].sort(),
  );
  for (const relation of allDependentRelations)
    assert.equal(
      (dependentRelationsAdmitted as readonly string[]).includes(relation),
      relation === "FollowUp",
    );
});

test("the objectives carry the project's prompt, its north star and the standing rules", () => {
  const bare = leadSystemPrompt(settings("Select the next ticket."));
  assert.ok(bare.startsWith("Select the next ticket."));
  assert.ok(!bare.includes("# North Star"));
  for (const rule of [
    "file_dependent",
    "release_draft",
    "cannot be re-authored",
    "composes this turn's answer",
  ])
    assert.ok(bare.includes(rule), `the objectives state ${rule}`);
  assert.ok(bare.includes("admits `FollowUp` and refuses `Prerequisite`"));
  assert.ok(
    bare.indexOf("A follow-up points from the new") <
      bare.indexOf("a prerequisite\n  would point from an existing"),
  );
  const guided = leadSystemPrompt(settings("Select.", "Ship the console."));
  assert.ok(guided.includes("# North Star\n\nShip the console."));
  assert.ok(guided.indexOf("Ship the console.") > guided.indexOf("Select."));
});

test("the largest objectives a project may legally set are ones the session row holds", () => {
  const legal = "x".repeat(selectorSettingsTextCharsMax);
  assert.equal(
    leadSystemPrompt(settings(legal, legal)).length,
    sessionSystemPromptCharsMax,
  );
  assert.ok(sessionSystemPromptCharsMax > selectorSettingsTextCharsMax * 2);
});

test("objectives longer than any project could have set are refused where they are composed", () => {
  const standing = leadSystemPrompt(settings("x")).length - 1;
  const room = sessionSystemPromptCharsMax - standing;
  assert.equal(
    leadSystemPrompt(settings("x".repeat(room))).length,
    sessionSystemPromptCharsMax,
  );
  assert.throws(
    () => leadSystemPrompt(settings("x".repeat(room + 1))),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, /^lead system prompt /u);
      return true;
    },
  );
});
