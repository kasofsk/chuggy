/**
 * What one agent run left behind, at the grain the attempt that produced it
 * already has: the configuration it started under, its transcript in batches,
 * its per-turn usage series, and what it spent.
 *
 * EVIDENCE NEVER TRAVELS IN THE RESULT MANIFEST. A run that dies has no
 * manifest and must still carry its figures, so a manifest-borne copy would be
 * a second channel for the same fact; and a malformed figure would then refuse
 * a real result. Evidence has its own capability-keyed writes instead, and the
 * manifest schema is untouched by any of them.
 *
 * A RUN IS SEALED BY ITS ATTEMPT ENDING AND NOT BY A WRITE. `runIsComplete`
 * reads the attempt's own state, which the scheduler's lease sweep moves
 * without the worker's cooperation, so there is no seal column and no way for a
 * dead run to sit live forever.
 *
 * EVERY BYTE IS STORED UNDER A PATH THIS MODULE DERIVES. A worker names no
 * path, so the manifest's own reservation quota is untouched and a run's bytes
 * are bounded by this module's bounds alone.
 */

import type { AttemptState } from "./executionScheduler.ts";
import type { AttemptCapabilitySecret } from "./executionScheduler.ts";
import type { Partition } from "./projectStore.ts";
import type { PublicInstant } from "./publicResource.ts";
import {
  asArtifactPath,
  type ArtifactDigest,
  type ArtifactPath,
} from "./resultManifest.ts";
import type { AttemptId, ExecutionId } from "./schedulerIdentity.ts";
import { runTranscriptBatchesMax, runTurnSeriesMax } from "../contract/http.ts";
import type { RunCostBasis } from "../contract/rosters.ts";

/** Where a run's configuration snapshot is stored, which no worker chooses. */
export function runConfigurationPath(): ArtifactPath {
  return asArtifactPath(".chuggy/run/configuration.json");
}

/** Where one transcript batch is stored, refusing a number outside the run's bound. */
export function runTranscriptBatchPath(batch: number): ArtifactPath {
  if (
    !Number.isSafeInteger(batch) ||
    batch < 1 ||
    batch > runTranscriptBatchesMax
  )
    throw new RangeError("a transcript batch is outside the run's bound");
  return asArtifactPath(`.chuggy/run/transcript/${String(batch)}.jsonl`);
}

/** Whether an attempt may still write evidence, which is what makes a read incomplete. */
export function runIsComplete(state: AttemptState): boolean {
  return state !== "Placing" && state !== "Running";
}

/** Tokens by kind, as the agent runtime counts them. */
export interface RunTokens {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensCacheCreation: number;
  readonly tokensCacheRead: number;
}

/** One model's share of a run, which is what a per-model breakdown is a page of. */
export interface RunModelUsage extends RunTokens {
  readonly model: string;
  readonly costUsdMicros: number;
}

/** What one run spent, in the runtime's own list price and its own vocabulary. */
export interface RunTotals extends RunTokens {
  readonly turns: number;
  readonly durationMs: number;
  readonly durationApiMs: number;
  readonly costUsdMicros: number;
  readonly costBasis: RunCostBasis;
  readonly models: readonly RunModelUsage[];
  readonly permissionDenials: number;
  readonly resultSubtype?: string;
  readonly stopReason?: string;
}

/** One assistant turn's usage, as the worker offers it before the server dates it. */
export interface RunTurnRecord extends RunTokens {
  readonly ordinal: number;
  readonly model: string;
}

/** The same turn as a read returns it, dated by the server that stored it. */
export interface RunTurnResource extends RunTurnRecord {
  readonly recordedAt: PublicInstant;
}

/** Where a run's snapshot is and how much of it there is. */
export interface RunConfigurationRef {
  readonly digest: ArtifactDigest;
  readonly bytes: number;
  readonly recordedAt: PublicInstant;
}

/** How far a run's transcript has been written, and when its newest batch was. */
export interface RunTranscriptRef {
  readonly batches: number;
  readonly bytes: number;
  readonly highWaterBatch: number;
  readonly observedAt: PublicInstant;
}

/** One run's evidence, which is what the attempt that produced it carries. */
export interface ExecutionRunResource {
  readonly startedAt: PublicInstant;
  readonly configuration?: RunConfigurationRef;
  readonly transcript?: RunTranscriptRef;
  readonly turnsRecorded: number;
  readonly totals?: RunTotals;
}

/** What a durable evidence write found, decided in SQL and mapped by the plane. */
export const allRunEvidenceStored = [
  "Stored",
  "AlreadyStored",
  "OutOfOrder",
  "Conflict",
  "QuotaExceeded",
  "Fenced",
] as const;
export type RunEvidenceStored = (typeof allRunEvidenceStored)[number];

/** What one call offering a page of turns found, carrying the stored high-water. */
export type RunTurnsRecorded =
  | { readonly recorded: "Recorded"; readonly turnsRecorded: number }
  | { readonly recorded: "Conflict" | "Fenced" };

/** The fence every evidence write is keyed by, which is the attempt's own bearer. */
export interface RunEvidenceWrite {
  readonly secret: AttemptCapabilitySecret;
  readonly generation: number;
}

export interface WorkerRunConfigurationPort {
  record(
    input: RunEvidenceWrite & {
      readonly digest: ArtifactDigest;
      readonly bytes: number;
    },
  ): Promise<RunEvidenceStored>;
}

export interface WorkerRunTranscriptPort {
  record(
    input: RunEvidenceWrite & {
      readonly batch: number;
      readonly digest: ArtifactDigest;
      readonly bytes: number;
      readonly events: number;
    },
  ): Promise<RunEvidenceStored>;
}

export interface WorkerRunTurnsPort {
  record(
    input: RunEvidenceWrite & { readonly turns: readonly RunTurnRecord[] },
  ): Promise<RunTurnsRecorded>;
}

export interface WorkerRunTotalPort {
  record(
    input: RunEvidenceWrite & { readonly totals: RunTotals },
  ): Promise<RunEvidenceStored>;
}

/**
 * Narrowing a live attempt to the label its own run knows it ended under. The
 * lease sweep ends it either way, so a refusal here costs promptness alone.
 */
export interface WorkerRunEndedPort {
  end(
    input: RunEvidenceWrite & { readonly evidence: RunEndedEvidence },
  ): Promise<boolean>;
}

/** The labels a run may end itself under, which are the four the run itself sees. */
export const runEndedEvidences = [
  "RunFailed",
  "RunRateLimited",
  "RunTurnsExhausted",
  "RunUploadRefused",
] as const;
export type RunEndedEvidence = (typeof runEndedEvidences)[number];

/** One page of a run's per-turn series, resumed after the ordinal it names. */
export interface RunTurnsQuery {
  readonly after?: number;
  readonly limit: number;
}

export interface RunTurnsPage {
  readonly turns: readonly RunTurnResource[];
  readonly nextAfter?: number;
}

/** Where one batch stands in a run's transcript, whatever its bytes turned out to be. */
interface RunTranscriptBatchAt {
  readonly batch: number;
  readonly recordedAt: PublicInstant;
  readonly bytes: number;
}

/**
 * One transcript batch as a read returns it: its characters, or the reason it
 * has none. A batch nothing can be drawn for is marked, so the batches beside
 * it are still answered.
 */
export type RunTranscriptBatch =
  | (RunTranscriptBatchAt & {
      readonly read: "Content";
      readonly content: string;
    })
  | (RunTranscriptBatchAt & { readonly read: "Missing" | "Corrupt" });

/** One page of a run's transcript; `complete` is read from the attempt, never stored. */
export interface RunTranscriptPage {
  readonly batches: readonly RunTranscriptBatch[];
  readonly observedAt: PublicInstant;
  readonly complete: boolean;
  readonly nextAfter?: number;
}

/** What reading a run's transcript found, an outage kept apart from an absence. */
export type RunTranscriptRead =
  | { readonly read: "Page"; readonly page: RunTranscriptPage }
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

/** What reading a run's configuration snapshot found. */
export type RunConfigurationRead =
  | {
      readonly read: "Content";
      readonly digest: ArtifactDigest;
      readonly bytes: number;
      readonly content: string;
    }
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

/** One stored object a run's evidence names, which is what a content read is given. */
export interface RunEvidenceObject {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly path: ArtifactPath;
  readonly digest: ArtifactDigest;
  readonly bytes: number;
}

/** What drawing one run-evidence object's bytes found. */
export type RunEvidenceContentRead =
  | { readonly read: "Content"; readonly content: string }
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

/** The bytes behind a run's stored evidence, which the durable rows only point at. */
export interface RunEvidenceContentPort {
  readEvidence(object: RunEvidenceObject): Promise<RunEvidenceContentRead>;
}

/** What one attempt's stored evidence says, without the bytes it points at. */
export interface RunEvidenceReadStore {
  turns(
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
    query: RunTurnsQuery,
  ): Promise<RunTurnsPage | undefined>;
  transcript(
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
    after: number,
  ): Promise<RunTranscriptStored | undefined>;
  configuration(
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
  ): Promise<RunConfigurationStored | undefined>;
}

/** The rows one transcript page is assembled from, before their bytes are drawn. */
export interface RunTranscriptStored {
  readonly objects: readonly (RunEvidenceObject & {
    readonly batch: number;
    readonly recordedAt: PublicInstant;
  })[];
  readonly observedAt: PublicInstant;
  readonly complete: boolean;
  readonly nextAfter?: number;
}

/** The row one configuration read is assembled from, before its bytes are drawn. */
export interface RunConfigurationStored {
  readonly object: RunEvidenceObject;
}

/** Refuses a turn page query outside the bounds the wire and the series declare. */
export function checkedRunTurnsQuery(query: RunTurnsQuery): RunTurnsQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > runTurnsPageLimitMax
  )
    throw new RangeError("a turn page limit is outside the wire's bound");
  if (
    query.after !== undefined &&
    (!Number.isSafeInteger(query.after) ||
      query.after < 0 ||
      query.after > runTurnSeriesMax)
  )
    throw new RangeError("a turn cursor is outside the series bound");
  return query;
}

/** The most turns one page carries, which is the page bound every route shares. */
export const runTurnsPageLimitMax = 100;

/** Refuses a transcript cursor outside the run's own batch bound. */
export function checkedRunTranscriptAfter(after: number): number {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    after > runTranscriptBatchesMax
  )
    throw new RangeError("a transcript cursor is outside the run's bound");
  return after;
}
