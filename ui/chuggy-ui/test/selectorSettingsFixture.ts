/** A project's thread settings as the settings route answers them. */

import { projectPartition } from "./projectFixture.ts";

/** What the settings route answers: the project's overrides, and what its
 * threads run under, which a case moves through `resolved`. */
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
      northStar: "north-star-1",
      threadStandingRules: "- standing-rule-1",
      ...resolved,
    },
  };
}
