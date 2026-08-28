import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  configurationRevisionSummary,
  draftInitializationPolicy,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  releaseConfigurationReadiness,
} from "../../src/interpreter/authoring.ts";
import { asBriefBranch } from "../../src/interpreter/ticketBrief.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  encodeTicketCommand,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";

const readyConfiguration = asCanonicalConfiguration(
  '{"brief":{"acceptanceCriteria":["It works."],"constraints":[],"motivation":["It matters."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
);

test("draft authoring round-trips through the generated domain codec", () => {
  assert.deepEqual(
    parseDraftAuthoring(encodeDraftAuthoring(plainAuthoring)),
    plainAuthoring,
  );
});

test("draft initialization exposes deployment choices with server defaults", () => {
  const policy = draftInitializationPolicy(refinementInstance);
  assert.deepEqual(policy.defaults, {
    deps: new Set(),
    prog: [{ fanout: refinementInstance.nTasks, combinator: "UnanimousPass" }],
    workFanout: 1,
    reworkPolicy: { type: "BudgetedRework", value: 0 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    finalizer: "ManagedFinalizer",
  });
  assert.ok(policy.choices.workFanouts.includes(1));
  assert.ok(policy.choices.reworkPolicies.some((choice) => choice.value === 0));
  assert.ok(policy.choices.finalizers.includes("ManagedFinalizer"));
});

test("stage-specific configuration bounds the authored evaluation program", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf({
      ...parsed,
      evaluations: [
        { instructions: ["Review."], practices: [] },
        { instructions: ["Test."], practices: [] },
      ],
    }),
  );
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready") return;
  assert.equal(
    draftInitializationPolicy(
      { ...refinementInstance, maxStages: 4 },
      readiness.configuration,
    ).choices.programStagesMax,
    2,
  );
  assert.deepEqual(
    draftInitializationPolicy(
      { ...refinementInstance, maxStages: 4 },
      readiness.configuration,
    ).defaults.prog,
    [
      { fanout: 1, combinator: "UnanimousPass" },
      { fanout: 1, combinator: "UnanimousPass" },
    ],
  );
});

test("configuration must be canonical, bounded, and secret-free", () => {
  assert.equal(
    asCanonicalConfiguration('{"image":"worker:v1","limits":{"cpu":2}}'),
    '{"image":"worker:v1","limits":{"cpu":2}}',
  );
  assert.throws(
    () => asCanonicalConfiguration('{"limits":{},"image":"worker:v1"}'),
    /canonically encoded/,
  );
  assert.throws(
    () => asCanonicalConfiguration('{"apiToken":"value"}'),
    /secret-bearing/,
  );
  assert.equal(
    asCanonicalConfiguration('{"authority":{"credentials":["workspace"]}}'),
    '{"authority":{"credentials":["workspace"]}}',
  );
  assert.throws(
    () => asCanonicalConfiguration('{"credentialValue":"value"}'),
    /secret-bearing/,
  );
  assert.throws(() => asCanonicalConfiguration("not-json"), SyntaxError);
});

test("release readiness is stricter than structurally valid draft configuration", () => {
  assert.deepEqual(
    releaseConfigurationReadiness(asCanonicalConfiguration("{}")),
    {
      readiness: "Incomplete",
      fault: "ReleaseShapeInvalid",
    },
  );
  assert.equal(
    releaseConfigurationReadiness(readyConfiguration).readiness,
    "Ready",
  );
  assert.deepEqual(
    releaseConfigurationReadiness(
      asCanonicalConfiguration('{"image":"worker:v1","version":1}'),
    ),
    { readiness: "Incomplete", fault: "BriefingShapeMissing" },
  );
});

test("a configuration that hands off refuses a brief that would propose a change", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  const handing = canonicalConfigurationOf({
    ...parsed,
    finalizationHandoff: {
      version: 1,
      mode: "DirectCommit",
      repositories: {
        work: {
          repository: "ledger-engine",
          targetRef: "refs/heads/release",
        },
        handoff: {
          repository: "platform-desires",
          targetRef: "refs/heads/team-orange",
        },
      },
      credentials: {
        work: "ledger-release-writer",
        handoff: "platform-request-writer",
      },
      renderer: {
        identity: "ContainerBuildRequest",
        version: 1,
        parameters: {
          targetImageRepository: "registry.example/ledger",
          builderProfile: "rootless-multiarch",
          platforms: ["linux/amd64"],
        },
      },
      destinationPath: "builds/ledger/request.json",
      outputBytesMax: 4096,
    },
  });
  assert.deepEqual(
    releaseConfigurationReadiness(handing, {
      mode: "PullRequest",
      target: asBriefBranch("refs/heads/rt/landing"),
    }),
    { readiness: "Incomplete", fault: "HandoffProposesChange" },
  );
  assert.equal(
    releaseConfigurationReadiness(handing, { mode: "Push" }).readiness,
    "Ready",
    "the same configuration releases under every other mode",
  );
  assert.equal(
    releaseConfigurationReadiness(handing).readiness,
    "Ready",
    "and for a caller with no brief to read",
  );
  assert.equal(
    releaseConfigurationReadiness(readyConfiguration, {
      mode: "PullRequest",
      target: asBriefBranch("refs/heads/rt/landing"),
    }).readiness,
    "Ready",
    "a configuration that hands nothing off is proposed against freely",
  );
});

test("release readiness names briefing and practice refusals", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  assert.deepEqual(
    releaseConfigurationReadiness(
      asCanonicalConfiguration(
        JSON.stringify({
          ...parsed,
          brief: { acceptanceCriteria: [], constraints: [], motivation: [] },
        }),
      ),
    ),
    { readiness: "Incomplete", fault: "EmptyBrief" },
  );
  for (const [practices, fault] of [
    [["Nonsense"], "UnknownPractice"],
    [["AcceptanceCriteria", "AcceptanceCriteria"], "DuplicatePractice"],
  ] as const) {
    assert.deepEqual(
      releaseConfigurationReadiness(
        asCanonicalConfiguration(JSON.stringify({ ...parsed, practices })),
      ),
      { readiness: "Incomplete", fault },
    );
  }
});

test("configuration summaries expose registry fields without canonical content", () => {
  const base = {
    revision: asConfigurationRevisionId("revision"),
    digest: "digest",
    createdAt: asPublicInstant("2026-08-24T12:00:00Z"),
    provenance: { source: "Authored" } as const,
  };
  assert.deepEqual(
    configurationRevisionSummary({ ...base, canonical: readyConfiguration }),
    {
      ...base,
      readiness: "Ready",
      image: "worker:v1",
      practices: [],
      workInstructionsCount: 0,
      reviewInstructionsCount: 0,
    },
  );
  assert.deepEqual(
    configurationRevisionSummary({
      ...base,
      canonical: asCanonicalConfiguration("{}"),
    }),
    { ...base, readiness: "Incomplete" },
  );
});

test("a raw ReleaseTicket is not a public Decide command", () => {
  const raw = `{"version":1,"command":"Decide","event":${encodeDraftAuthoring(plainAuthoring)}}`;
  assert.equal(parseTicketCommand(raw).parsed, "Refused");
});

test("ReleaseDraft round-trips as a revision-fenced public command", () => {
  const command = {
    version: 1 as const,
    command: "ReleaseDraft" as const,
    ticket: asTicketId(7),
    authoringVersion: 3,
    configurationRevision: asConfigurationRevisionId("config-3"),
  };
  assert.deepEqual(parseTicketCommand(encodeTicketCommand(command)), {
    parsed: "Ok",
    value: command,
  });
});
