import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  checkedDraftPageQuery,
  configurationRevisionSummary,
  draftPageLimitDefault,
  draftInitializationPolicy,
  draftReleaseReadiness,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  releaseConfigurationReadiness,
} from "../../src/interpreter/authoring.ts";
import { asBriefCheckLine } from "../../src/interpreter/ticketBrief.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { approvalRequiredField } from "../../src/interpreter/finalizerPreparation.ts";
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
    prog: [{ key: 1, evaluators: [{ key: refinementInstance.nTasks }] }],
  });
  assert.deepEqual(policy.choices, {
    programStagesMax: refinementInstance.maxStages,
    evaluatorsMax: refinementInstance.nTasks,
  });
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
      { key: 1, evaluators: [{ key: 1 }] },
      { key: 2, evaluators: [{ key: 1 }] },
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
  assert.deepEqual(
    releaseConfigurationReadiness(
      canonicalConfigurationOf({
        ...parsed,
        work: { commands: [".chug/tasks/ci.sh"] },
      }),
      appending,
    ),
    { readiness: "Incomplete", fault: "BriefChecksUncommanded" },
    "a commanded work stage is not a stage a ticket's check lines may join",
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
  const uncommanded = {
    readiness: "Incomplete",
    fault: "BriefChecksUncommanded",
  };
  assert.deepEqual(
    draftReleaseReadiness(
      readyConfiguration,
      { checks: [asBriefCheckLine("npm test")] },
      undefined,
    ),
    uncommanded,
    "before a brief that names no repository",
  );
  assert.deepEqual(
    draftReleaseReadiness(
      readyConfiguration,
      { checks: [asBriefCheckLine("npm test")], repository: firstRepository },
      secondRepository,
    ),
    uncommanded,
    "and before a configuration read in another repository",
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
      finalization: { approvalRequired: false },
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
  const commanded = configurationRevisionSummary({
    ...base,
    canonical: canonicalConfigurationOf({
      ...JSON.parse(readyConfiguration),
      work: { commands: [".chug/tasks/ci.sh"] },
    }),
  });
  assert.equal(
    commanded.readiness === "Ready" ? commanded.workInstructionsCount : -1,
    0,
    "a work stage that briefs nobody is summarised rather than read for instructions",
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
    finalization: { approvalRequired: true },
    evaluationStagesCount: 0,
  });
  assert.deepEqual(summaryOf({ [approvalRequiredField]: false }), {
    finalization: { approvalRequired: false },
    evaluationStagesCount: 0,
  });
  assert.deepEqual(
    summaryOf({}),
    {
      finalization: { approvalRequired: false },
      evaluationStagesCount: 0,
    },
    "a revision saying nothing about approval asks for none",
  );
  assert.deepEqual(
    summaryOf({ [approvalRequiredField]: "yes" }),
    {
      finalization: { approvalRequired: true },
      evaluationStagesCount: 0,
    },
    "a policy this tree cannot read is a person in the way",
  );
  assert.deepEqual(
    summaryOf({
      evaluations: [
        { purpose: "Review", instructions: ["Review it."], practices: [] },
        { purpose: "Check", checks: [".chug/tasks/ci.sh"] },
      ],
    }),
    {
      finalization: { approvalRequired: false },
      evaluationStagesCount: 2,
    },
  );
});

test("a raw CreateTicket is not a public Decide command", () => {
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
