import {
  workerContractRelease,
  workerContractUnnamed,
  workerContractVersionOf,
  workerContractVersionText,
  type ContractVersionRefusal,
  type WorkerContractVersion,
} from "../contract/workerContract.ts";
import type { SessionBearerSecret } from "./agentSession.ts";
import type {
  AttemptCapabilitySecret,
  FencedAttempt,
  WorkTaskInvocation,
} from "./executionScheduler.ts";
import type {
  AttemptSubmission,
  ReportIngested,
} from "./executionSchedulerReport.ts";
import type { ExecutionTaskKind } from "./executionRequirement.ts";
import type { ResultManifestId } from "./resultManifest.ts";
import type { SessionTaskInvocation } from "./sessionScheduler.ts";
import type { SessionTaskIdentity, WorkTaskIdentity } from "./workerTask.ts";

/** The versions of the worker contract this plane serves, from the first to the one it was built with. */
export const workerContractAccepted: {
  readonly min: WorkerContractVersion;
  readonly max: WorkerContractVersion;
} = {
  min: { major: 1, minor: 0 },
  max: workerContractServed(),
};

/** The version this plane was built with, read off its release. */
function workerContractServed(): WorkerContractVersion {
  const served = workerContractVersionOf(workerContractRelease);
  if (served === undefined)
    throw new Error(`${workerContractRelease} is not a contract release`);
  return served;
}

/** Whether `left` is no later a version than `right`. */
function workerContractOrdered(
  left: WorkerContractVersion,
  right: WorkerContractVersion,
): boolean {
  return (
    left.major < right.major ||
    (left.major === right.major && left.minor <= right.minor)
  );
}

/** Whether a request naming `offered`, or naming no release, speaks a version this plane serves. */
export function contractVersionAccepted(offered: string | undefined): boolean {
  const version =
    offered === undefined
      ? workerContractUnnamed
      : workerContractVersionOf(offered);
  return (
    version !== undefined &&
    workerContractOrdered(workerContractAccepted.min, version) &&
    workerContractOrdered(version, workerContractAccepted.max)
  );
}

/** What a request speaking a version outside the range is answered with. */
export const contractVersionRefusal: ContractVersionRefusal = {
  action: "stop",
  reason: "UnsupportedContractVersion",
  accepted: {
    min: workerContractVersionText(workerContractAccepted.min),
    max: workerContractVersionText(workerContractAccepted.max),
  },
};

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
  /** What the scheduler recorded this attempt as doing, which no pod may claim for itself. */
  readonly taskKind: ExecutionTaskKind;
  readonly manifest: ResultManifestId;
  readonly inputBundle: string;
  readonly inputBundleDigest: string;
  readonly inputs: readonly WorkerInputReference[];
}

/** What an attempt's bearer finds of its task, the invocation absent until the scheduler records one. */
export interface WorkerTaskRead {
  readonly live: boolean;
  readonly identity: WorkTaskIdentity;
  readonly invocation?: WorkTaskInvocation;
}

/** What a session attempt's bearer finds of its task, the invocation absent where the attempt opened before one was recorded. */
export interface SessionTaskRead {
  readonly live: boolean;
  readonly identity: SessionTaskIdentity;
  readonly invocation?: SessionTaskInvocation;
}

/** The task either kind of bearer fetches, each read through its own bearer's digest. */
export interface WorkerTaskPort {
  work(secret: AttemptCapabilitySecret): Promise<WorkerTaskRead | undefined>;
  session(secret: SessionBearerSecret): Promise<SessionTaskRead | undefined>;
}

export interface WorkerPlaneAuthority {
  authenticate(
    secret: AttemptCapabilitySecret,
  ): Promise<WorkerAttemptAuthority | undefined>;
}

export interface WorkerAttemptHeartbeatPort {
  heartbeat(
    secret: AttemptCapabilitySecret,
    generation: number,
    leaseSecs: number,
  ): Promise<boolean>;
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
