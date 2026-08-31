import type { TaskId, TicketId } from "../domain/ids.ts";
import type {
  CanonicalConfiguration,
  ConfigurationRevisionId,
} from "./authoring.ts";
import type {
  AttemptEvidence,
  AttemptState,
  ExecutionOutcome,
  ExecutionStatus,
  ExecutionTaskKind,
} from "./executionScheduler.ts";
import type { ExecutionRunResource, RunTotals } from "./runEvidence.ts";
import { allExecutionStatuses } from "./executionScheduler.ts";
import type { Partition } from "./projectStore.ts";
import type { ConfigurationVersion } from "./repositoryConfigurationIdentity.ts";
import type { AttemptId, ClusterId, ExecutionId } from "./schedulerIdentity.ts";
import type {
  ArtifactDigest,
  ArtifactPath,
  ArtifactRole,
  ResultManifestId,
} from "./resultManifest.ts";
import { asArtifactPath } from "./resultManifest.ts";
import type { PublicInstant } from "./publicResource.ts";
import type {
  ExecutionRequirement,
  RequirementSource,
} from "./executionRequirement.ts";
import type { Worker } from "./workerCatalog.ts";

export type OutputRenderer = "UnifiedDiff" | "Markdown" | "Json" | "Text";

export interface OutputDefinition {
  readonly name: string;
  readonly path: ArtifactPath;
  readonly mediaType: string;
  readonly renderer: OutputRenderer;
  readonly schema?: Readonly<Record<string, unknown>>;
}

export const branchDiffOutput: OutputDefinition = {
  name: "branch-diff",
  path: asArtifactPath(".chuggy/outputs/branch.diff"),
  mediaType: "text/x-diff",
  renderer: "UnifiedDiff",
} as const;

export const workSummaryOutput: OutputDefinition = {
  name: "work-summary",
  path: asArtifactPath(".chuggy/outputs/summary.md"),
  mediaType: "text/markdown",
  renderer: "Markdown",
} as const;

export type ExecutionSelection =
  | { readonly selection: "NonTerminal" }
  | {
      readonly selection: "Selected";
      readonly states: readonly ExecutionStatus[];
    };

/**
 * Where a page of executions resumes.
 *
 * The list has one order, `(ticket, task)` ascending, which is the machine's
 * own history: a ticket's tasks are numbered across its whole history, so
 * ascending task is the sequence they were authorized in. The position is
 * total because a ticket numbers each task once.
 */
export interface ExecutionPageCursor {
  readonly ticket: TicketId;
  readonly task: TaskId;
}

/**
 * `ticket` narrows that one order rather than replacing it, so a cursor means
 * the same position in the ticket-scoped read and the project-wide one and
 * there is no second kind of cursor to confuse it with. A cursor resuming a
 * ticket the query does not select is refused in either direction, because
 * each direction answers with something a reader would believe: a cursor from
 * an earlier ticket silently restarts the selected one at its first task, and
 * a cursor from a later ticket silently answers an empty page for a ticket
 * that has run.
 */
export interface ExecutionListQuery {
  readonly after?: ExecutionPageCursor;
  readonly ticket?: TicketId;
  readonly limit: number;
  readonly selection?: ExecutionSelection;
}

export interface ExecutionSummary {
  readonly execution: ExecutionId;
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly cluster: ClusterId;
  readonly configurationRevision: ConfigurationRevisionId;
  readonly configurationVersion?: ConfigurationVersion;
  readonly requirementIdentity: string;
  readonly requirement: ExecutionRequirement;
  readonly requirementDigest: string;
  readonly requirementSource: RequirementSource;
  /** The spawn request that made this execution, which is its fan-out set's identity. */
  readonly request: string;
  readonly worker?: Worker;
  readonly platformDefaultVersion: number;
  readonly status: ExecutionStatus;
  readonly outcome?: ExecutionOutcome;
  readonly retriesSpent: number;
  readonly registeredAt: PublicInstant;
  readonly terminalAt?: PublicInstant;
  readonly runTotals?: RunTotals;
}

/**
 * The same summary carrying the label the image its requirement pins is
 * catalogued under. A native requirement pins no image and keeps none.
 */
export function executionSummaryLabelled(
  summary: ExecutionSummary,
  workers: ReadonlyMap<string, Worker>,
): ExecutionSummary {
  if (summary.requirement.mode !== "Container") return summary;
  const worker = workers.get(summary.requirement.image);
  return worker === undefined ? summary : { ...summary, worker };
}

/** The same summary carrying what its own attempts' runs sum to, where any ran. */
export function executionSummaryTotalled(
  summary: ExecutionSummary,
  totals: ReadonlyMap<string, RunTotals>,
): ExecutionSummary {
  const runTotals = totals.get(summary.execution);
  return runTotals === undefined ? summary : { ...summary, runTotals };
}

/** Every image the given summaries pin, which is what a catalog is asked for. */
export function executionSummaryImages(
  summaries: readonly ExecutionSummary[],
): readonly string[] {
  return summaries.flatMap((summary) =>
    summary.requirement.mode === "Container" ? [summary.requirement.image] : [],
  );
}

export interface ExecutionAttemptResource {
  readonly attempt: AttemptId;
  readonly number: number;
  readonly generation: number;
  readonly state: AttemptState;
  readonly openedAt: PublicInstant;
  readonly endedAt?: PublicInstant;
  readonly evidence?: AttemptEvidence;
  readonly run?: ExecutionRunResource;
}

export interface ResultArtifactResource {
  readonly ordinal: number;
  readonly role: ArtifactRole;
  readonly path: ArtifactPath;
  readonly digest: ArtifactDigest;
  readonly bytes: number;
  readonly output?: OutputDefinition;
}

export interface ExecutionResultResource {
  readonly manifest: ResultManifestId;
  readonly attempt: AttemptId;
  readonly schemaVersion: number;
  readonly digest: ArtifactDigest;
  readonly verdict: "Pass" | "Fail";
  readonly recordedAt: PublicInstant;
  readonly artifacts: readonly ResultArtifactResource[];
  readonly report?: string;
}

export const outputPreviewBytesMax = 1_048_576;

export type OutputContentRead =
  | {
      readonly read: "Content";
      readonly mediaType: string;
      readonly renderer: OutputRenderer;
      readonly content: string;
      readonly schema?: Readonly<Record<string, unknown>>;
    }
  | { readonly read: "NotFound" }
  | { readonly read: "TooLarge"; readonly bytes: number }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

export interface OutputContentPort {
  read(input: {
    readonly partition: Partition;
    readonly execution: ExecutionId;
    readonly attempt: AttemptId;
    readonly artifact: ResultArtifactResource;
  }): Promise<OutputContentRead>;
}

export interface ExecutionResource extends ExecutionSummary {
  readonly attempts: readonly ExecutionAttemptResource[];
  readonly result?: ExecutionResultResource;
}

export interface ExecutionPage {
  readonly executions: readonly ExecutionSummary[];
  readonly nextAfter?: ExecutionPageCursor;
}

export interface OperationalReadStore {
  status(partition: Partition): Promise<ProjectOperationalStatus>;
  executions(
    partition: Partition,
    query: ExecutionListQuery,
  ): Promise<ExecutionPage>;
  execution(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<ExecutionResource | undefined>;
}

export interface ProjectOperationalStatus {
  readonly observedAt: PublicInstant;
  readonly schedulerFreshness: "Unknown";
  readonly queued: number;
  readonly admitted: number;
  readonly launching: number;
  readonly running: number;
  readonly clusterSlotsMax: number;
  readonly clusterActive: number;
  readonly accountMaximum: number;
  readonly accountActive: number;
  readonly accountReservationDeficit: number;
}

export const executionPageLimitMax = 100;

export function checkedExecutionListQuery(
  query: ExecutionListQuery,
): ExecutionListQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > executionPageLimitMax
  )
    throw new RangeError(
      `execution page limit must be between 1 and ${String(executionPageLimitMax)}`,
    );
  if (query.selection?.selection === "Selected") {
    const states = query.selection.states;
    if (
      states.length < 1 ||
      states.length > allExecutionStatuses.length ||
      new Set(states).size !== states.length ||
      states.some((state) => !allExecutionStatuses.includes(state))
    )
      throw new RangeError("execution state selection is invalid");
  }
  if (
    query.after !== undefined &&
    query.ticket !== undefined &&
    query.after.ticket !== query.ticket
  )
    throw new RangeError("execution cursor resumes another ticket");
  return query;
}

export function configuredOutputs(
  canonical: CanonicalConfiguration,
): readonly OutputDefinition[] {
  const parsed = JSON.parse(canonical) as Readonly<Record<string, unknown>>;
  const configured = parsed["outputs"];
  if (!Array.isArray(configured)) return [branchDiffOutput, workSummaryOutput];
  const outputs: OutputDefinition[] = [branchDiffOutput, workSummaryOutput];
  for (const candidate of configured) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const fields = candidate as Readonly<Record<string, unknown>>;
    const name = fields["name"];
    const path = fields["path"];
    const mediaType = fields["mediaType"];
    const renderer = fields["renderer"];
    const schema = fields["schema"];
    if (
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 64 ||
      typeof path !== "string" ||
      typeof mediaType !== "string" ||
      mediaType.length < 1 ||
      mediaType.length > 128 ||
      (renderer !== "UnifiedDiff" &&
        renderer !== "Markdown" &&
        renderer !== "Json" &&
        renderer !== "Text") ||
      (schema !== undefined &&
        (typeof schema !== "object" ||
          schema === null ||
          Array.isArray(schema)))
    )
      continue;
    try {
      outputs.push({
        name,
        path: asArtifactPath(path),
        mediaType,
        renderer,
        ...(schema === undefined
          ? {}
          : { schema: schema as Readonly<Record<string, unknown>> }),
      });
    } catch {
      continue;
    }
  }
  return outputs;
}
