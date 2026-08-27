/**
 * The pure half of preparation: whether one ticket's gathered rows are a
 * candidate's worth of artifacts, what the canonical bytes of an attempt and a
 * bundle are, and the conflict manifest a failed integration is stored as.
 *
 * WHAT THIS TIER CAN DECIDE is every refusal that is a property of the rows.
 * Whether the rows are the right rows is a claim about PostgreSQL and is proved
 * against a real server in `test/postgres/finalizerPreparation.test.ts`; whether
 * the bytes reach a candidate is a claim about a filesystem and about git, and
 * is proved in `test/adapters/artifactStore.test.ts` and
 * `test/adapters/gitPromotion.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import {
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asInputBundleId,
  asRepositoryId,
  candidateBytesMax,
  candidateExecutionsMax,
  candidateFilesMax,
  conflictPathsMax,
  type FinalizationClaim,
} from "../../src/interpreter/finalizer.ts";
import {
  allHandoffRefusals,
  asProjectArtifactId,
  canonicalFinalizationAttempt,
  canonicalInputBundle,
  conflictManifestBytesMax,
  conflictManifestText,
  handoffAccepted,
  handoffSuperseded,
  type AttemptRecord,
  type HandoffArtifact,
  type HandoffGathering,
  type HandoffSource,
  type HandoffWork,
} from "../../src/interpreter/finalizerPreparation.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

/** A digest of the width the constraints admit, distinct by the marker it repeats. */
const digestOf = (marker: string): string => marker.repeat(64).slice(0, 64);

/** A commit of the shorter width git addresses objects at. */
const commitOf = (marker: string): string => marker.repeat(40).slice(0, 40);

/** One project every fixture belongs to. */
const partition = {
  tenant: asTenantId("tenant-prepare"),
  project: asProjectId("project-prepare"),
};

/** One passed work execution of a named spawn, over the configuration a case names. */
function workOf(
  canonical: string,
  marker = "a",
  spawn = "spawn-a",
  task = 1,
): HandoffWork {
  return {
    execution: asExecutionId(`execution-${marker}`),
    attempt: asAttemptId(`attempt-${marker}`),
    spawn,
    task,
    manifest: asResultManifestId(`manifest-${marker}`),
    configuration: { revision: `revision-${marker}`, digest: digestOf(marker) },
    canonical: asCanonicalConfiguration(canonical),
  };
}

/** One declared handoff artifact of the execution a case names. */
function artifactOf(path: string, bytes = 1, marker = "a"): HandoffArtifact {
  return {
    execution: asExecutionId(`execution-${marker}`),
    attempt: asAttemptId(`attempt-${marker}`),
    path: asArtifactPath(path),
    digest: asArtifactDigest(digestOf("b")),
    bytes,
  };
}

function sourceOf(marker: string): HandoffSource {
  return {
    execution: asExecutionId(`execution-${marker}`),
    attempt: asAttemptId(`attempt-${marker}`),
    repository: asRepositoryId("repository-a"),
    ref: asGitRefName(`refs/heads/source-${marker}`),
    commit: asGitObjectId(commitOf(marker)),
    base: asGitObjectId(commitOf("f")),
    expectedBase: asGitObjectId(commitOf("f")),
  };
}

/** The configuration every supersession fixture pins, so no case there turns on the revision. */
const oneConfiguration = '{"image":"i","version":1}';

/** The plainest gathering there is: one passed execution and one artifact. */
const plain: HandoffGathering = {
  work: [workOf(oneConfiguration)],
  artifacts: [artifactOf("one.txt")],
  sources: [],
};

/** One spawn's fan-out of two passed executions, which is where two sources genuinely conflict. */
const fanned: HandoffGathering = {
  work: [
    workOf(oneConfiguration, "a", "spawn-one", 1),
    {
      ...workOf(oneConfiguration, "a", "spawn-one", 2),
      execution: asExecutionId("execution-d"),
      attempt: asAttemptId("attempt-d"),
      manifest: asResultManifestId("manifest-d"),
    },
  ],
  artifacts: [],
  sources: [],
};

/** Three passed spawns of one ticket, latest first, as a reworked ticket's gather hands them over. */
const reworked: HandoffGathering = {
  work: [
    workOf(oneConfiguration, "c", "spawn-three", 5),
    workOf(oneConfiguration, "b", "spawn-two", 3),
    workOf(oneConfiguration, "a", "spawn-one", 1),
  ],
  artifacts: [],
  sources: [sourceOf("c"), sourceOf("b"), sourceOf("a")],
};

test("a rework supersedes the work it re-ran, and the latest spawn alone is prepared", () => {
  const superseded = handoffSuperseded(reworked);
  assert.deepEqual(
    superseded.work.map((each) => each.execution),
    ["execution-c"],
  );
  const accepted = handoffAccepted(superseded);
  if (accepted.accepted !== "Handoff") assert.fail(JSON.stringify(accepted));
  if (accepted.handoff.kind !== "Source") assert.fail("a source handoff");
  assert.equal(accepted.handoff.source.execution, "execution-c");
  assert.deepEqual(accepted.handoff.manifests, ["manifest-c"]);
});

test("a superseded spawn's artifacts are dropped rather than read as a second declaration", () => {
  const accepted = handoffAccepted(
    handoffSuperseded({
      work: [
        workOf(oneConfiguration, "c", "spawn-three", 5),
        workOf(oneConfiguration, "a", "spawn-one", 1),
      ],
      artifacts: [artifactOf("one.txt", 1, "c"), artifactOf("one.txt", 2, "a")],
      sources: [],
    }),
  );
  if (accepted.accepted !== "Handoff") assert.fail(JSON.stringify(accepted));
  if (accepted.handoff.kind !== "Artifacts") assert.fail("an artifact handoff");
  assert.deepEqual(
    accepted.handoff.artifacts.map((each) => each.execution),
    ["execution-c"],
  );
});

test("two sources declared by one spawn are the conflict the refusal was written for", () => {
  const conflicting = { ...fanned, sources: [sourceOf("a"), sourceOf("d")] };
  assert.deepEqual(handoffSuperseded(conflicting), conflicting);
  const accepted = handoffAccepted(handoffSuperseded(conflicting));
  assert.equal(
    accepted.accepted === "Refused" ? accepted.refusal : accepted.accepted,
    "SourceDeclaredTwice",
  );
});

test("a gathering with no passed work at all supersedes nothing", () => {
  const empty: HandoffGathering = { work: [], artifacts: [], sources: [] };
  assert.deepEqual(handoffSuperseded(empty), empty);
});

test("a gathering with one passed execution is a candidate's worth of artifacts", () => {
  const accepted = handoffAccepted(plain);
  if (accepted.accepted !== "Handoff") assert.fail(JSON.stringify(accepted));
  assert.deepEqual(accepted.handoff.manifests, ["manifest-a"]);
  assert.equal(accepted.handoff.approvalRequired, false);
  assert.equal(accepted.handoff.configuration.revision, "revision-a");
});

test("a ticket whose work has no result names no configuration and so is its own answer", () => {
  assert.deepEqual(handoffAccepted({ work: [], artifacts: [], sources: [] }), {
    accepted: "NoPassedWork",
  });
});

test("a passed execution with no handoff at all is still a candidate", () => {
  const accepted = handoffAccepted({
    work: plain.work,
    artifacts: [],
    sources: [],
  });
  if (accepted.accepted !== "Handoff") assert.fail(JSON.stringify(accepted));
  assert.equal(accepted.handoff.kind, "Artifacts");
  if (accepted.handoff.kind !== "Artifacts") assert.fail("artifact handoff");
  assert.deepEqual(accepted.handoff.artifacts, []);
});

test("the approval policy is read off the pinned revision, and an unreadable one is refused", () => {
  const asked = handoffAccepted({
    ...plain,
    work: [workOf('{"finalizationApprovalRequired":true,"image":"i"}')],
  });
  if (asked.accepted !== "Handoff") assert.fail(JSON.stringify(asked));
  assert.equal(asked.handoff.approvalRequired, true);
  const unreadable = handoffAccepted({
    ...plain,
    work: [workOf('{"finalizationApprovalRequired":"yes","image":"i"}')],
  });
  assert.deepEqual(unreadable, {
    accepted: "Refused",
    refusal: "ApprovalPolicyUnreadable",
    configuration: { revision: "revision-a", digest: digestOf("a") },
  });
});

test("every refusal names the revision an attempt must pin, and none of them is a hold", () => {
  const refusals = [
    handoffAccepted({
      work: [workOf('{"image":"i"}', "a"), workOf('{"image":"j"}', "c")],
      artifacts: plain.artifacts,
      sources: [],
    }),
    handoffAccepted({
      ...plain,
      artifacts: [artifactOf(".git/config")],
    }),
    handoffAccepted({
      ...plain,
      artifacts: [artifactOf("one.txt"), artifactOf("one.txt")],
    }),
    handoffAccepted({
      ...plain,
      artifacts: Array.from({ length: candidateFilesMax + 1 }, (_each, index) =>
        artifactOf(`file-${String(index)}.txt`),
      ),
    }),
    handoffAccepted({ ...fanned, sources: [sourceOf("a"), sourceOf("d")] }),
    handoffAccepted({ ...plain, sources: [sourceOf("a")] }),
    handoffAccepted({
      ...plain,
      artifacts: [],
      sources: [
        { ...sourceOf("a"), expectedBase: asGitObjectId(commitOf("e")) },
      ],
    }),
    handoffAccepted({
      ...plain,
      artifacts: [artifactOf("one.txt", candidateBytesMax + 1)],
    }),
    handoffAccepted({
      ...plain,
      work: Array.from({ length: candidateExecutionsMax + 1 }, () =>
        workOf('{"image":"i"}', "a"),
      ),
    }),
  ];
  assert.deepEqual(
    refusals.map((each) =>
      each.accepted === "Refused" ? each.refusal : each.accepted,
    ),
    [
      "ConfigurationDisagrees",
      "PathIsReserved",
      "PathIsDeclaredTwice",
      "TooManyArtifacts",
      "SourceDeclaredTwice",
      "SourceAndArtifactsMixed",
      "SourceBaseDisagrees",
      "TooManyBytes",
      "TooManyExecutions",
    ],
  );
  for (const each of refusals) {
    if (each.accepted !== "Refused") assert.fail(JSON.stringify(each));
    assert.equal(each.configuration.revision, "revision-a");
    assert.equal(allHandoffRefusals.includes(each.refusal), true);
  }
});

/** One claim every canonical-bytes fixture is written against. */
const claim: FinalizationClaim = {
  partition,
  request: "request-a",
  ticket: asTicketId(1),
  authorizingSeq: 1,
  requestGeneration: 1,
  claimGeneration: 1,
  state: "Registered",
  kind: "RunFinalizer",
  recoveryEpoch: asRecoveryEpoch("epoch-a"),
  owner: asFinalizerOwnerId("owner-a"),
};

/** One attempt with everything a preparation pins, before its own digest is taken. */
const record: Omit<AttemptRecord, "attemptDigest"> = {
  claim,
  repository: asRepositoryId("repository-a"),
  attempt: asFinalizationAttemptId("attempt-1"),
  bundle: {
    bundle: asInputBundleId("bundle-1"),
    digest: digestOf("c"),
    references: [{ kind: "Repository", reference: "repository-a" }],
  },
  target: {
    ref: asGitRefName("refs/heads/main"),
    commit: asGitObjectId(commitOf("a")),
  },
  strategy: "Merge",
  configuration: { revision: "revision-a", digest: digestOf("a") },
  approvalRequired: false,
  outcome: "Prepared",
  candidate: asGitObjectId(commitOf("b")),
};

test("an attempt's canonical bytes bind it to the request and to the bundle it pinned", () => {
  const bytes = canonicalFinalizationAttempt(record);
  assert.match(bytes, /chuggy:finalization:v1/u);
  assert.notEqual(
    bytes,
    canonicalFinalizationAttempt({
      ...record,
      claim: { ...claim, request: "request-b" },
    }),
  );
  assert.notEqual(
    bytes,
    canonicalFinalizationAttempt({
      ...record,
      bundle: { ...record.bundle, digest: digestOf("d") },
    }),
  );
  assert.equal(bytes, canonicalFinalizationAttempt({ ...record }));
});

test("no opaque value can spell out a boundary in a bundle's canonical bytes", () => {
  const spelling = canonicalInputBundle(partition, asInputBundleId("b"), [
    { kind: "Repository", reference: "one:two" },
  ]);
  const other = canonicalInputBundle(partition, asInputBundleId("b"), [
    { kind: "Repository", reference: "one" },
    { kind: "ConfigurationRevision", reference: "two" },
  ]);
  assert.notEqual(spelling, other);
});

test("a conflict manifest carries the candidate, the target and the merge base it was read against", () => {
  const text = conflictManifestText({
    request: "request-a",
    attempt: asFinalizationAttemptId("attempt-1"),
    strategy: "Merge",
    candidate: asGitObjectId(commitOf("b")),
    target: record.target,
    base: asGitObjectId(commitOf("c")),
    conflict: { paths: ["one.txt"], truncated: false },
  });
  assert.deepEqual(JSON.parse(text), {
    version: 1,
    request: "request-a",
    attempt: "attempt-1",
    strategy: "Merge",
    candidate: commitOf("b"),
    targetRef: "refs/heads/main",
    targetCommit: commitOf("a"),
    mergeBase: commitOf("c"),
    conflictingPaths: ["one.txt"],
    truncated: false,
  });
});

test("a conflict too large to store drops paths rather than growing without a bound", () => {
  const long = "p".repeat(4_096);
  const text = conflictManifestText({
    request: "request-a",
    attempt: asFinalizationAttemptId("attempt-1"),
    strategy: "Merge",
    candidate: asGitObjectId(commitOf("b")),
    target: record.target,
    conflict: {
      paths: Array.from({ length: conflictPathsMax }, () => long),
      truncated: true,
    },
  });
  const held = JSON.parse(text) as {
    conflictingPaths: string[];
    truncated: boolean;
    mergeBase: null;
  };
  assert.equal(held.truncated, true);
  assert.equal(held.mergeBase, null);
  assert.equal(held.conflictingPaths.length < conflictPathsMax, true);
  assert.equal(text.length <= conflictManifestBytesMax * 2, true);
});

test("the ceiling counts the bytes the artifact is stored as and not its characters", () => {
  const wide = "\u{1f600}".repeat(1_024);
  const declared = Math.floor(conflictManifestBytesMax / wide.length);
  const held = JSON.parse(
    conflictManifestText({
      request: "request-a",
      attempt: asFinalizationAttemptId("attempt-1"),
      strategy: "Merge",
      candidate: asGitObjectId(commitOf("b")),
      target: record.target,
      conflict: {
        paths: Array.from({ length: declared }, () => wide),
        truncated: false,
      },
    }),
  ) as { conflictingPaths: string[]; truncated: boolean };
  assert.equal(held.truncated, true);
  assert.equal(held.conflictingPaths.length < declared, true);
});

test("a project artifact identity is refused what any other opaque identity is", () => {
  assert.throws(() => asProjectArtifactId(""), RangeError);
  assert.throws(() => asProjectArtifactId("a".repeat(257)), RangeError);
  assert.equal(asProjectArtifactId("conflict-1"), "conflict-1");
});
