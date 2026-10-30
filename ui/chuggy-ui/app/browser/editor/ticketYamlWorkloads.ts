/**
 * What the editor says about a catalog workload written out in a ticket: the
 * fields it does not set, shown as commented skeletons beneath it, and what
 * each field means and takes.
 *
 * A FIELD NOT SET IS STILL SHOWN, as a comment, because the editor is where an
 * author learns what a workload may say: uncommenting a skeleton and filling
 * it in is how a field is overridden that the catalog left out.
 */

import {
  allArchitectures,
  allOperatingSystems,
  allPracticeIds,
} from "../../../../../src/contract/configurationDocument.ts";
import {
  codexReasoningEfforts,
  filesystemAccesses,
} from "../../../../../src/contract/workerTask.ts";

import type { TicketYamlKey } from "./ticketYamlKey.ts";

/** Each field a workload may set and the commented skeleton shown where it does not, in the order the schema declares them. */
const ticketYamlWorkloadSkeletons: readonly (readonly [
  field: string,
  runner: "Agent" | "Commands" | "Both",
  skeleton: readonly string[],
])[] = [
  ["purpose", "Agent", ["purpose: Check  # Review where left out"]],
  [
    "worker",
    "Commands",
    [
      "worker:",
      "  setup:",
      "    - <a command run before the workload>",
      "  files:",
      "    - path: <a path in the workspace>",
      "      content: <its text>",
    ],
  ],
  [
    "authority",
    "Both",
    [
      "authority:",
      "  tools:",
      "    - <a tool the agent may call>",
      "  credentials:",
      "    - <a credential it may mint>",
      "  network: false",
      `  filesystem: ${filesystemAccesses.join(" | ")}`,
      "  mayCompleteTask: true",
    ],
  ],
  ["framing", "Agent", ["framing: Chuggy"]],
  [
    "practices",
    "Agent",
    ["practices:", ...allPracticeIds.map((id) => `  - ${id}`)],
  ],
  [
    "brief",
    "Agent",
    [
      "brief:",
      "  motivation:",
      "    - <why the work matters>",
      "  acceptanceCriteria:",
      "    - <what done looks like>",
      "  constraints:",
      "    - <what it must not do>",
    ],
  ],
  ["image", "Both", ["image: <registry/path:tag@sha256:digest>"]],
  [
    "executionRequirement",
    "Both",
    [
      "executionRequirement:",
      "  mode: Capability",
      `  operatingSystem: ${allOperatingSystems.join(" | ")}`,
      `  architecture: ${allArchitectures.join(" | ")}`,
      "  capabilities:",
      "    - Agent:Claude",
    ],
  ],
  ["resources", "Both", ["resources:", "  cpus: 2", "  memoryMib: 4096"]],
];

function ticketYamlWorkloadField(workload: unknown, field: string): unknown {
  return typeof workload === "object" && workload !== null
    ? (workload as Readonly<Record<string, unknown>>)[field]
    : undefined;
}

/**
 * The comment written beneath one workload: a skeleton of each field its
 * runner takes that it does not set, none where it sets them all. An image and
 * an execution requirement are one placement, so the one not set is shown as
 * the other's replacement.
 */
export function ticketYamlWorkloadUnset(workload: unknown): string | undefined {
  const runner = ticketYamlWorkloadField(workload, "runner");
  const placed = ["image", "executionRequirement"].find(
    (field) => ticketYamlWorkloadField(workload, field) !== undefined,
  );
  const lines = ticketYamlWorkloadSkeletons.flatMap(
    ([field, takes, skeleton]) => {
      if (takes !== "Both" && takes !== runner) return [];
      if (ticketYamlWorkloadField(workload, field) !== undefined) return [];
      const replacing =
        placed !== undefined && field !== placed && skeleton[0] !== undefined
          ? [`${skeleton[0]}  # in place of ${placed}`, ...skeleton.slice(1)]
          : skeleton;
      return replacing;
    },
  );
  return lines.length === 0
    ? undefined
    : lines.map((line) => ` ${line}`).join("\n");
}

/** Each field a written workload may hold, what it means, and the values it takes where they are a closed set. */
const ticketYamlWorkloadFields: readonly (readonly [
  key: string,
  hint: string,
  values?: readonly string[] | "PromptPaths",
])[] = [
  [
    "runner",
    "how the workload runs: an agent briefed with its prompt, or commands the worker runs itself",
    ["Agent", "Commands"],
  ],
  [
    "purpose",
    "what the workload is as an evaluator; Review where left out",
    ["Review", "Check"],
  ],
  [
    "prompt",
    "what the agent is briefed with: a `path` to a prompt file the catalog stores, or `text`",
  ],
  [
    "path",
    "a prompt file the catalog stores, read as the text its import stored",
    "PromptPaths",
  ],
  ["text", "the prompt itself, in place of the catalog's"],
  [
    "worker",
    "the agent the workload runs as, and what is installed before it runs",
  ],
  [
    "mode",
    "the agent a worker runs as, or where an execution requirement runs: Container on its image, Capability on any runner declaring its capabilities",
    ["Container", "Capability"],
  ],
  ["type", "how many agents run the workload", ["SingleAgent"]],
  ["agent", "which agent runs the workload", ["Claude", "Codex"]],
  ["model", "the model a Codex agent runs"],
  [
    "effort",
    "the reasoning effort a Codex agent runs at; Codex's default where left out",
    codexReasoningEfforts,
  ],
  ["arguments", "the agent's command-line arguments, one a line"],
  ["setup", "commands run before the workload, one a line"],
  [
    "files",
    "files written into the workspace before the workload, each a path and its content",
  ],
  ["authority", "what the workload narrows of what its worker may reach"],
  ["tools", "the tools the agent may call"],
  ["credentials", "the credentials the workload may mint"],
  ["network", "whether the workload may reach the network", ["true", "false"]],
  [
    "filesystem",
    "what the workload may do to the filesystem",
    filesystemAccesses,
  ],
  [
    "mayCompleteTask",
    "whether the agent may complete its task",
    ["true", "false"],
  ],
  [
    "framing",
    "Chuggy wraps the prompt in chuggy's own role and result wording; left out adds none",
    ["Chuggy"],
  ],
  ["practices", "the practices the workload is held to", allPracticeIds],
  [
    "brief",
    "the claim the workload is briefed with: motivation, acceptance criteria and constraints",
  ],
  ["commands", "the lines a commands workload runs at the repository root"],
  [
    "image",
    "the image the workload runs in, in place of its execution requirement",
  ],
  ["executionRequirement", "where the workload runs, in place of its image"],
  [
    "operatingSystem",
    "the operating system a runner must offer",
    allOperatingSystems,
  ],
  ["architecture", "the architecture a runner must offer", allArchitectures],
  [
    "capabilities",
    "tokens a runner's pool must declare, an agent among them as Agent:<name>",
  ],
  ["resources", "the CPU and memory the workload is given"],
  ["cpus", "whole CPUs"],
  ["memoryMib", "memory, in MiB"],
];

/** What each field of a written workload means and takes; the prompt files the catalog stores are what a prompt path may name. */
export function ticketYamlWorkloadKeys(
  promptPaths: readonly string[],
): readonly TicketYamlKey[] {
  return ticketYamlWorkloadFields.map(([key, hint, values = []]) => ({
    key,
    hint,
    values: (values === "PromptPaths" ? promptPaths : values).map((label) => ({
      label,
    })),
    place: "Workload",
  }));
}
