/**
 * The chuggy tool roster the worker image writes a second time, held against the
 * interpreter's own.
 *
 * `images/worker/` is plain JavaScript that reaches nothing under `src/`, so the
 * roster, its capability mapping and every bound one tool answers under are
 * written twice; this suite is what makes the second copy a checked claim rather
 * than a comment. Drift is not a lint: a name the image registers and the
 * control plane's allowlist does not carry is a decision `enforcePolicyControls`
 * refuses after its command has already landed.
 *
 * IT READS THE MODULES, NOT THEIR TEXT. Both sides are imported and their values
 * compared, because a guard that matches source text has passed while the
 * property failed more than once in this tree.
 *
 * IT IS A `.mjs` SUITE FOR A REASON. A TypeScript suite importing the image
 * would pull the whole image tree under `checkJs`, which is a compiler verdict
 * on plain JavaScript nobody wrote for one. Node strips the types off the
 * contract at run time instead.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
  nativeHttpBodyBytesMax,
  nativeHttpPageItemsMax,
  selectorHandoffNoteBytesMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
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
} from "../../src/interpreter/leadTools.ts";
import {
  leadDispatchesMax,
  leadRefusalsPerDecisionMax,
} from "../../src/interpreter/selector.ts";
import * as image from "../../images/worker/chuggyTools.mjs";
import * as decision from "../../images/worker/leadDecision.mjs";

test("the image offers exactly the tools the roster declares, in the same order", () => {
  assert.deepEqual(image.allChuggyTools, [...allChuggyTools]);
  assert.equal(image.chuggyToolServerName, chuggyToolServerName);
  assert.equal(image.chuggyToolPrefix, chuggyToolPrefix);
});

test("the image admits each tool under the capability the roster maps it to", () => {
  for (const capability of allSessionCapabilities)
    assert.deepEqual(
      image.sessionCapabilityTools[capability].filter((tool) =>
        allChuggyTools.includes(tool),
      ),
      [...chuggyToolCapabilities[capability]],
      capability,
    );
});

test("the qualified names both sides produce are the same for every roster", () => {
  const every = allSessionCapabilities;
  for (let subset = 0; subset < 2 ** every.length; subset += 1) {
    const held = every.filter((_, index) => ((subset >> index) & 1) === 1);

    assert.deepEqual(
      image.chuggyToolNames(held),
      [...chuggyToolNames(held)],
      held.join(","),
    );
  }
});

test("every bound the image copies is the contract's own value", () => {
  assert.deepEqual(
    {
      chuggyToolResponseBytesMax: image.chuggyToolResponseBytesMax,
      chuggyToolTimeoutMs: image.chuggyToolTimeoutMs,
      chuggyToolPagesMax: image.chuggyToolPagesMax,
      nativeHttpPageItemsMax: image.nativeHttpPageItemsMax,
      selectorHistoryLimitMax: image.selectorHistoryLimitMax,
      agenticRefusalsAnsweredMax: image.agenticRefusalsAnsweredMax,
      sessionStorePageBatchesMax: image.sessionStorePageBatchesMax,
      leadDispatchesMax: decision.leadDispatchesMax,
      leadRefusalsPerDecisionMax: decision.leadRefusalsPerDecisionMax,
      agenticRefusalReasonCharsMax: decision.agenticRefusalReasonCharsMax,
      selectorHandoffNoteBytesMax: decision.selectorHandoffNoteBytesMax,
      leadDecisionBytesMax: decision.leadDecisionBytesMax,
    },
    {
      chuggyToolResponseBytesMax,
      chuggyToolTimeoutMs,
      chuggyToolPagesMax,
      nativeHttpPageItemsMax,
      selectorHistoryLimitMax,
      agenticRefusalsAnsweredMax,
      sessionStorePageBatchesMax,
      leadDispatchesMax,
      leadRefusalsPerDecisionMax,
      agenticRefusalReasonCharsMax,
      selectorHandoffNoteBytesMax,
      leadDecisionBytesMax: sessionTurnResultCharsMax,
    },
  );
  assert.equal(chuggyToolResponseBytesMax, nativeHttpBodyBytesMax);
});

test("the relations the image offers and refuses are the roster's own", () => {
  assert.deepEqual(image.allDependentRelations, [...allDependentRelations]);
  assert.deepEqual(image.dependentRelationsAdmitted, [
    ...dependentRelationsAdmitted,
  ]);
});

test("a lead's whole roster fits one measured turn's tool list", () => {
  const lead = ["RepositoryRead", "ProjectRead", "DraftAuthor", "LeadDecision"];
  const names = [...image.sessionBuiltInTools, ...image.chuggyToolNames(lead)];

  assert.ok(
    names.length <= sessionTurnToolsMax,
    `a lead may report ${String(names.length)} tools and a turn records ${String(sessionTurnToolsMax)}`,
  );
  for (const name of names)
    assert.ok(
      name.length <= sessionTurnToolNameCharsMax,
      `${name} is longer than a recorded tool name holds`,
    );
});
