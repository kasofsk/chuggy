import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type AncestryProved,
  type CandidateIntegrated,
  type CandidatePromoted,
  type TargetObserved,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  ticketGitMergeRun,
  type TicketGitMerge,
} from "../../src/interpreter/ticketGitMerge.ts";

const repository = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository: asRepositoryId("https://github.com/example/repository"),
  recoveryEpoch: asRecoveryEpoch("epoch"),
};
const targetRef = asGitRefName("refs/heads/main");
const held = asGitObjectId("a".repeat(40));
const candidate = asGitObjectId("b".repeat(40));
const merged = asGitObjectId("d".repeat(40));
const observed: TargetObserved = {
  observed: "Target",
  target: { ref: targetRef, commit: held },
};
const ancestor: AncestryProved = { proved: "Ancestor", observed: held };
const stranger: AncestryProved = { proved: "NotAncestor", observed: held };
const integrated: CandidateIntegrated = {
  integrated: "Candidate",
  candidate: merged,
};

interface GitAnswers {
  readonly proofs: readonly AncestryProved[];
  readonly target?: TargetObserved;
  readonly integrated?: CandidateIntegrated;
  readonly promoted?: CandidatePromoted;
}

function merge(answers: GitAnswers): TicketGitMerge {
  const proofs = [...answers.proofs];
  const unreachable = (): never => {
    throw new Error("the merge asked for a step this answer set does not take");
  };
  return {
    repository,
    targetRef,
    candidate,
    permit: "permit" as never,
    git: {
      observeTarget: () => Promise.resolve(answers.target ?? unreachable()),
      prepareCandidate: unreachable,
      prepareSource: unreachable,
      integrateCandidate: () =>
        Promise.resolve(answers.integrated ?? unreachable()),
      promoteCandidate: () =>
        Promise.resolve(answers.promoted ?? unreachable()),
      proveCandidateAncestry: () =>
        Promise.resolve(proofs.shift() ?? unreachable()),
    },
  };
}

test("a target that already holds the work asks git for nothing more", async () => {
  assert.deepEqual(await ticketGitMergeRun(merge({ proofs: [ancestor] })), {
    settled: "Outcome",
    outcome: "Succeeded",
    evidence: { landed: "Held", commit: candidate },
  });
});

test("the merge advances the target ref to what it integrated", async () => {
  assert.deepEqual(
    await ticketGitMergeRun(
      merge({
        proofs: [stranger],
        target: observed,
        integrated,
        promoted: { promoted: "Advanced" },
      }),
    ),
    {
      settled: "Outcome",
      outcome: "Succeeded",
      evidence: { landed: "Merged", commit: merged },
    },
  );
});

test("a conflict is the ticket's to answer, and names the paths it is over", async () => {
  const conflict = { paths: ["one.ts"], truncated: false };
  assert.deepEqual(
    await ticketGitMergeRun(
      merge({
        proofs: [stranger],
        target: observed,
        integrated: { integrated: "Conflicted", conflict },
      }),
    ),
    {
      settled: "Outcome",
      outcome: "NeedsWork",
      evidence: { landed: "Conflicted", conflict },
    },
  );
});

test("an unheard promotion is proved against the target rather than repeated", async () => {
  for (const [proof, settled] of [
    [ancestor, "Outcome"],
    [stranger, "Unsettled"],
  ] as const) {
    const run = await ticketGitMergeRun(
      merge({
        proofs: [stranger, proof],
        target: observed,
        integrated,
        promoted: { promoted: "Ambiguous", evidence: "PromotionTimedOut" },
      }),
    );
    assert.equal(run.settled, settled);
  }
});

test("a target that moved or could not be read settles nothing", async () => {
  const rejected = await ticketGitMergeRun(
    merge({
      proofs: [stranger],
      target: observed,
      integrated,
      promoted: { promoted: "Rejected", observed: merged },
    }),
  );
  assert.equal(rejected.settled, "Unsettled");
  const unreadable = await ticketGitMergeRun(
    merge({
      proofs: [{ proved: "Unreadable", evidence: "RefUnreadable" }],
      target: { observed: "Unreadable", evidence: "RefUnreadable" },
    }),
  );
  assert.equal(unreadable.settled, "Unsettled");
});
