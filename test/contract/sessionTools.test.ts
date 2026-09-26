/**
 * The chuggy tool roster as the contract states it: every tool gated by exactly
 * one capability, every capability admitting something, the qualified names a
 * control plane must name derivable from a roster, and the bounds a tool call
 * is held to.
 *
 * The roster is compared against a list written out here rather than against
 * itself, because a roster that only agreed with its own derivation would
 * accept a tool silently added to it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpBodyBytesMax } from "../../src/contract/http.ts";
import { sessionCapabilities } from "../../src/contract/rosters.ts";
import {
  allChuggyTools,
  allDependentRelations,
  builtInToolCapabilities,
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPagesMax,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServerName,
  chuggyToolTimeoutMs,
  dependentRelationsAdmitted,
} from "../../src/contract/sessionTools.ts";

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
    "list_threads",
    "read_thread",
    "read_thread_transcript",
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
    "create_draft",
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
});

test("no tool re-authors a released ticket, whatever roster holds it", () => {
  for (const refused of [
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
    [...sessionCapabilities].sort(),
  );
  const gates = new Map<string, number>();
  for (const capability of sessionCapabilities)
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
    "list_threads",
    "read_thread",
    "read_thread_transcript",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftAuthor, [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftOriginate, ["create_draft"]);
  assert.deepEqual(chuggyToolCapabilities.LeadDecision, [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
});

test("each capability admits the runtime's own tools the roster gives it and no other", () => {
  assert.deepEqual(builtInToolCapabilities, {
    RepositoryRead: ["Glob", "Grep", "Read"],
    RepositoryWrite: ["Edit", "NotebookEdit", "Write"],
    RunCommands: ["Bash"],
    ProjectRead: [],
    DraftAuthor: [],
    DraftOriginate: [],
    LeadDecision: [],
  });
});

test("a capability that maps built-ins alone admits no chuggy tool", () => {
  for (const capability of [
    "RepositoryRead",
    "RepositoryWrite",
    "RunCommands",
  ] as const)
    assert.deepEqual(chuggyToolCapabilities[capability], []);
});

/** A member that admitted nothing would be a control nothing could be seen obeying. */
test("every capability admits a tool, the runtime's own or the chuggy server's", () => {
  for (const capability of sessionCapabilities)
    assert.ok(
      builtInToolCapabilities[capability].length +
        chuggyToolCapabilities[capability].length >
        0,
      `${capability} admits nothing`,
    );
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
  const every = chuggyToolNames(sessionCapabilities);
  assert.equal(new Set(every).size, every.length);
  assert.deepEqual(
    every,
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
});
