/**
 * Where a ticket's finalization lands, as its brief and its binding name it,
 * and the ref its work task merges from that.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitRefName,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  finalizerLandingBaseRef,
  finalizerLandingOf,
  finalizerRemoteDefaultRef,
} from "../../src/interpreter/finalizerLanding.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";

const binding: RepositoryBinding = {
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  repository: asRepositoryId("repository"),
  recoveryEpoch: asRecoveryEpoch("epoch"),
};

const boundToMain: RepositoryBinding = {
  ...binding,
  targetRef: asGitRefName("refs/heads/main"),
};

const intent = { intent: "Land the change.", links: [] };

test("a push's work task merges the reference its finalization names, before the brief's branch and the binding's", () => {
  const brief = asDraftBrief({
    ...intent,
    branch: "refs/heads/work",
    finalization: { mode: "Push", target: "refs/heads/release" },
  });
  assert.equal(
    finalizerLandingBaseRef(brief, boundToMain),
    "refs/heads/release",
  );
});

test("a push naming no reference merges the brief's branch, before the binding's", () => {
  const brief = asDraftBrief({
    ...intent,
    branch: "refs/heads/work",
    finalization: { mode: "Push" },
  });
  assert.equal(finalizerLandingBaseRef(brief, boundToMain), "refs/heads/work");
  assert.equal(
    finalizerLandingBaseRef(
      asDraftBrief({ ...intent, branch: "refs/heads/work" }),
      binding,
    ),
    "refs/heads/work",
  );
});

test("a brief naming neither merges the binding's reference", () => {
  assert.equal(
    finalizerLandingBaseRef(asDraftBrief(intent), boundToMain),
    "refs/heads/main",
  );
  assert.equal(
    finalizerLandingBaseRef(undefined, boundToMain),
    "refs/heads/main",
  );
});

test("a ticket that lands on no ref its brief or binding names merges none", () => {
  assert.equal(
    finalizerLandingBaseRef(
      asDraftBrief({ ...intent, finalization: { mode: "None" } }),
      boundToMain,
    ),
    undefined,
  );
  assert.equal(
    finalizerLandingBaseRef(
      asDraftBrief({ ...intent, branch: "refs/heads/work" }),
      undefined,
    ),
    undefined,
  );
  assert.equal(
    finalizerLandingBaseRef(asDraftBrief(intent), binding),
    undefined,
  );
});

test("where the ticket lands is read in the finalizer's order: `None` before an absent binding, and an absent binding before a proposal naming no branch", () => {
  const none = asDraftBrief({ ...intent, finalization: { mode: "None" } });
  assert.deepEqual(finalizerLandingOf(none, undefined), { landing: "None" });
  const unbranched = {
    ...asDraftBrief(intent),
    finalization: { kind: "PullRequest" as const },
  };
  assert.deepEqual(finalizerLandingOf(unbranched, undefined), {
    landing: "Unbound",
  });
  assert.deepEqual(finalizerLandingOf(unbranched, binding), {
    landing: "Unbranched",
  });
});

test("a proposal's work task merges the base it opens into: the reference its finalization names, or the remote's default and never the binding's", () => {
  for (const mode of ["PullRequest", "PullRequestMerge"]) {
    const named = asDraftBrief({
      ...intent,
      branch: "refs/heads/work",
      finalization: { mode, target: "refs/heads/release" },
    });
    assert.equal(
      finalizerLandingBaseRef(named, boundToMain),
      "refs/heads/release",
    );
    const unnamed = asDraftBrief({
      ...intent,
      branch: "refs/heads/work",
      finalization: { mode },
    });
    for (const each of [binding, boundToMain]) {
      assert.equal(
        finalizerLandingBaseRef(unnamed, each),
        finalizerRemoteDefaultRef,
        mode,
      );
    }
  }
});
