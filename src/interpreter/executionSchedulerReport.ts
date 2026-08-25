/**
 * Result ingestion: what happens between an untrusted worker's report and one
 * settled logical task.
 *
 * IT IS AN INGRESS AND NOT A PASS, which is why it takes its own service.
 * `./executionSchedulerRun.ts` sweeps durable rows; a sealed `ResultManifest`
 * is producible only by the module that read the text, so a manifest cannot be
 * re-offered from a table and ingestion cannot be polled. The report arrives
 * where the worker's credential is authenticated, and this is what is done with
 * it there.
 *
 * A REPORT IS INPUT AND NOT EVIDENCE UNTIL IT HAS BEEN READ AND CONFIRMED.
 * `./resultManifest.ts` decides whether the text is a manifest at all, and the
 * artifact port decides whether the objects it names are really there with the
 * digest it claims. Only a report that passed both reaches the terminal
 * transaction, so an incomplete upload has no path to a successful verdict —
 * which is what issue #180 requires and the
 * reason verification is a separate port rather than a field on the manifest.
 *
 * A REFUSAL ENDS AN ATTEMPT AND NEVER A TASK. Neither a malformed manifest nor
 * an artifact that cannot be confirmed alters project state: the attempt is
 * lost, its slot stays with its execution, and the safe retry budget carries
 * it. When that budget is spent the launch path terminalizes the execution as a
 * single failed completion, which is how permanent loss of a required result
 * becomes a definitive execution failure instead of an immediate fabricated
 * one.
 *
 * A STORAGE OUTAGE IS NOT EVIDENCE ABOUT AN ARTIFACT, so `Unavailable` is its
 * own arm and leaves every durable row exactly as it was. Folding it into a
 * failure would turn an incident into a wave of failed tasks.
 *
 * ABSORPTION HAPPENS BELOW THE JOURNAL, AND THIS MODULE IS WHY IT NEVER RISES
 * TO IT. `terminalize` is the only completion submitted here and it is
 * submitted at most once per report; every other answer it can come back with
 * is returned to the caller with no further durable move. So an identical
 * redelivery finds the operation already recorded and yields that same one, a
 * late report for retired or revoked work leaves the domain alone, and a
 * contradictory terminal claim leaves the first outcome standing and raises a
 * scheduler integrity incident. `decideTaskDone` no-ops by identity, and
 * nothing here leans on it: a no-op never reaches the journal because it never
 * becomes a second completion.
 */

import {
  recordScheduler,
  type AttemptEvidence,
  type ExecutionOutcome,
  type ExecutionSchedulerStore,
  type FencedAttempt,
  type SchedulerTelemetry,
} from "./executionScheduler.ts";
import type { OperationId } from "./operationInbox.ts";
import {
  acceptResultManifest,
  type ArtifactFailure,
  type ArtifactSite,
  type ArtifactVerificationPort,
  type ManifestDigestFunction,
  type ManifestRejection,
  type ResultManifest,
  type ResultManifestId,
} from "./resultManifest.ts";

/** Everything ingestion calls out through, which is not what a pass calls out through. */
export interface ExecutionReportService {
  readonly store: Pick<ExecutionSchedulerStore, "attemptEnded" | "terminalize">;
  readonly artifacts: ArtifactVerificationPort;
  readonly digestOf: ManifestDigestFunction;
  readonly metrics: SchedulerTelemetry;
}

/**
 * One worker's report: the fenced identity its credential was issued under, the
 * manifest identity the scheduler minted for it, and the text it sent. Only the
 * text is the worker's to compose.
 */
export interface AttemptSubmission extends FencedAttempt {
  readonly manifest: ResultManifestId;
  readonly text: string;
}

/**
 * What ingesting one report settled. The arms that change nothing are kept
 * apart because they are different facts about the installation: a fenced
 * reporter has been superseded, a stale one is reporting on work the domain has
 * already retired, one that is not admitted belongs to a project that has
 * stopped taking any writer at all, and a contradictory one is an incident.
 */
export type ReportIngested =
  | {
      readonly ingested: "Terminalized";
      readonly outcome: ExecutionOutcome;
      readonly operation: OperationId;
    }
  | {
      readonly ingested: "Absorbed";
      readonly outcome: ExecutionOutcome;
      readonly operation: OperationId;
    }
  | { readonly ingested: "Fenced" }
  | { readonly ingested: "Stale" }
  | { readonly ingested: "NotAdmitted" }
  | { readonly ingested: "Conflicting"; readonly incident: string }
  | {
      readonly ingested: "Malformed";
      readonly code: ManifestRejection;
      readonly at?: ArtifactSite;
    }
  | {
      readonly ingested: "Unconfirmed";
      readonly failure: ArtifactFailure;
      readonly at: ArtifactSite;
    }
  | { readonly ingested: "Unavailable"; readonly retryAfterSeconds: number };

/** The fenced identity a submission claims, which is what every durable move takes. */
function submissionAttempt(submission: AttemptSubmission): FencedAttempt {
  return {
    partition: submission.partition,
    execution: submission.execution,
    attempt: submission.attempt,
    generation: submission.generation,
  };
}

/** Ends the reporting attempt without a result, which spends the safe retry budget. */
async function reportLost(
  service: ExecutionReportService,
  submission: AttemptSubmission,
  evidence: AttemptEvidence,
): Promise<boolean> {
  const ended = await service.store.attemptEnded(
    submissionAttempt(submission),
    "Lost",
    evidence,
  );
  recordScheduler(service.metrics, (metrics) => {
    metrics.attemptEnded("Lost", evidence);
  });
  return ended;
}

/**
 * The sealed manifest one report yields once it has been both read and
 * confirmed, or the refusal that stopped it becoming one.
 */
async function confirmedManifest(
  service: ExecutionReportService,
  submission: AttemptSubmission,
): Promise<ResultManifest | ReportIngested> {
  const accepted = acceptResultManifest(
    {
      partition: submission.partition,
      execution: submission.execution,
      attempt: submission.attempt,
    },
    submission.manifest,
    submission.text,
    service.digestOf,
  );
  recordScheduler(service.metrics, (metrics) => {
    metrics.manifest(accepted.accepted);
  });
  if (accepted.accepted === "Rejected") {
    if (!(await reportLost(service, submission, "ManifestInvalid")))
      return { ingested: "Fenced" };
    return accepted.at === undefined
      ? { ingested: "Malformed", code: accepted.code }
      : { ingested: "Malformed", code: accepted.code, at: accepted.at };
  }
  const confirmed = await service.artifacts.verifyManifest(accepted.manifest);
  switch (confirmed.verified) {
    case "Unavailable":
      return {
        ingested: "Unavailable",
        retryAfterSeconds: confirmed.retryAfterSeconds,
      };
    case "Rejected":
      if (!(await reportLost(service, submission, "ManifestInvalid")))
        return { ingested: "Fenced" };
      return {
        ingested: "Unconfirmed",
        failure: confirmed.failure,
        at: confirmed.at,
      };
    case "Verified":
      return accepted.manifest;
  }
}

/**
 * Reads one report, confirms what it declares and settles the logical task it
 * belongs to, or says which of those it did not get past.
 */
export async function executionSchedulerIngest(
  service: ExecutionReportService,
  submission: AttemptSubmission,
): Promise<ReportIngested> {
  const confirmed = await confirmedManifest(service, submission);
  if ("ingested" in confirmed) return confirmed;
  const settled = await service.store.terminalize({
    ...submissionAttempt(submission),
    manifest: confirmed,
  });
  recordScheduler(service.metrics, (metrics) => {
    metrics.terminalization(settled.terminalized);
  });
  switch (settled.terminalized) {
    case "Terminalized":
      return {
        ingested: "Terminalized",
        outcome: settled.outcome,
        operation: settled.operation,
      };
    case "AlreadyTerminal":
      return {
        ingested: "Absorbed",
        outcome: settled.outcome,
        operation: settled.operation,
      };
    case "Fenced":
      return { ingested: "Fenced" };
    case "Cancelled":
      return { ingested: "Stale" };
    case "NotAdmitted":
      return { ingested: "NotAdmitted" };
    case "Conflicting":
      recordScheduler(service.metrics, (metrics) => {
        metrics.incident("ConflictingResult");
      });
      return { ingested: "Conflicting", incident: settled.incident };
  }
}
