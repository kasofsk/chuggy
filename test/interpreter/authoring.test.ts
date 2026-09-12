import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  checkedDraftLanding,
  checkedDraftPageQuery,
  configurationRevisionSummary,
  draftPageLimitDefault,
  draftInitializationPolicy,
  draftReleaseReadiness,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  releaseConfigurationReadiness,
} from "../../src/interpreter/authoring.ts";
import {
  asBriefBranch,
  asBriefCheckLine,
  asBriefIntent,
} from "../../src/interpreter/ticketBrief.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { approvalRequiredField } from "../../src/interpreter/finalizerPreparation.ts";
import { handoffConfigurationField } from "../../src/interpreter/handoffConfiguration.ts";
import { handoffFixture } from "./handoffFixture.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { nativeHttpPageItemsMax } from "../../src/contract/http.ts";
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
    reworkPolicy: refinementInstance.reworkPolicy,
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    finalizer: "ManagedFinalizer",
  });
  assert.ok(policy.choices.workFanouts.includes(1));
  assert.deepEqual(
    policy.choices.reworkPolicies.at(-1),
    policy.defaults.reworkPolicy,
  );
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

test("a present invalid worker mode is not interpreted as a legacy worker", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  assert.deepEqual(
    releaseConfigurationReadiness(
      canonicalConfigurationOf({
        ...parsed,
        worker: {
          mode: { type: "Unknown" },
          arguments: [],
          setup: [],
          files: [],
        },
      }),
    ),
    { readiness: "Incomplete", fault: "WorkerInvalid" },
  );
});

test("a configuration that hands off refuses a brief that would propose a change", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  const handing = canonicalConfigurationOf({
    ...parsed,
    finalizationHandoff: handoffFixture(),
  });
  assert.deepEqual(
    releaseConfigurationReadiness(handing, {
      checks: [],
      finalization: {
        mode: "PullRequest",
        target: asBriefBranch("refs/heads/rt/landing"),
      },
    }),
    { readiness: "Incomplete", fault: "HandoffProposesChange" },
  );
  assert.equal(
    releaseConfigurationReadiness(handing, {
      checks: [],
      finalization: { mode: "Push" },
    }).readiness,
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
      checks: [],
      finalization: {
        mode: "PullRequest",
        target: asBriefBranch("refs/heads/rt/landing"),
      },
    }).readiness,
    "Ready",
    "a configuration that hands nothing off is proposed against freely",
  );
});

test("a configuration commanding no check stage refuses a brief that appends check lines", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  const commanding = canonicalConfigurationOf({
    ...parsed,
    evaluations: [
      { purpose: "Review", instructions: ["Review it."], practices: [] },
      { purpose: "Check", checks: [".chug/tasks/ci.sh"] },
    ],
  });
  const appending = { checks: [asBriefCheckLine("npm test")] };
  assert.deepEqual(
    releaseConfigurationReadiness(readyConfiguration, appending),
    { readiness: "Incomplete", fault: "BriefChecksUncommanded" },
  );
  assert.equal(
    releaseConfigurationReadiness(commanding, appending).readiness,
    "Ready",
    "a configuration commanding a check stage takes the lines",
  );
  assert.equal(
    releaseConfigurationReadiness(readyConfiguration, { checks: [] }).readiness,
    "Ready",
    "a brief appending nothing is released against either",
  );
  assert.equal(
    releaseConfigurationReadiness(
      canonicalConfigurationOf({
        ...parsed,
        evaluations: [
          { purpose: "Check", instructions: ["Run it."], practices: [] },
        ],
      }),
      appending,
    ).readiness,
    "Incomplete",
    "a check stage that briefs an agent commands nothing for a ticket to join",
  );
});

const firstRepository = asRepositoryId("repository-one");
const secondRepository = asRepositoryId("repository-two");

test("a release refuses a brief that names no repository at all", () => {
  assert.deepEqual(
    draftReleaseReadiness(
      readyConfiguration,
      { checks: [], repository: firstRepository },
      undefined,
    ).readiness,
    "Ready",
  );
  assert.deepEqual(
    draftReleaseReadiness(readyConfiguration, { checks: [] }, undefined),
    { readiness: "Incomplete", fault: "BriefNamesNoRepository" },
  );
  assert.deepEqual(
    draftReleaseReadiness(readyConfiguration, undefined, undefined),
    { readiness: "Incomplete", fault: "BriefNamesNoRepository" },
    "a draft written before briefs existed names none either",
  );
});

test("a release refuses a configuration imported from another repository", () => {
  assert.deepEqual(
    draftReleaseReadiness(
      readyConfiguration,
      { checks: [], repository: firstRepository },
      secondRepository,
    ),
    { readiness: "Incomplete", fault: "ConfigurationFromAnotherRepository" },
  );
  for (const repository of [firstRepository, secondRepository]) {
    assert.equal(
      draftReleaseReadiness(
        readyConfiguration,
        { checks: [], repository },
        repository,
      ).readiness,
      "Ready",
      "an imported configuration releases from the repository it was read in",
    );
    assert.equal(
      draftReleaseReadiness(
        readyConfiguration,
        { checks: [], repository },
        undefined,
      ).readiness,
      "Ready",
      "and an authored one releases from either binding, privileging neither",
    );
  }
});

test("the configuration's own refusals are answered before the repository's", () => {
  const parsed = JSON.parse(readyConfiguration) as Record<string, unknown>;
  assert.deepEqual(
    draftReleaseReadiness(
      canonicalConfigurationOf({
        ...parsed,
        finalizationHandoff: handoffFixture(),
      }),
      {
        checks: [],
        finalization: {
          mode: "PullRequest",
          target: asBriefBranch("refs/heads/rt/landing"),
        },
      },
      secondRepository,
    ),
    { readiness: "Incomplete", fault: "HandoffProposesChange" },
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
      finalization: { approvalRequired: false, handoff: "None" },
      evaluationStagesCount: 0,
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

/** The ready document with whichever of its fields a finalization case varies. */
function summaryOf(fields: Record<string, unknown>) {
  const summary = configurationRevisionSummary({
    revision: asConfigurationRevisionId("revision"),
    digest: "digest",
    createdAt: asPublicInstant("2026-08-24T12:00:00Z"),
    provenance: { source: "Authored" },
    canonical: canonicalConfigurationOf({
      ...JSON.parse(readyConfiguration),
      ...fields,
    }),
  });
  return summary.readiness === "Ready"
    ? {
        finalization: summary.finalization,
        evaluationStagesCount: summary.evaluationStagesCount,
      }
    : summary.readiness;
}

/**
 * What a page says about finishing one revision. An approval policy this tree
 * cannot read is answered as an approval, because that is what the finalizer
 * does with it: a candidate under one is refused rather than promoted.
 */
test("a summary answers what its revision decides about finishing and evaluating", () => {
  assert.deepEqual(summaryOf({ [approvalRequiredField]: true }), {
    finalization: { approvalRequired: true, handoff: "None" },
    evaluationStagesCount: 0,
  });
  assert.deepEqual(summaryOf({ [approvalRequiredField]: false }), {
    finalization: { approvalRequired: false, handoff: "None" },
    evaluationStagesCount: 0,
  });
  assert.deepEqual(
    summaryOf({}),
    {
      finalization: { approvalRequired: false, handoff: "None" },
      evaluationStagesCount: 0,
    },
    "a revision saying nothing about approval asks for none",
  );
  assert.deepEqual(
    summaryOf({ [approvalRequiredField]: "yes" }),
    {
      finalization: { approvalRequired: true, handoff: "None" },
      evaluationStagesCount: 0,
    },
    "a policy this tree cannot read is a person in the way",
  );
  assert.deepEqual(
    summaryOf({ [handoffConfigurationField]: handoffFixture() }),
    {
      finalization: { approvalRequired: false, handoff: "DirectCommit" },
      evaluationStagesCount: 0,
    },
  );
  assert.deepEqual(
    summaryOf({
      evaluations: [
        { purpose: "Review", instructions: ["Review it."], practices: [] },
        { purpose: "Check", checks: [".chug/tasks/ci.sh"] },
      ],
    }),
    {
      finalization: { approvalRequired: false, handoff: "None" },
      evaluationStagesCount: 2,
    },
  );
});

/**
 * A ticket authored to run no finalizer has nowhere to land, so a landing on
 * its brief is a pair the store must never hold — whichever door the caller
 * reached it by.
 */
test("a ticket that runs no finalizer is refused a brief that lands somewhere", () => {
  const landing = {
    intent: asBriefIntent("Land it."),
    links: [],
    checks: [],
    finalization: { mode: "Push" },
  } as const;
  assert.throws(() => {
    checkedDraftLanding({
      authoring: { ...plainAuthoring, finalizer: "NoFinalizer" },
      brief: landing,
    });
  }, /lands nothing/u);
  checkedDraftLanding({
    authoring: { ...plainAuthoring, finalizer: "NoFinalizer" },
    brief: { intent: asBriefIntent("Land it."), links: [], checks: [] },
  });
  checkedDraftLanding({ authoring: plainAuthoring, brief: landing });
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

test("a draft page is refused outside the wire's own page bound", () => {
  const cursor = asTicketId(4);
  assert.deepEqual(checkedDraftPageQuery({ limit: 1 }), { limit: 1 });
  assert.deepEqual(
    checkedDraftPageQuery({ cursor, limit: draftPageLimitDefault }),
    {
      cursor,
      limit: draftPageLimitDefault,
    },
  );
  assert.deepEqual(checkedDraftPageQuery({ limit: nativeHttpPageItemsMax }), {
    limit: nativeHttpPageItemsMax,
  });
  for (const limit of [0, -1, 1.5, nativeHttpPageItemsMax + 1])
    assert.throws(() => checkedDraftPageQuery({ limit }), RangeError);
  assert.ok(draftPageLimitDefault <= nativeHttpPageItemsMax);
});
