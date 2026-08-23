import type { TaskId, TicketId } from "../domain/ids.ts";
import type {
  CanonicalConfiguration,
  ConfigurationRevisionId,
} from "./authoring.ts";
import type {
  AttemptState,
  ExecutionOutcome,
  ExecutionStatus,
  ExecutionTaskKind,
} from "./executionScheduler.ts";
import { allExecutionStatuses } from "./executionScheduler.ts";
import type { Partition } from "./projectStore.ts";
import type { AttemptId, ClusterId, ExecutionId } from "./schedulerIdentity.ts";
import type {
  ArtifactDigest,
  ArtifactPath,
  ArtifactRole,
  ResultManifestId,
} from "./resultManifest.ts";
import { asArtifactPath } from "./resultManifest.ts";
import type { PublicInstant } from "./publicResource.ts";

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

export interface ExecutionListQuery {
  readonly after?: ExecutionId;
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
  readonly status: ExecutionStatus;
  readonly outcome?: ExecutionOutcome;
  readonly retriesSpent: number;
  readonly registeredAt: PublicInstant;
  readonly terminalAt?: PublicInstant;
}

export interface ExecutionAttemptResource {
  readonly attempt: AttemptId;
  readonly number: number;
  readonly generation: number;
  readonly state: AttemptState;
  readonly openedAt: PublicInstant;
  readonly endedAt?: PublicInstant;
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
  readonly nextAfter?: ExecutionId;
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
