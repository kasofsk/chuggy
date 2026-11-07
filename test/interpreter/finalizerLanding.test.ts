/**
 * The ref a ticket's finalization lands on, as its brief and its binding name
 * it, which a work task is told and the finalizer gathers its view from.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitRefName,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  finalizerLandingOf,
  finalizerLandingRef,
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

test("a push lands on the reference its finalization names, before the brief's branch and the binding's", () => {
  const brief = asDraftBrief({
    ...intent,
    branch: "refs/heads/work",
    finalization: { mode: "Push", target: "refs/heads/release" },
  });
  assert.equal(finalizerLandingRef(brief, boundToMain), "refs/heads/release");
});

test("a push naming no reference lands on the brief's branch, before the binding's", () => {
  const brief = asDraftBrief({
    ...intent,
    branch: "refs/heads/work",
    finalization: { mode: "Push" },
  });
  assert.equal(finalizerLandingRef(brief, boundToMain), "refs/heads/work");
  assert.equal(
    finalizerLandingRef(
      asDraftBrief({ ...intent, branch: "refs/heads/work" }),
      binding,
    ),
    "refs/heads/work",
  );
});

test("a brief naming neither lands on the binding's reference", () => {
  assert.equal(
    finalizerLandingRef(asDraftBrief(intent), boundToMain),
    "refs/heads/main",
  );
  assert.equal(finalizerLandingRef(undefined, boundToMain), "refs/heads/main");
});

test("a proposal lands on the branch it is opened from, not the base it opens into", () => {
  const brief = asDraftBrief({
    ...intent,
    branch: "refs/heads/work",
    finalization: { mode: "PullRequest", target: "refs/heads/release" },
  });
  assert.equal(finalizerLandingRef(brief, boundToMain), "refs/heads/work");
});

test("a ticket that lands on no ref its brief or binding names has none", () => {
  assert.equal(
    finalizerLandingRef(
      asDraftBrief({ ...intent, finalization: { mode: "None" } }),
      boundToMain,
    ),
    undefined,
  );
  assert.equal(
    finalizerLandingRef(
      asDraftBrief({ ...intent, branch: "refs/heads/work" }),
      undefined,
    ),
    undefined,
  );
  assert.equal(finalizerLandingRef(asDraftBrief(intent), binding), undefined);
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
