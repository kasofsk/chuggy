/**
 * The finalizer vocabulary's own refusals and the pure pass's transitions: what
 * an observed view authorizes, what it never authorizes, and the bounds a
 * configuration must satisfy before a pass runs on it.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT. An ambiguous promotion reaching a
 * conclusive outcome and a hold being priced as a failure are the two ways this
 * slice could forge a domain outcome, so both are driven over every view this
 * machine can be handed rather than over one example of each.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allApprovalStandings,
  allClosingLifecycles,
  allCommitPermitStates,
  approvalStandingOf,
  allFinalizationFailureKinds,
  allFinalizationHoldKinds,
  allFinalizationRequestStates,
  allGitObjectIdChars,
  allReconciliationVerdicts,
  asCommitPermitId,
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  checkedFinalizerConfig,
  finalizationNext,
  finalizerDefaults,
  finalizerIdentityCharsMax,
  gitObjectIdPattern,
  gitRefNameCharsMax,
  type ApprovalStanding,
  type CommitPermit,
  type CommitPermitState,
  type FinalizationAttempt,
  type FinalizationReconciliation,
  type FinalizationView,
  type FinalizerConfig,
  type ObservedTarget,
  type ReconciliationVerdict,
} from "../../src/interpreter/finalizer.ts";
import {
  allLifecycles,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asSafeInteger } from "../../src/domain/ids.ts";
import { assertBoundsAreRefused } from "./configBounds.ts";
import type { TicketId } from "../../src/domain/ids.ts";

/** Every bound a deployment names, read from the defaults so a field added later is covered. */
const bounds = Object.keys(
  finalizerDefaults,
) as readonly (keyof FinalizerConfig)[];

/** The defaults with one bound replaced, which is how a case varies one thing. */
function configWith(
  name: keyof FinalizerConfig,
  value: number,
): FinalizerConfig {
  return { ...finalizerDefaults, [name]: value };
}

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const epoch = asRecoveryEpoch("epoch-1");
const ticket = asSafeInteger(1, "ticket") as TicketId;
const attemptId = asFinalizationAttemptId("attempt-1");
const permitId = asCommitPermitId("permit-1");
const repository = asRepositoryId("remote-1");
const base = asGitObjectId("a".repeat(40));
const candidate = asGitObjectId("b".repeat(40));
const moved = asGitObjectId("c".repeat(40));
const target: ObservedTarget = {
  ref: asGitRefName("refs/heads/main"),
  commit: base,
};

/** A prepared attempt against the observed target, which is the view every later case varies. */
const prepared: FinalizationAttempt = {
  attempt: attemptId,
  request: "request-1",
  ticket,
  repository,
  target,
  strategy: "Merge",
  configurationRevision: "revision-1",
  configurationDigest: "d".repeat(64),
  approvalRequired: false,
  outcome: "Prepared",
  candidate,
  attemptDigest: "e".repeat(64),
};

/** The failed attempt of the named kind, built rather than spread so it pins no candidate. */
function attemptFailed(
  kind: (typeof allFinalizationFailureKinds)[number],
): FinalizationAttempt {
  return {
    attempt: attemptId,
    request: "request-1",
    ticket,
    repository,
    target,
    strategy: "Merge",
    configurationRevision: "revision-1",
    configurationDigest: "d".repeat(64),
    approvalRequired: false,
    outcome: "Failed",
    failureKind: kind,
    attemptDigest: "e".repeat(64),
  };
}

/** What a case may vary, an explicitly absent row among the values it may name. */
type ViewOverrides = {
  readonly [Named in keyof FinalizationView]?:
    FinalizationView[Named] | undefined;
};

/**
 * The smallest well-formed view with the named rows replaced. A named row whose
 * value is `undefined` is dropped rather than set, which is what an absent
 * durable row looks like to the machine.
 */
function viewWith(overrides: ViewOverrides): FinalizationView {
  const smallest: FinalizationView = {
    lifecycle: "Active",
    claim: {
      partition,
      request: "request-1",
      ticket,
      authorizingSeq: 1,
      requestGeneration: 1,
      claimGeneration: 1,
      state: "Open",
      recoveryEpoch: epoch,
      owner: asFinalizerOwnerId("finalizer-1"),
    },
    repository: { partition, repository, recoveryEpoch: epoch },
    observedTarget: target,
    approval: "Pending",
    attemptsMade: 0,
  };
  return Object.fromEntries(
    Object.entries({ ...smallest, ...overrides }).filter(
      ([, value]) => value !== undefined,
    ),
  ) as unknown as FinalizationView;
}

/** A permit in the named state, which is the second half of every post-promotion view. */
function permitIn(state: CommitPermitState): CommitPermit {
  return {
    permit: permitId,
    attempt: attemptId,
    recoveryEpoch: epoch,
    lifecycleGeneration: 1,
    state,
  };
}

/** A reconciliation carrying the named verdict, an unreadable ref among them. */
function reconciliationOf(
  verdict: ReconciliationVerdict,
): FinalizationReconciliation {
  return {
    permit: permitId,
    candidate,
    target: target.ref,
    verdict,
    ...(verdict === "Unreadable" ? {} : { observed: candidate }),
  };
}

test("the defaults are a configuration a pass may run on", () => {
  assert.equal(checkedFinalizerConfig(finalizerDefaults), finalizerDefaults);
  assert.ok(
    bounds.length > 0,
    "the defaults name no bound, so this proves nothing",
  );
});

test("no bound may be zero, negative, fractional or left unnamed", () => {
  assertBoundsAreRefused(finalizerDefaults, checkedFinalizerConfig);
});

test("a bound past the safe integers is refused rather than silently rounded", () => {
  assert.throws(
    () =>
      checkedFinalizerConfig(
        configWith("requestClaimLeaseSecs", Number.MAX_SAFE_INTEGER + 2),
      ),
    RangeError,
  );
});

test("an identity past its column width, empty, or unpaired is refused", () => {
  assert.equal(asRepositoryId("r"), "r");
  for (const brand of [
    asFinalizationAttemptId,
    asCommitPermitId,
    asRepositoryId,
    asFinalizerOwnerId,
  ]) {
    assert.throws(() => brand(""), RangeError);
    assert.throws(() => brand("\uD800"), RangeError);
    assert.throws(
      () => brand("x".repeat(finalizerIdentityCharsMax + 1)),
      RangeError,
    );
    assert.equal(
      brand("x".repeat(finalizerIdentityCharsMax)).length,
      finalizerIdentityCharsMax,
    );
  }
  assert.throws(
    () => asGitRefName("x".repeat(gitRefNameCharsMax + 1)),
    RangeError,
  );
});

test("an object id is one of the widths git addresses an object at", () => {
  for (const chars of allGitObjectIdChars) {
    assert.equal(asGitObjectId("f".repeat(chars)).length, chars);
  }
  for (const bad of [
    "",
    "a".repeat(39),
    "a".repeat(41),
    "A".repeat(40),
    "g".repeat(40),
  ]) {
    assert.throws(() => asGitObjectId(bad), RangeError, `accepted ${bad}`);
  }
  assert.match(gitObjectIdPattern(), /^\^\(.*\)\$$/u);
});

test("a settled request is settled whatever else the view says", () => {
  for (const state of allFinalizationRequestStates) {
    const decision = finalizationNext(
      finalizerDefaults,
      viewWith({ claim: { ...viewWith({}).claim, state } }),
    );
    assert.equal(
      decision.decide === "Settled",
      state === "Fulfilled" || state === "Invalidated",
      `${state} decided ${decision.decide}`,
    );
  }
});

test("an unbound repository and an unreadable target are holds and not failures", () => {
  assert.deepEqual(
    finalizationNext(finalizerDefaults, viewWith({ repository: undefined })),
    { decide: "Hold", hold: "RepositoryUnbound" },
  );
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({ observedTarget: undefined }),
    ),
    { decide: "Hold", hold: "TargetUnreadable" },
  );
});

test("a request with no attempt prepares one against the target it observed", () => {
  assert.deepEqual(finalizationNext(finalizerDefaults, viewWith({})), {
    decide: "Prepare",
    target,
    restartsSpent: 0,
  });
});

test("a prepared attempt whose target moved restarts until the ceiling is spent", () => {
  const observed: ObservedTarget = { ref: target.ref, commit: moved };
  for (
    let made = 1;
    made <= finalizerDefaults.preparationRestartsMax;
    made += 1
  ) {
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({
          attempt: prepared,
          observedTarget: observed,
          attemptsMade: made,
        }),
      ),
      { decide: "Prepare", target: observed, restartsSpent: made - 1 },
    );
  }
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        observedTarget: observed,
        attemptsMade: finalizerDefaults.preparationRestartsMax + 1,
      }),
    ),
    { decide: "Hold", hold: "PreparationRestartsExhausted" },
  );
});

test("a failed attempt concludes as the one priced failure, carrying its kind", () => {
  for (const kind of allFinalizationFailureKinds) {
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({ attempt: attemptFailed(kind), attemptsMade: 1 }),
      ),
      {
        decide: "Conclude",
        conclusion: { outcome: "FinalizationFailed", kind },
      },
    );
  }
});

test("a closing project aborts every finalization that holds no permit", () => {
  for (const lifecycle of allClosingLifecycles) {
    for (const attempt of [undefined, prepared]) {
      assert.deepEqual(
        finalizationNext(
          finalizerDefaults,
          viewWith({
            lifecycle,
            attempt,
            attemptsMade: attempt === undefined ? 0 : 1,
          }),
        ),
        { decide: "Abort", target },
        `${lifecycle}/${attempt === undefined ? "no attempt" : "prepared"}`,
      );
    }
  }
});

test("a lifecycle that is not closing prepares and promotes exactly as before", () => {
  for (const lifecycle of allLifecycles.filter(
    (each) => !allClosingLifecycles.includes(each),
  )) {
    assert.equal(
      finalizationNext(finalizerDefaults, viewWith({ lifecycle })).decide,
      "Prepare",
      lifecycle,
    );
    assert.equal(
      finalizationNext(
        finalizerDefaults,
        viewWith({ lifecycle, attempt: prepared, attemptsMade: 1 }),
      ).decide,
      "Promote",
      lifecycle,
    );
  }
});

test("a closing project past the permit reads the ref before anything is erased", () => {
  for (const lifecycle of allClosingLifecycles) {
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({
          lifecycle,
          attempt: prepared,
          attemptsMade: 1,
          permit: permitIn("Granted"),
        }),
      ),
      { decide: "Reconcile", permit: permitId },
      lifecycle,
    );
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({
          lifecycle,
          attempt: prepared,
          attemptsMade: 1,
          permit: permitIn("Granted"),
          reconciliation: reconciliationOf("Unreadable"),
        }),
      ),
      { decide: "Hold", hold: "ReconciliationUnreadable" },
      lifecycle,
    );
  }
});

test("a closing project's abort is recorded once and then concluded, never re-aborted", () => {
  for (const lifecycle of allClosingLifecycles) {
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({
          lifecycle,
          attempt: attemptFailed("PreparationFailed"),
          attemptsMade: 1,
        }),
      ),
      {
        decide: "Conclude",
        conclusion: {
          outcome: "FinalizationFailed",
          kind: "PreparationFailed",
        },
      },
      lifecycle,
    );
  }
});

test("a closing project whose ref moved after a refused update aborts rather than restarting", () => {
  for (const lifecycle of allClosingLifecycles) {
    assert.deepEqual(
      finalizationNext(
        finalizerDefaults,
        viewWith({
          lifecycle,
          attempt: prepared,
          attemptsMade: 1,
          permit: permitIn("Concluded"),
          reconciliation: reconciliationOf("NotPromoted"),
        }),
      ),
      { decide: "Abort", target },
      lifecycle,
    );
  }
});

test("a standing is the answer recorded, and an unanswered or withdrawn ask is pending", () => {
  assert.equal(approvalStandingOf(undefined), "Pending");
  assert.equal(approvalStandingOf({ state: "Open" }), "Pending");
  assert.equal(approvalStandingOf({ state: "Withdrawn" }), "Pending");
  assert.equal(
    approvalStandingOf({ state: "Resolved", resolution: "Approve" }),
    "Granted",
  );
  assert.equal(
    approvalStandingOf({ state: "Resolved", resolution: "Decline" }),
    "Declined",
  );
  assert.throws(
    () => approvalStandingOf({ state: "Resolved" }),
    /records no answer/u,
  );
});

test("approval is awaited only where the pinned revision required it", () => {
  const required = { ...prepared, approvalRequired: true };
  for (const approval of allApprovalStandings) {
    const decision = finalizationNext(
      finalizerDefaults,
      viewWith({ attempt: required, approval, attemptsMade: 1 }),
    );
    const expected =
      approval === "Pending"
        ? "AwaitApproval"
        : approval === "Declined"
          ? "Hold"
          : "Promote";
    assert.equal(
      decision.decide,
      expected,
      `${approval} decided ${decision.decide}`,
    );
  }
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({ attempt: prepared, approval: "Pending", attemptsMade: 1 }),
    ),
    { decide: "Promote", attempt: attemptId },
  );
});

test("a granted permit with no reconciliation reads the ref rather than acting again", () => {
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn("Granted"),
      }),
    ),
    { decide: "Reconcile", permit: permitId },
  );
});

test("a concluded reconciliation promotes or restarts, and nothing else", () => {
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn("Concluded"),
        reconciliation: reconciliationOf("Promoted"),
      }),
    ),
    { decide: "Conclude", conclusion: { outcome: "FinalizationSucceeded" } },
  );
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn("Concluded"),
        reconciliation: reconciliationOf("NotPromoted"),
      }),
    ),
    { decide: "Prepare", target, restartsSpent: 0 },
  );
});

test("an ambiguous promotion has no path to a conclusive outcome", () => {
  for (const state of allCommitPermitStates) {
    const decision = finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn(state),
        reconciliation: reconciliationOf("Unreadable"),
      }),
    );
    assert.equal(
      decision.decide,
      "Hold",
      `${state} decided ${decision.decide}`,
    );
    assert.notEqual(decision.decide, "Conclude");
    assert.notEqual(decision.decide, "Promote");
  }
});

test("a granted permit and a concluded verdict are contradictory rather than conclusive", () => {
  for (const verdict of allReconciliationVerdicts) {
    if (verdict === "Unreadable") continue;
    const decision = finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn("Granted"),
        reconciliation: reconciliationOf(verdict),
      }),
    );
    assert.deepEqual(decision, {
      decide: "Hold",
      hold: "ContradictoryEvidence",
    });
  }
  assert.deepEqual(
    finalizationNext(
      finalizerDefaults,
      viewWith({
        attempt: prepared,
        attemptsMade: 1,
        permit: permitIn("Concluded"),
      }),
    ),
    { decide: "Hold", hold: "ContradictoryEvidence" },
  );
});

test("no hold is a failure kind, over every view this machine can be handed", () => {
  const holds = new Set<string>(allFinalizationHoldKinds);
  for (const kind of allFinalizationFailureKinds) {
    assert.ok(!holds.has(kind), `${kind} is spelled as a hold as well`);
  }
  const approvals: readonly ApprovalStanding[] = allApprovalStandings;
  for (const state of [undefined, ...allCommitPermitStates]) {
    for (const verdict of [undefined, ...allReconciliationVerdicts]) {
      for (const approval of approvals) {
        if (state === undefined && verdict !== undefined) continue;
        const decision = finalizationNext(
          finalizerDefaults,
          viewWith({
            attempt: prepared,
            attemptsMade: 1,
            approval,
            permit: state === undefined ? undefined : permitIn(state),
            reconciliation:
              verdict === undefined ? undefined : reconciliationOf(verdict),
          }),
        );
        if (decision.decide === "Hold") {
          assert.ok(
            holds.has(decision.hold),
            `${decision.hold} is not a declared hold`,
          );
        }
        if (decision.decide === "Conclude") {
          assert.equal(
            verdict,
            "Promoted",
            "a conclusive outcome was reached on a view that proved nothing",
          );
        }
      }
    }
  }
});

test("a view whose durable rows contradict each other is refused rather than decided", () => {
  assert.throws(
    () =>
      finalizationNext(
        finalizerDefaults,
        viewWith({ attempt: prepared, attemptsMade: 0 }),
      ),
    /no attempt was counted/u,
  );
  assert.throws(
    () =>
      finalizationNext(
        finalizerDefaults,
        viewWith({
          attempt: { ...prepared, request: "another" },
          attemptsMade: 1,
        }),
      ),
    /answers another request/u,
  );
  assert.throws(
    () =>
      finalizationNext(
        finalizerDefaults,
        viewWith({
          attempt: { ...prepared, outcome: "Failed" },
          attemptsMade: 1,
        }),
      ),
    /pins no candidate, or a failed one pins one/u,
  );
  assert.throws(
    () =>
      finalizationNext(
        finalizerDefaults,
        viewWith({
          attempt: prepared,
          attemptsMade: 1,
          reconciliation: reconciliationOf("Promoted"),
        }),
      ),
    /no permit to conclude/u,
  );
  assert.throws(
    () =>
      finalizationNext(
        finalizerDefaults,
        viewWith({
          attempt: prepared,
          attemptsMade: 1,
          permit: {
            ...permitIn("Granted"),
            attempt: asFinalizationAttemptId("other"),
          },
        }),
      ),
    /names another attempt/u,
  );
  assert.throws(
    () => finalizationNext(finalizerDefaults, viewWith({ attemptsMade: -1 })),
    /is not a count/u,
  );
});
