/** A project's selector settings as the settings route answers them. */

import { projectPartition } from "./projectFixture.ts";

const selectorSettingsLimits = {
  tokensPerDecision: 200_000,
  millisecondsPerDecision: 900_000,
  toolCallsPerDecision: 40,
  dispatchesPerDecision: 3,
  inputBytesPerDecision: 1_048_576,
  candidatePagesPerDecision: 4,
  autoCompactWindow: 200_000,
  concurrentDecisions: 2,
  selectionsPerMinute: 6,
};

/** What the strip reads: the project's selector settings, with `mode` and
 * `dispatchMode` the two fields a case moves. */
export function selectorSettingsBody(
  revision = 12,
  overrides: Readonly<Record<string, unknown>> = {},
  resolved: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    partition: projectPartition,
    revision,
    overrides,
    effective: {
      revision,
      projectRevision: revision,
      mode: "Running",
      installationMode: "Running",
      dispatchMode: "Automatic",
      basePrompt: "base-prompt-1",
      northStar: "north-star-1",
      threadStandingRules: "- standing-rule-1",
      modelAllowlist: [],
      toolAllowlist: [],
      limits: selectorSettingsLimits,
      installationLimits: selectorSettingsLimits,
      operationalContextMaxAgeMs: 60_000,
      leadOffering: "Own",
      ...resolved,
    },
  };
}
