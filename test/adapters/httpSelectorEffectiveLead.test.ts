/** The lead a project's effective selector settings answer on the wire: its model and effort, and whose they are. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { selectorProjectSettingsResponse } from "../../src/adapters/http/outcomes.ts";
import { selectorProjectSettingsResponseSchema } from "../../src/contract/responses.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  resolvedSelectorSettings,
  type SelectorProjectOverrides,
  type SelectorRuntimeSettings,
} from "../../src/interpreter/selector.ts";
import type { SubsidizedLeadProfile } from "../../src/interpreter/sessionPlacement.ts";

const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

const defaults: SelectorRuntimeSettings = {
  revision: 3,
  mode: "Running",
  dispatchMode: "ApprovalRequired",
  basePrompt: "Select at most one currently dispatchable ticket.",
  modelAllowlist: ["*"],
  toolAllowlist: ["*"],
  limits: {
    tokensPerDecision: 8192,
    millisecondsPerDecision: 120_000,
    toolCallsPerDecision: 20,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    autoCompactWindow: 200_000,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
};

const profile: SubsidizedLeadProfile = {
  credentialSlot: "anthropic-api",
  model: "claude-haiku-5-5",
  effort: "medium",
  autoCompactWindow: 100_000,
  inputBytesPerDecision: 262_144,
  turnTokensMax: 120_000,
};

const overrides: SelectorProjectOverrides = {
  leadModel: "claude-opus-5-5",
  leadEffort: "max",
};

/** The effective half of the settings body, parsed as the contract has it. */
function effectiveAnswered(subsidized?: SubsidizedLeadProfile) {
  const answered = selectorProjectSettingsResponse({
    result: "Found",
    settings: {
      partition,
      revision: 1,
      overrides,
      effective: resolvedSelectorSettings(
        partition,
        defaults,
        1,
        overrides,
        subsidized,
      ),
    },
  });
  assert.equal(answered.status, 200);
  return selectorProjectSettingsResponseSchema.parse(answered.body).effective;
}

test("a subsidized project's effective settings answer the profile's model and effort, marked as the profile's", () => {
  const effective = effectiveAnswered(profile);
  assert.deepEqual(
    [effective.leadModel, effective.leadEffort, effective.leadOffering],
    ["claude-haiku-5-5", "medium", "Subsidized"],
  );
});

test("an own project's effective settings answer its own lead model and effort, and one that chose none answers neither", () => {
  const effective = effectiveAnswered();
  assert.deepEqual(
    [effective.leadModel, effective.leadEffort, effective.leadOffering],
    ["claude-opus-5-5", "max", "Own"],
  );
  const unset = selectorProjectSettingsResponseSchema.parse(
    selectorProjectSettingsResponse({
      result: "Found",
      settings: {
        partition,
        revision: 0,
        overrides: {},
        effective: resolvedSelectorSettings(partition, defaults, 0, {}),
      },
    }).body,
  ).effective;
  assert.deepEqual(
    ["leadModel" in unset, "leadEffort" in unset, unset.leadOffering],
    [false, false, "Own"],
  );
});
