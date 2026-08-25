import type {
  AttemptCapabilitySecret,
  FencedAttempt,
} from "./executionScheduler.ts";
import type {
  AttemptSubmission,
  ReportIngested,
} from "./executionSchedulerReport.ts";
import type { ResultManifestId } from "./resultManifest.ts";

/** The bounded metadata of one immutable reference pinned by an attempt's input bundle. */
export interface WorkerInputReference {
  readonly ordinal: number;
  readonly kind: string;
  readonly reference: string;
  readonly digest?: string;
}

/** Authority recovered only from a live attempt's bearer. */
export interface WorkerAttemptAuthority extends FencedAttempt {
  readonly live: boolean;
  readonly manifest: ResultManifestId;
  readonly inputBundle: string;
  readonly inputBundleDigest: string;
  readonly inputs: readonly WorkerInputReference[];
}

export interface WorkerPlaneAuthority {
  authenticate(
    secret: AttemptCapabilitySecret,
  ): Promise<WorkerAttemptAuthority | undefined>;
}

export type WorkerArtifactStored =
  | { readonly stored: "Stored" }
  | {
      readonly stored: "Refused";
      readonly reason: "InvalidPath" | "QuotaExceeded";
    }
  | { readonly stored: "Conflict" }
  | { readonly stored: "Unavailable"; readonly retryAfterSeconds: number };

export interface WorkerArtifactUploadPort {
  store(input: {
    readonly authority: WorkerAttemptAuthority;
    readonly path: string;
    readonly content: Uint8Array;
  }): Promise<WorkerArtifactStored>;
}

export type WorkerArtifactReserved =
  | { readonly reserved: "Reserved" }
  | { readonly reserved: "Conflict" | "Fenced" | "QuotaExceeded" };

export interface WorkerArtifactReservationPort {
  reserve(input: {
    readonly secret: AttemptCapabilitySecret;
    readonly path: string;
    readonly digest: string;
    readonly bytes: number;
  }): Promise<WorkerArtifactReserved>;
}

export interface WorkerReportPort {
  report(
    secret: AttemptCapabilitySecret,
    submission: AttemptSubmission,
  ): Promise<ReportIngested>;
}
