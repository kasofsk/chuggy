/**
 * What a lead is given: the tools its roster admits, and objectives that carry
 * the standing rules its tools mean nothing without. The roster itself is the
 * contract's, and `test/contract/sessionTools.test.ts` holds it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { selectorSettingsTextCharsMax } from "../../src/contract/http.ts";
import {
  allChuggyTools,
  allDependentRelations,
  chuggyToolCapabilities,
  chuggyToolNames,
  chuggyToolPrefix,
  dependentRelationsAdmitted,
} from "../../src/contract/sessionTools.ts";
import {
  dependentRelationsRefused,
  leadObjectivesFixedChars,
  leadSessionCapabilities,
  leadSystemPrompt,
  leadToolAllowlist,
  sessionSystemPromptCharsMax,
} from "../../src/interpreter/leadTools.ts";
import type { SelectorResolvedSettings } from "../../src/interpreter/selector.ts";
import { threadCapabilitiesDefault } from "../../src/interpreter/thread.ts";

const settings = (
  basePrompt: string,
  northStar?: string,
): Pick<SelectorResolvedSettings, "basePrompt" | "northStar"> => ({
  basePrompt,
  ...(northStar === undefined ? {} : { northStar }),
});

/**
 * The lead's derived-work rule as a fact about the capability map rather than
 * about the roster: the one tool that files from nothing exists, and the lead's
 * own roster is what does not admit it. Asserting membership of the thread's
 * roster rather than absence from the whole is the point — a `create_draft`
 * silently dropped from every capability would pass an absence check — and
 * revoking and updating are held the same way, by the same capability, and
 * dispatching by `TicketDispatch`, which a lead is not opened with either.
 */
test("origination, revoking, updating and dispatching are admitted for a thread's roster and refused for a lead's", () => {
  const memberOnly = [
    "create_draft",
    "revoke_ticket",
    "update_ticket",
    "dispatch_ticket",
  ] as const;

  assert.deepEqual(
    [
      ...chuggyToolCapabilities.DraftOriginate,
      ...chuggyToolCapabilities.TicketDispatch,
    ],
    memberOnly,
  );
  for (const tool of memberOnly) {
    const named = `${chuggyToolPrefix}${tool}`;
    assert.ok(
      chuggyToolNames(threadCapabilitiesDefault).includes(named),
      `a thread's own roster does not admit ${tool}`,
    );
    assert.ok(!chuggyToolNames(leadSessionCapabilities).includes(named), tool);
  }
  const projectTools = new Set<string>(
    Object.entries(chuggyToolCapabilities)
      .filter(([capability]) => capability !== "MemberRead")
      .flatMap(([, tools]) => tools),
  );
  assert.deepEqual(
    chuggyToolNames(leadSessionCapabilities),
    allChuggyTools
      .filter(
        (tool) =>
          projectTools.has(tool) &&
          !(memberOnly as readonly string[]).includes(tool),
      )
      .map((tool) => `${chuggyToolPrefix}${tool}`),
  );
});

test("a lead and a thread both list the project's repositories, read its images, a run's error text, a ticket's landings, the docs and their own abilities, and a lead's decision may report any of them", () => {
  for (const tool of [
    "list_repositories",
    "fetch_image",
    "read_run_error",
    "read_ticket_landings",
    "read_docs",
    "read_abilities",
  ]) {
    const named = `${chuggyToolPrefix}${tool}`;
    assert.ok(chuggyToolNames(leadSessionCapabilities).includes(named), tool);
    assert.ok(chuggyToolNames(threadCapabilitiesDefault).includes(named), tool);
    assert.ok(leadToolAllowlist.includes(named), tool);
  }
});

test("the relations a lead is refused are the ones the contract does not admit", () => {
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
