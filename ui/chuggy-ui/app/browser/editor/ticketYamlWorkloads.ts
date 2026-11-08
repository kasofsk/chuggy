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

import type { Copy, CopyText } from "../../core/copy.ts";
import type { TicketYamlKey } from "./ticketYamlKey.ts";

/** What fills each slot a skeleton's lines leave, which is the skeleton's only copy. */
const ticketYamlWorkloadSlots = {
  purpose: {
    id: "ticket-authoring-skeleton-default",
    args: { default: "Review" },
  },
  setup: { id: "ticket-authoring-placeholder-setup" },
  path: { id: "ticket-authoring-placeholder-path" },
  content: { id: "ticket-authoring-placeholder-content" },
  tool: { id: "ticket-authoring-placeholder-tool" },
  credential: { id: "ticket-authoring-placeholder-credential" },
  motivation: { id: "ticket-authoring-placeholder-motivation" },
  done: { id: "ticket-authoring-placeholder-done" },
  constraint: { id: "ticket-authoring-placeholder-constraint" },
} as const satisfies Readonly<Record<string, Copy>>;

/** Each field a workload may set and the commented skeleton shown where it does not, in the order the schema declares them. A skeleton's lines are code; `{slot}` is where its copy goes. */
const ticketYamlWorkloadSkeletons: readonly (readonly [
  field: string,
  runner: "Agent" | "Commands" | "Both",
  skeleton: readonly string[],
])[] = [
  ["purpose", "Agent", ["purpose: Check  # {purpose}"]],
  [
    "worker",
    "Commands",
    [
      "worker:",
      "  setup:",
      "    - <{setup}>",
      "  files:",
      "    - path: <{path}>",
      "      content: <{content}>",
    ],
  ],
  [
    "authority",
    "Both",
    [
      "authority:",
      "  tools:",
      "    - <{tool}>",
      "  credentials:",
      "    - <{credential}>",
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
      "    - <{motivation}>",
      "  acceptanceCriteria:",
      "    - <{done}>",
      "  constraints:",
      "    - <{constraint}>",
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

/** A skeleton's line with each slot filled in the reader's words. */
function ticketYamlWorkloadFilled(line: string, text: CopyText): string {
  return line.replace(/\{(\w+)\}/gu, (slot, name: string) =>
    name in ticketYamlWorkloadSlots
      ? text(
          ticketYamlWorkloadSlots[name as keyof typeof ticketYamlWorkloadSlots],
        )
      : slot,
  );
}

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
export function ticketYamlWorkloadUnset(
  workload: unknown,
  text: CopyText,
): string | undefined {
  const runner = ticketYamlWorkloadField(workload, "runner");
  const placed = ["image", "executionRequirement"].find(
    (field) => ticketYamlWorkloadField(workload, field) !== undefined,
  );
  const lines = ticketYamlWorkloadSkeletons.flatMap(
    ([field, takes, written]) => {
      if (takes !== "Both" && takes !== runner) return [];
      if (ticketYamlWorkloadField(workload, field) !== undefined) return [];
      const skeleton = written.map((line) =>
        ticketYamlWorkloadFilled(line, text),
      );
      const replacing =
        placed !== undefined && field !== placed && skeleton[0] !== undefined
          ? [
              `${skeleton[0]}  # ${text({
                id: "ticket-authoring-skeleton-in-place",
                args: { field: placed },
              })}`,
              ...skeleton.slice(1),
            ]
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
  hint: Copy,
  values?: readonly string[] | "PromptPaths",
])[] = [
  ["runner", { id: "ticket-authoring-workload-runner" }, ["Agent", "Commands"]],
  [
    "purpose",
    { id: "ticket-authoring-workload-purpose", args: { default: "Review" } },
    ["Review", "Check"],
  ],
  [
    "prompt",
    {
      id: "ticket-authoring-workload-prompt",
      args: { path: "path", text: "text" },
    },
  ],
  ["path", { id: "ticket-authoring-workload-path" }, "PromptPaths"],
  ["text", { id: "ticket-authoring-workload-text" }],
  ["worker", { id: "ticket-authoring-workload-worker" }],
  [
    "mode",
    {
      id: "ticket-authoring-workload-mode",
      args: { container: "Container", capability: "Capability" },
    },
    ["Container", "Capability"],
  ],
  ["type", { id: "ticket-authoring-workload-type" }, ["SingleAgent"]],
  ["agent", { id: "ticket-authoring-workload-agent" }, ["Claude", "Codex"]],
  [
    "model",
    { id: "ticket-authoring-workload-model", args: { codex: "Codex" } },
  ],
  [
    "effort",
    { id: "ticket-authoring-workload-effort", args: { codex: "Codex" } },
    codexReasoningEfforts,
  ],
  ["arguments", { id: "ticket-authoring-workload-arguments" }],
  ["setup", { id: "ticket-authoring-workload-setup" }],
  ["files", { id: "ticket-authoring-workload-files" }],
  ["authority", { id: "ticket-authoring-workload-authority" }],
  ["tools", { id: "ticket-authoring-workload-tools" }],
  ["credentials", { id: "ticket-authoring-workload-credentials" }],
  ["network", { id: "ticket-authoring-workload-network" }, ["true", "false"]],
  [
    "filesystem",
    { id: "ticket-authoring-workload-filesystem" },
    filesystemAccesses,
  ],
  [
    "mayCompleteTask",
    { id: "ticket-authoring-workload-may-complete" },
    ["true", "false"],
  ],
  [
    "framing",
    { id: "ticket-authoring-workload-framing", args: { framing: "Chuggy" } },
    ["Chuggy"],
  ],
  ["practices", { id: "ticket-authoring-workload-practices" }, allPracticeIds],
  ["brief", { id: "ticket-authoring-workload-brief" }],
  ["commands", { id: "ticket-authoring-workload-commands" }],
  ["image", { id: "ticket-authoring-workload-image" }],
  ["executionRequirement", { id: "ticket-authoring-workload-execution" }],
  [
    "operatingSystem",
    { id: "ticket-authoring-workload-operating-system" },
    allOperatingSystems,
  ],
  [
    "architecture",
    { id: "ticket-authoring-workload-architecture" },
    allArchitectures,
  ],
  [
    "capabilities",
    {
      id: "ticket-authoring-workload-capabilities",
      args: { token: "Agent:<name>" },
    },
  ],
  ["resources", { id: "ticket-authoring-workload-resources" }],
  ["cpus", { id: "ticket-authoring-workload-cpus" }],
  ["memoryMib", { id: "ticket-authoring-workload-memory" }],
];

/** What each field of a written workload means and takes; the prompt files the catalog stores are what a prompt path may name. */
export function ticketYamlWorkloadKeys(
  promptPaths: readonly string[],
  text: CopyText,
): readonly TicketYamlKey[] {
  return ticketYamlWorkloadFields.map(([key, hint, values = []]) => ({
    key,
    hint: text(hint),
    values: (values === "PromptPaths" ? promptPaths : values).map((label) => ({
      label,
    })),
    place: "Workload",
  }));
}
