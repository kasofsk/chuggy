/**
 * The catalog and the release the approval suites evaluate under: a work
 * workload, a command evaluator and an approval, planned as an approval alone,
 * a command beside it, or a command alone.
 */

import type { Config } from "../../src/domain/config.ts";
import {
  canonicalConfigurationOf,
  type ReleaseAuthoring,
} from "../../src/interpreter/authoring.ts";
import { refinementInstance } from "../actor/harness.ts";

/** A catalog evaluating by `plan`, its approval asking `approvers` with `instructions`. */
export function approvalCatalogOf(
  plan: "signOff" | "mixed" | "ungated",
  approvers: "Developer" | "Admin",
  instructions: string,
) {
  return canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: {
        runner: "Agent",
        prompt: { text: "Build it." },
        worker: {
          mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
          setup: [],
          files: [],
        },
      },
      tests: { runner: "Commands", commands: ["npm test"] },
      approval: { runner: "Approval", instructions, approvers },
    },
    plans: {
      signOff: [{ name: "sign-off", evaluators: ["approval"] }],
      mixed: [{ name: "checks", evaluators: ["tests", "approval"] }],
      ungated: [{ name: "checks", evaluators: ["tests"] }],
    },
    defaults: { work: "build", evaluation: plan },
  });
}

/** A stage of two evaluators, and the bounds a writer must hold to take a release of one. */
export const approvalMixedRelease = {
  authoring: {
    deps: new Set<number>(),
    prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }] }],
  },
  config: { ...refinementInstance, nTasks: 2 },
} satisfies { authoring: ReleaseAuthoring; config: Config };
