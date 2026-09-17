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
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPagesMax,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServerName,
  chuggyToolTimeoutMs,
  leadObjectivesFixedChars,
  leadSystemPrompt,
  sessionSystemPromptCharsMax,
} from "../../src/interpreter/leadTools.ts";
import type { LeadToolSettings as SelectorResolvedSettings } from "../../src/interpreter/leadTools.ts";
import { threadCapabilitiesDefault } from "../../src/interpreter/thread.ts";
import { leadRoster } from "../contract/sessionRosterFixture.ts";

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
    "update_ticket",
    "dispatch_ticket",
    "revoke_ticket",
    "resume_ticket",
    "create_ticket",
  ]);
});

test("no tool reshapes ticket identity or dependencies", () => {
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

/**
 * The lead's derived-work rule as a fact about the capability map rather than
 * about the roster: the one tool that files from nothing exists, and the lead's
 * own roster is what does not admit it. Asserting membership of the thread's
 * roster rather than absence from the whole is the point — a `create_ticket`
 * silently dropped from every capability would pass an absence check.
 */
test("origination is admitted for a thread's roster and refused for a lead's", () => {
  const originating = `${chuggyToolPrefix}create_ticket`;

  assert.deepEqual(chuggyToolCapabilities.DraftOriginate, ["create_ticket"]);
  assert.ok(
    chuggyToolNames(threadCapabilitiesDefault).includes(originating),
    "a thread's own roster does not admit the tool it exists for",
  );
  assert.ok(!chuggyToolNames(leadRoster).includes(originating));
  assert.deepEqual(
    chuggyToolNames(leadRoster),
    allChuggyTools
      .filter((tool) => tool !== "create_ticket")
      .map((tool) => `${chuggyToolPrefix}${tool}`),
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
    "update_ticket",
    "dispatch_ticket",
    "revoke_ticket",
    "resume_ticket",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftOriginate, ["create_ticket"]);
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
  const every = chuggyToolNames(allSessionCapabilities);
  assert.equal(new Set(every).size, every.length);
  assert.deepEqual(
    every,
    allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  assert.deepEqual(
    chuggyToolNames(["ProjectRead", "ProjectRead"]),
    chuggyToolNames(["ProjectRead"]),
  );
  assert.equal(chuggyToolPrefix, `mcp__${chuggyToolServerName}__`);
});

test("every bound a tool call is held to is named, an unnamed one being unbounded", () => {
  assert.equal(chuggyToolResponseBytesMax, nativeHttpBodyBytesMax);
  assert.equal(chuggyToolTimeoutMs, 30_000);
  assert.equal(chuggyToolPagesMax, 1);
});

test("the objectives carry the project's prompt, its north star and the standing rules", () => {
  const bare = leadSystemPrompt(settings("Select the next ticket."));
  assert.ok(bare.startsWith("Select the next ticket."));
  assert.ok(!bare.includes("# North Star"));
  for (const rule of [
    "update_ticket",
    "read_operation",
    "cannot originate",
    "composes this turn's answer",
  ])
    assert.ok(bare.includes(rule), `the objectives state ${rule}`);
  const guided = leadSystemPrompt(settings("Select.", "Ship the console."));
  assert.ok(guided.includes("# North Star\n\nShip the console."));
  assert.ok(guided.indexOf("Ship the console.") > guided.indexOf("Select."));
});

test("the largest objectives a project may legally set are ones the session row holds", () => {
  const legal = "x".repeat(selectorSettingsTextCharsMax);
  const composed = leadSystemPrompt(settings(legal, legal)).length;
  assert.ok(
    composed > selectorSettingsTextCharsMax * 2,
    "both texts and what this module adds are in one prompt",
  );
  assert.ok(
    composed <= sessionSystemPromptCharsMax,
    "the widest prompt a project may set is one the observation bound allows",
  );
  assert.equal(
    composed - selectorSettingsTextCharsMax * 2,
    leadObjectivesFixedChars,
    "what the prompt adds beyond the two texts is what this module contributes",
  );
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
