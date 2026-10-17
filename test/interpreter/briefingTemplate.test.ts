/**
 * The authored template wording, held to the revision it says it is.
 *
 * WHAT THIS TIER CAN DECIDE about wording nothing derives is that it has not
 * moved silently. The case below digests every string the template states and
 * pins that digest beside `briefingTemplateVersion`, so an edit to any of them
 * fails here until the version moves with it and the pin is rewritten in the
 * same change. Without it the version is a number a reader has to trust, which
 * is the control that reports success and is never checked again.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  allBriefingCarriers,
  allTaskPurposes,
  briefingFailedLandingLines,
  briefingHeading,
  briefingLabels,
  briefingRequiredResult,
  briefingReworkPreface,
  briefingRoleInstructions,
  briefingSectionOrder,
  briefingTemplateSections,
  briefingTemplateVersion,
  briefingDependencyLines,
  briefingDependencyName,
  briefingDependencyPreface,
  briefingDependencyReportLine,
  briefingDependencyReportUncarried,
  type FailedLanding,
} from "../../src/interpreter/briefingTemplate.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  DependencyChange,
  DependencyDelivery,
  DependencyProposal,
} from "../../src/interpreter/dependencyDelivery.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { allChangeProposalStatuses } from "../../src/interpreter/changeProposal.ts";

/** Every shape a failed landing is told in, its commits fixed so only the wording moves the digest. */
const failedLandings: readonly FailedLanding[] = [true, false].flatMap(
  (conflicted) => [
    { targetCommit: "1".repeat(40), changeCommit: "2".repeat(40), conflicted },
    { targetCommit: "1".repeat(40), conflicted },
  ],
);

/** A pull request in every shape a dependency's is told in, its fields fixed so only the wording moves the digest. */
const dependencyProposals: readonly DependencyProposal[] = [
  {
    headRef: "refs/heads/head",
    headCommit: asGitObjectId("3".repeat(40)),
    baseRef: "main",
  },
  ...allChangeProposalStatuses.map((status) => ({
    url: "https://github.com/owner/repository/pull/1",
    headRef: "refs/heads/head",
    headCommit: asGitObjectId("3".repeat(40)),
    baseRef: "main",
    status,
  })),
  {
    url: `https://github.com/${"x".repeat(512)}`,
    headRef: "refs/heads/head",
    headCommit: asGitObjectId("3".repeat(40)),
    baseRef: "main",
    mergedHead: asGitObjectId("4".repeat(40)),
  },
];

/** Every shape a dependency's change is told in. */
const dependencyChanges: readonly DependencyChange[] = [
  { change: "Landed", commit: asGitObjectId("5".repeat(40)), ref: "main" },
  ...dependencyProposals.flatMap((proposal): DependencyChange[] => [
    {
      change: "Landed",
      commit: asGitObjectId("5".repeat(40)),
      ref: "main",
      proposal,
    },
    { change: "Proposed", proposal },
  ]),
  {
    change: "Committed",
    commit: asGitObjectId("6".repeat(40)),
    ref: asGitRefName("refs/heads/work"),
  },
  { change: "Committed", commit: asGitObjectId("6".repeat(40)) },
  { change: "Unsourced" },
];

/** Every shape a dependency is told in: each change, each standing of its repository and each history. */
const dependencyDeliveries: readonly (readonly [
  DependencyDelivery,
  boolean,
])[] = [
  ...dependencyChanges.map(
    (change) => [{ dependency: asTicketId(7), change }, false] as const,
  ),
  ...[true, false].flatMap((own) =>
    [true, false].map(
      (readable) =>
        [
          {
            dependency: asTicketId(7),
            repository: {
              repository: asRepositoryId("owner/repository"),
              own,
            },
            change: { change: "Unsourced" },
          },
          readable,
        ] as const,
    ),
  ),
  ...(["Ancestor", "NotAncestor", "Unknown"] as const).flatMap((ancestry) =>
    [true, false].map(
      (startsAtBegan) =>
        [
          {
            dependency: asTicketId(7),
            change: { change: "Unsourced" },
            history: {
              commit: asGitObjectId("7".repeat(40)),
              began: asGitObjectId("8".repeat(40)),
              startsAtBegan,
              ancestry,
            },
          },
          false,
        ] as const,
    ),
  ),
];

/** Every line the dependencies' section can say, in the order the shapes above are listed. */
function dependencyWording(): readonly string[] {
  return [
    briefingDependencyPreface,
    briefingDependencyReportUncarried,
    briefingDependencyReportLine("report"),
    briefingDependencyName({
      dependency: asTicketId(7),
      change: { change: "Unsourced" },
    }),
    briefingDependencyName({
      dependency: asTicketId(7),
      title: "title",
      change: { change: "Unsourced" },
    }),
    ...dependencyDeliveries.flatMap(([delivery, readable]) =>
      briefingDependencyLines(delivery, readable),
    ),
  ];
}

/** Every string the template states, in an order this file fixes rather than reads. */
function templateWording(): readonly string[] {
  const wording: string[] = [
    ...briefingSectionOrder,
    ...briefingTemplateSections,
    ...briefingReworkPreface,
    ...failedLandings.flatMap(briefingFailedLandingLines),
    ...dependencyWording(),
  ];
  for (const [label, text] of Object.entries(briefingLabels).sort()) {
    wording.push(label, text);
  }
  for (const purpose of allTaskPurposes) {
    wording.push(purpose);
    for (const carrier of allBriefingCarriers) {
      wording.push(carrier);
      for (const section of briefingSectionOrder) {
        wording.push(briefingHeading(section, purpose, carrier));
      }
      wording.push(
        ...briefingRoleInstructions(purpose, carrier),
        ...briefingRequiredResult(purpose, carrier),
      );
    }
  }
  return wording;
}

/** The wording as one value, length-prefixed so no string can spell out a boundary. */
function templateDigest(): string {
  const canonical = templateWording()
    .map((part) => `${String(part.length)}:${part}`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

test("the template version moves with the wording it names", () => {
  assert.deepEqual(
    [briefingTemplateVersion, templateDigest()],
    [11, "c419f95a23ef8fb7797f09430f046f417f8f62121c6bbcda155d0fdbdfd84275"],
    "the template wording changed: move briefingTemplateVersion and repin this digest",
  );
});

test("the digest reads every string the template states", () => {
  const wording = templateWording();
  for (const purpose of allTaskPurposes) {
    for (const carrier of allBriefingCarriers) {
      for (const line of [
        ...briefingRoleInstructions(purpose, carrier),
        ...briefingRequiredResult(purpose, carrier),
      ]) {
        assert.ok(wording.includes(line), `${line} is outside the pin`);
      }
      for (const section of briefingSectionOrder) {
        assert.ok(
          wording.includes(briefingHeading(section, purpose, carrier)),
          `${section} has a heading outside the pin`,
        );
      }
    }
  }
  for (const text of [
    ...Object.values(briefingLabels),
    ...briefingReworkPreface,
    ...failedLandings.flatMap(briefingFailedLandingLines),
    ...dependencyWording(),
  ]) {
    assert.ok(wording.includes(text), `${text} is outside the pin`);
  }
});
