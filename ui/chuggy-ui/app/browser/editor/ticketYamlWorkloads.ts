/**
 * What the editor says about a catalog workload written out in a ticket: the
 * fields it does not set, shown as commented skeletons beneath it, and what
 * each field means and takes.
 *
 * A FIELD NOT SET IS STILL SHOWN, as a comment, because the editor is where an
 * author learns what a workload may say: uncommenting a skeleton and filling
 * it in is how a field is overridden that the catalog left out.
 *
 * AN APPROVAL STAYS AN APPROVAL. A release refuses an override changing a
 * runner to or from Approval, so nothing here offers either.
 */

import {
  allArchitectures,
  allOperatingSystems,
  allPracticeIds,
  workloadReevaluations,
} from "../../../../../src/contract/configurationDocument.ts";
import {
  approvalRoles,
  type WorkloadRunner,
} from "../../../../../src/contract/rosters.ts";
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
  reevaluate: {
    id: "ticket-authoring-skeleton-default",
    args: { default: "Always" },
  },
  setup: { id: "ticket-authoring-placeholder-setup" },
  path: { id: "ticket-authoring-placeholder-path" },
  content: { id: "ticket-authoring-placeholder-content" },
  tool: { id: "ticket-authoring-placeholder-tool" },
  credential: { id: "ticket-authoring-placeholder-credential" },
  motivation: { id: "ticket-authoring-placeholder-motivation" },
  done: { id: "ticket-authoring-placeholder-done" },
  constraint: { id: "ticket-authoring-placeholder-constraint" },
  approvers: {
    id: "ticket-authoring-skeleton-approvers",
    args: { developer: "Developer", admin: "Admin" },
  },
  principal: { id: "ticket-authoring-placeholder-principal" },
  instructions: { id: "ticket-authoring-placeholder-instructions" },
} as const satisfies Readonly<Record<string, Copy>>;

const agent: readonly WorkloadRunner[] = ["Agent"];
const commands: readonly WorkloadRunner[] = ["Commands"];
const worker: readonly WorkloadRunner[] = ["Agent", "Commands"];
const approval: readonly WorkloadRunner[] = ["Approval"];

/** Each field a workload may set, the runners that take it, and the commented skeleton shown where it does not, in the order the schema declares them. A skeleton's lines are code; `{slot}` is where its copy goes. */
const ticketYamlWorkloadSkeletons: readonly (readonly [
  field: string,
  runners: readonly WorkloadRunner[],
  skeleton: readonly string[],
])[] = [
  ["purpose", agent, ["purpose: Check  # {purpose}"]],
  [
    "worker",
    commands,
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
    worker,
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
  ["framing", agent, ["framing: Chuggy"]],
  [
    "practices",
    agent,
    ["practices:", ...allPracticeIds.map((id) => `  - ${id}`)],
  ],
  [
    "brief",
    agent,
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
  ["reevaluate", worker, ["reevaluate: OnChange  # {reevaluate}"]],
  ["image", worker, ["image: <registry/path:tag@sha256:digest>"]],
  [
    "executionRequirement",
    worker,
    [
      "executionRequirement:",
      "  mode: Capability",
      `  operatingSystem: ${allOperatingSystems.join(" | ")}`,
      `  architecture: ${allArchitectures.join(" | ")}`,
      "  capabilities:",
      "    - Agent:Claude",
    ],
  ],
  ["resources", worker, ["resources:", "  cpus: 2", "  memoryMib: 4096"]],
  ["approvers", approval, ["approvers:  # {approvers}", "  - <{principal}>"]],
  ["instructions", approval, ["instructions: <{instructions}>"]],
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
 * a run requirement are one placement, so the one not set is shown as
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
      if (!takes.some((taking) => taking === runner)) return [];
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
  ["runner", { id: "ticket-authoring-workload-runner" }, worker],
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
  ["model", { id: "ticket-authoring-workload-model" }],
  ["effort", { id: "ticket-authoring-workload-effort" }, codexReasoningEfforts],
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
  [
    "reevaluate",
    { id: "ticket-authoring-workload-reevaluate", args: { default: "Always" } },
    workloadReevaluations,
  ],
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
  [
    "approvers",
    {
      id: "ticket-authoring-workload-approvers",
      args: { developer: "Developer", admin: "Admin" },
    },
    approvalRoles,
  ],
  ["instructions", { id: "ticket-authoring-workload-instructions" }],
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
