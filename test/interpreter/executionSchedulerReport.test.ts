/**
 * Result ingestion at the lowest tier that can express it: which durable move
 * each answer produces, with the store and the artifact storage replaced by
 * recorders.
 *
 * THE PROPERTY EVERY CASE IS ABOUT IS WHAT DID NOT HAPPEN. A completion that is
 * absorbed, fenced, stale or contradictory must leave the domain exactly as it
 * was, and the only way to say that at this tier is to assert the whole call
 * list — so every case reads the recorder rather than the return value alone.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  allAttemptEvidence,
  asAttemptId,
  asExecutionId,
  schedulerTelemetry,
  silentExecutionSchedulerMetrics,
  silentSchedulerTelemetry,
  type ExecutionSchedulerMetrics,
  type ExecutionSchedulerStore,
  type SchedulerIncidentKind,
  type Terminalized,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerIngest,
  type AttemptSubmission,
  type ExecutionReportService,
} from "../../src/interpreter/executionSchedulerReport.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  allArtifactFailures,
  asResultManifestId,
  type ArtifactVerificationPort,
  type ArtifactsVerified,
  type CanonicalManifest,
} from "../../src/interpreter/resultManifest.ts";
import { recordingMetrics, throwingMetrics } from "./schedulerSinks.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const operation = asOperationId("operation-one");

/** The digest this suite hands the boundary, which is the one a deployment hands it too. */
function digestOf(canonical: CanonicalManifest): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** One report body, which is the only part of a submission a worker composes. */
function report(verdict: string): string {
  return JSON.stringify({ version: 1, verdict, handoffs: [], diagnostics: [] });
}

/** One worker submission under the shared fenced identity, which every case starts from. */
function submissionOf(text: string): AttemptSubmission {
  return {
    partition,
    execution: asExecutionId("execution-one"),
    attempt: asAttemptId("attempt-one"),
    generation: 2,
    manifest: asResultManifestId("manifest-one"),
    text,
  };
}

/** Artifact storage that answers exactly what a case is about and reads nothing. */
function storageAnswering(
  verified: ArtifactsVerified,
): ArtifactVerificationPort {
  return { verifyManifest: () => Promise.resolve(verified) };
}

const confirmed = storageAnswering({ verified: "Verified" });

/** A store that records every durable move asked of it and takes none. */
function recordingStore(
  calls: string[],
  settled: Terminalized,
): ExecutionSchedulerStore {
  const unreached = () => {
    throw new Error("ingestion reached a move it has no business making");
  };
  return {
    claimRequests: unreached,
    registerSpawn: unreached,
    registerCancellation: unreached,
    admit: unreached,
    openAttempt: unreached,
    attemptPlaced: unreached,
    attemptEnded: (attempt, loss, evidence) => {
      calls.push(`ended:${String(attempt.generation)}:${loss}:${evidence}`);
      return Promise.resolve(true);
    },
    retriesExhausted: unreached,
    terminalize: (submitted) => {
      calls.push(
        `terminalize:${String(submitted.generation)}:${submitted.manifest.verdict}`,
      );
      return Promise.resolve(settled);
    },
    blockExecution: unreached,
    execution: unreached,
    reapLapsedAttempts: unreached,
    attemptsAwaitingCleanup: unreached,
    attemptCleanupCompleted: unreached,
    unlaunched: unreached,
    fenceOldEpochAttempts: unreached,
  };
}

/** A service whose store and storage answer exactly what a case is about. */
function serviceWith(
  calls: string[],
  settled: Terminalized,
  artifacts: ArtifactVerificationPort = confirmed,
  metrics: ExecutionSchedulerMetrics | undefined = undefined,
): ExecutionReportService {
  return {
    store: recordingStore(calls, settled),
    artifacts,
    digestOf,
    metrics:
      metrics === undefined
        ? silentSchedulerTelemetry
        : schedulerTelemetry(metrics),
  };
}

const passed: Terminalized = {
  terminalized: "Terminalized",
  outcome: "Passed",
  operation,
};

test("a confirmed report settles the logical task once", async () => {
  const calls: string[] = [];
  assert.deepEqual(
    await executionSchedulerIngest(
      serviceWith(calls, passed),
      submissionOf(report("Pass")),
    ),
    { ingested: "Terminalized", outcome: "Passed", operation },
  );
  assert.deepEqual(calls, ["terminalize:2:Pass"]);
});

test("a malformed report loses its attempt and settles nothing", async () => {
  const calls: string[] = [];
  const outcome = await executionSchedulerIngest(
    serviceWith(calls, passed),
    submissionOf("{"),
  );
  assert.deepEqual(outcome, { ingested: "Malformed", code: "TextUnreadable" });
  assert.deepEqual(calls, ["ended:2:Lost:ManifestInvalid"]);
});

test("a report is refused at the row it went wrong at, and settles nothing", async () => {
  const calls: string[] = [];
  const outcome = await executionSchedulerIngest(
    serviceWith(calls, passed),
    submissionOf(
      JSON.stringify({
        version: 1,
        verdict: "Pass",
        handoffs: [{ path: "../escape", digest: "0".repeat(64), bytes: 1 }],
        diagnostics: [],
      }),
    ),
  );
  assert.deepEqual(outcome, {
    ingested: "Malformed",
    code: "PathDotSegment",
    at: { role: "Handoff", index: 0 },
  });
  assert.deepEqual(calls, ["ended:2:Lost:ManifestInvalid"]);
});

test("no artifact failure can produce a successful verdict", async () => {
  for (const failure of allArtifactFailures) {
    const calls: string[] = [];
    const at = { role: "Handoff", index: 0 } as const;
    const service = serviceWith(
      calls,
      passed,
      storageAnswering({ verified: "Rejected", failure, at }),
    );
    assert.deepEqual(
      await executionSchedulerIngest(service, submissionOf(report("Pass"))),
      { ingested: "Unconfirmed", failure, at },
    );
    assert.deepEqual(calls, ["ended:2:Lost:ManifestInvalid"]);
  }
});

test("unreachable storage changes nothing at all", async () => {
  const calls: string[] = [];
  const service = serviceWith(
    calls,
    passed,
    storageAnswering({ verified: "Unavailable", retryAfterSeconds: 5 }),
  );
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Pass"))),
    { ingested: "Unavailable", retryAfterSeconds: 5 },
  );
  assert.deepEqual(calls, []);
});

test("identical redelivery yields the operation already recorded", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, {
    terminalized: "AlreadyTerminal",
    outcome: "Passed",
    operation,
  });
  const submission = submissionOf(report("Pass"));
  assert.deepEqual(await executionSchedulerIngest(service, submission), {
    ingested: "Absorbed",
    outcome: "Passed",
    operation,
  });
  assert.deepEqual(await executionSchedulerIngest(service, submission), {
    ingested: "Absorbed",
    outcome: "Passed",
    operation,
  });
  assert.deepEqual(calls, ["terminalize:2:Pass", "terminalize:2:Pass"]);
});

test("a fenced reporter is refused without a second durable move", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, { terminalized: "Fenced" });
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Pass"))),
    { ingested: "Fenced" },
  );
  assert.deepEqual(calls, ["terminalize:2:Pass"]);
});

test("a report into a project that admits no writer is its own answer", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, { terminalized: "NotAdmitted" });
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Pass"))),
    { ingested: "NotAdmitted" },
  );
  assert.deepEqual(calls, ["terminalize:2:Pass"]);
});

test("ingesting one confirmed report observes reading it and settling it", async () => {
  const seen: string[] = [];
  const service = serviceWith([], passed, confirmed, recordingMetrics(seen));
  await executionSchedulerIngest(service, submissionOf(report("Pass")));
  assert.deepEqual(seen, ["manifest:Accepted", "terminalization:Terminalized"]);
});

test("a refused manifest observes the attempt it ended and nothing settled", async () => {
  const seen: string[] = [];
  const service = serviceWith([], passed, confirmed, recordingMetrics(seen));
  await executionSchedulerIngest(service, submissionOf("{"));
  assert.deepEqual(seen, [
    "manifest:Rejected",
    "attemptEnded:Lost:ManifestInvalid",
  ]);
});

test("a sink that fails at every observation settles exactly what a silent one settles", async () => {
  const quiet: string[] = [];
  const loud: string[] = [];
  const thrown: string[] = [];
  const submission = submissionOf(report("Pass"));
  const quietly = await executionSchedulerIngest(
    serviceWith(quiet, passed),
    submission,
  );
  const loudly = await executionSchedulerIngest(
    serviceWith(loud, passed, confirmed, throwingMetrics(thrown)),
    submission,
  );
  assert.ok(thrown.length > 0, "no observation failed, so this proves nothing");
  assert.deepEqual(loudly, quietly);
  assert.deepEqual(loud, quiet);
});

test("a late report for retired work leaves the domain alone", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, { terminalized: "Cancelled" });
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Pass"))),
    { ingested: "Stale" },
  );
  assert.deepEqual(calls, ["terminalize:2:Pass"]);
});

test("a contradictory terminal result raises an incident and settles nothing", async () => {
  const calls: string[] = [];
  const kinds: SchedulerIncidentKind[] = [];
  const service = serviceWith(
    calls,
    { terminalized: "Conflicting", incident: "incident-one" },
    confirmed,
    {
      ...silentExecutionSchedulerMetrics,
      incident: (kind) => kinds.push(kind),
    },
  );
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Fail"))),
    { ingested: "Conflicting", incident: "incident-one" },
  );
  assert.deepEqual(calls, ["terminalize:2:Fail"]);
  assert.deepEqual(kinds, ["ConflictingResult"]);
});

test("every evidence ingestion records is one the closed roster declares", async () => {
  const calls: string[] = [];
  await executionSchedulerIngest(serviceWith(calls, passed), submissionOf("{"));
  await executionSchedulerIngest(
    serviceWith(
      calls,
      passed,
      storageAnswering({
        verified: "Rejected",
        failure: "Missing",
        at: { role: "Handoff", index: 0 },
      }),
    ),
    submissionOf(report("Pass")),
  );
  const recorded = calls.map((call) => call.split(":")[3]);
  assert.ok(
    recorded.length > 0,
    "no evidence was recorded, so this proves nothing",
  );
  for (const evidence of recorded) {
    assert.ok(
      allAttemptEvidence.includes(
        evidence as (typeof allAttemptEvidence)[number],
      ),
      `${String(evidence)} is not a label the bounded evidence column admits`,
    );
  }
});

test("the report the terminal transaction is given carries the manifest that was confirmed", async () => {
  const calls: string[] = [];
  let handed = "";
  const service: ExecutionReportService = {
    ...serviceWith(calls, passed),
    artifacts: {
      verifyManifest: (manifest) => {
        handed = manifest.digest;
        return Promise.resolve({ verified: "Verified" });
      },
    },
    store: {
      ...recordingStore(calls, passed),
      terminalize: (submitted) => {
        assert.equal(submitted.manifest.digest, handed);
        assert.equal(submitted.attempt, asAttemptId("attempt-one"));
        assert.equal(submitted.manifest.binding.attempt, submitted.attempt);
        return Promise.resolve(passed);
      },
    },
  };
  assert.deepEqual(
    await executionSchedulerIngest(service, submissionOf(report("Pass"))),
    { ingested: "Terminalized", outcome: "Passed", operation },
  );
  assert.notEqual(handed, "");
});
