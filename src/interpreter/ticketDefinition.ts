/**
 * What a release resolves once and the ticket then runs at.
 *
 * EVERY REFERENCE IS A FOLD OF A DIGEST, AND NONE IS AUTHORED. The model's
 * released ticket carries opaque positive integers; each of them here is
 * `digestFold` over the digest of one resolved piece of material, so a number
 * read off the journal names something rather than standing for nothing, and
 * two releases of the same ticket under different revisions carry different
 * numbers.
 *
 * THE MATERIAL IS RESOLVED AT RELEASE AND NOT PER REQUEST. A cycle used to
 * materialize its execution requirement from the configuration its request
 * pinned, which folds in the platform defaults this image carries; it is
 * resolved here instead, stored whole, and copied at dispatch, so every cycle
 * of a ticket runs what that ticket's release resolved.
 *
 * WHAT IS STORED AND WHAT IS NOT. The requirement is stored whole because
 * nothing recovers it: it is a function of the configuration AND of platform
 * defaults that move between images. The briefing blocks are not, because they
 * are the pinned revision's own text and the ticket names that revision — a
 * second copy would be a stored duplicate of a derivable fact. What is kept for
 * them is the digest, which is what the journalled reference folds and which
 * folding does not give back. The brief is stored, beside the material, for the
 * requirement's reason: the draft it was resolved from is revised in place
 * while its ticket is Pending, so nothing else recovers the one a release took.
 */

import { createHash } from "node:crypto";

import type {
  ReleasedTicket,
  TaskDefinition,
} from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type { ReleaseAuthoring, ReleaseConfiguration } from "./authoring.ts";
import {
  asExecutionRequirement,
  asRequirementSource,
  materializeExecutionRequirement,
  type ExecutionTaskKindKey,
  type MaterializedExecutionRequirement,
} from "./executionRequirement.ts";
import { digestFold, resultManifestSchemaVersion } from "./resultManifest.ts";
import { asDraftBrief, type DraftBrief } from "./ticketBrief.ts";
import type { StageBlock } from "./taskConfiguration.ts";

/** What one resolved task definition names, in the order the model's record spells it. */
export interface TicketTaskMaterial {
  readonly key: ExecutionTaskKindKey;
  /** The image the task runs in, which is what `workload` folds. */
  readonly workload: { readonly image: string; readonly digest: string };
  /** The configuration block the briefing composes from, by the digest `inputs` folds. */
  readonly inputs: { readonly digest: string };
  readonly executionRequirements: MaterializedExecutionRequirement & {
    readonly digest: string;
  };
  /** The manifest schema the worker attests its result against. */
  readonly resultContract: {
    readonly schemaVersion: number;
    readonly digest: string;
  };
}

/** Everything one release resolved, which is what `ticket_definition` holds. */
export interface TicketDefinitionMaterial {
  /** The brief the ticket was released from, by the digest `content` folds. */
  readonly content: { readonly digest: string };
  /**
   * The landing this ticket concludes under. The draft door resolves the
   * repository's landing when a draft is authored and stores what it resolved,
   * so the brief's own pair IS the binding as it stood, frozen here.
   */
  readonly finalization: {
    readonly mode?: string;
    readonly target?: string;
    readonly digest: string;
  };
  readonly tasks: readonly TicketTaskMaterial[];
}

/** The bytes a digest is taken over: one value, its keys ascending at every depth. */
function canonicalBytes(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalBytes(record[key])}`);
  return `{${fields.join(",")}}`;
}

/** The content address of one resolved piece of material. */
export function materialDigest(value: unknown): string {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

/** How an evaluation stage's key is spelled, which is what the requirement is qualified by. */
const evaluationKeyPrefix = "Evaluation:";

/** The key an evaluation stage's definition is resolved and stored under. */
function evaluationTaskKey(stage: number): ExecutionTaskKindKey {
  return `${evaluationKeyPrefix}${stage}`;
}

/** The stage a task key names, absent for the work task, which names none. */
function taskKeyStage(key: ExecutionTaskKindKey): number | undefined {
  return key === "Work"
    ? undefined
    : Number(key.slice(evaluationKeyPrefix.length));
}

/**
 * The block one task's briefing composes from: the work stage's, or the
 * evaluation stage's where the configuration indexes them and the shared review
 * block where it does not. It is the same pick `taskBriefing` makes, read at
 * the stage key the plan carries rather than at the zero-based index a request
 * row holds.
 */
function taskInputsBlock(
  configuration: ReleaseConfiguration,
  key: ExecutionTaskKindKey,
): StageBlock | undefined {
  const stage = taskKeyStage(key);
  if (stage === undefined) return configuration.work;
  if (configuration.evaluations === undefined) return configuration.review;
  return configuration.evaluations[stage - 1];
}

function ticketTaskMaterial(
  configuration: ReleaseConfiguration,
  key: ExecutionTaskKindKey,
): TicketTaskMaterial {
  const stage = taskKeyStage(key);
  const requirement = materializeExecutionRequirement(
    configuration,
    stage === undefined ? "Work" : "Evaluation",
    stage,
  );
  return {
    key,
    workload: {
      image: configuration.image,
      digest: materialDigest(configuration.image),
    },
    inputs: { digest: materialDigest(taskInputsBlock(configuration, key)) },
    executionRequirements: {
      ...requirement,
      digest: materialDigest(requirement.value),
    },
    resultContract: {
      schemaVersion: resultManifestSchemaVersion,
      digest: materialDigest({ schemaVersion: resultManifestSchemaVersion }),
    },
  };
}

/**
 * Resolves everything one release freezes: the brief it was taken from, the
 * landing it concludes under, one task definition for work and one per stage
 * the author's plan names. Pure — the caller reads the revision and the brief,
 * and this resolves them.
 */
export function ticketDefinitionMaterial(input: {
  readonly authoring: ReleaseAuthoring;
  readonly configuration: ReleaseConfiguration;
  readonly brief?: DraftBrief;
}): TicketDefinitionMaterial {
  const finalization = input.brief?.finalization;
  const keys: readonly ExecutionTaskKindKey[] = [
    "Work",
    ...input.authoring.prog.map((stage) => evaluationTaskKey(stage.key)),
  ];
  return {
    content: { digest: materialDigest(input.brief ?? {}) },
    finalization: {
      ...(finalization === undefined ? {} : finalization),
      digest: materialDigest(finalization ?? {}),
    },
    tasks: keys.map((key) => ticketTaskMaterial(input.configuration, key)),
  };
}

/** The material one task key names, which a release resolved for every key its plan reaches. */
export function ticketTaskMaterialAt(
  material: TicketDefinitionMaterial,
  key: ExecutionTaskKindKey,
): TicketTaskMaterial {
  const found = material.tasks.find((task) => task.key === key);
  if (found === undefined)
    throw new Error(`ticket definition: nothing was resolved for ${key}`);
  return found;
}

/** The key one task's material is resolved and stored under, for the readers of a stored row. */
export function ticketTaskKey(
  kind: "Work" | "Evaluation",
  stage: number | undefined,
): ExecutionTaskKindKey {
  if (kind === "Work") return "Work";
  if (stage === undefined)
    throw new TypeError("ticket definition: an evaluation task names no stage");
  return evaluationTaskKey(stage);
}

/**
 * The requirement one task runs under, read back out of the stored material.
 * IT IS READ AND NOT RE-MATERIALIZED: the requirement folds in platform
 * defaults this image carries, so resolving it a second time would run a cycle
 * under whatever the image of the day says rather than under what the ticket
 * was released with.
 */
export function ticketTaskRequirement(
  stored: unknown,
  key: ExecutionTaskKindKey,
): MaterializedExecutionRequirement & { readonly digest: string } {
  const tasks = (stored as { readonly tasks?: unknown } | null)?.tasks;
  const found = Array.isArray(tasks)
    ? (tasks as readonly { readonly key?: unknown }[]).find(
        (task) => task.key === key,
      )
    : undefined;
  const requirement = (found as { readonly executionRequirements?: unknown })
    ?.executionRequirements as Record<string, unknown> | undefined;
  const digest = requirement?.["digest"];
  const platformDefaultVersion = requirement?.["platformDefaultVersion"];
  if (typeof digest !== "string" || typeof platformDefaultVersion !== "number")
    throw new TypeError(
      `ticket definition: the stored material resolves no requirement for ${key}`,
    );
  return {
    value: asExecutionRequirement(requirement?.["value"]),
    source: asRequirementSource(requirement?.["source"]),
    platformDefaultVersion,
    digest,
  };
}

/**
 * The brief a ticket was released with, read back out of what its release
 * stored and held to the digest its `content` reference folds: a stored brief
 * that is not the one the journal names is not a brief the ticket runs.
 */
export function releasedTicketBrief(
  stored: unknown,
  contentDigest: string,
): DraftBrief | undefined {
  const brief =
    stored === undefined
      ? undefined
      : asDraftBrief(stored as Parameters<typeof asDraftBrief>[0]);
  if (materialDigest(brief ?? {}) !== contentDigest)
    throw new Error(
      "ticket definition: the stored brief is not the one the released content names",
    );
  return brief;
}

/** The four references one resolved task definition is, each a fold of its own digest. */
function taskDefinitionOf(task: TicketTaskMaterial): TaskDefinition {
  return {
    workload: digestFold(task.workload.digest),
    inputs: digestFold(task.inputs.digest),
    executionRequirements: digestFold(task.executionRequirements.digest),
    resultContract: digestFold(task.resultContract.digest),
  };
}

/**
 * The whole definition a release freezes onto its ticket. Every evaluator of a
 * stage runs that stage's definition, because a stage is what a configuration
 * indexes and an evaluator key is a slot within it.
 */
export function releasedTicketDefinition(
  ticket: TicketId,
  authoring: ReleaseAuthoring,
  material: TicketDefinitionMaterial,
): ReleasedTicket {
  return {
    id: ticket,
    content: digestFold(material.content.digest),
    dependencies: authoring.deps,
    workConfiguration: taskDefinitionOf(ticketTaskMaterialAt(material, "Work")),
    evaluationPlan: {
      stages: authoring.prog.map((stage) => {
        const task = taskDefinitionOf(
          ticketTaskMaterialAt(material, evaluationTaskKey(stage.key)),
        );
        return {
          key: stage.key,
          evaluators: stage.evaluators.map((entry) => ({
            key: entry.key,
            task,
          })),
        };
      }),
    },
    finalizationConfiguration: digestFold(material.finalization.digest),
  };
}
