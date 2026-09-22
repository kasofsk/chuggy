---
name: pr-merge-landing-2026-09-13
description: "The pull-request-then-merge landing effort (2026-09-13): what shipped to main (#658 closing #653, #661), the decisions D1–D12, the review record, the follow-up nits, and the rollout state"
metadata:
  type: project
---

Shipped to chuggy main 5be0eafc (2026-09-13): #658 (issue #653: a
`PullRequest` brief naming no target opens into the repository's default
branch, observed at finalization; a branchless one is refused at the doors as
result row `LandingUnbranched` → 422; head==base is finalizer hold
`ProposalBaseIsHead`) and #661 (goal/pr-merge = #657 forge act + #659 roster +
#660 finalizer merges + #662 upgrade/freeze fixes): landing mode
`PullRequestMerge`, label "Pull request, then merge", effect "Opens a pull
request into the target branch and merges it". Effort dir
`~/claude/chuggy-effort/pr-merge/` (DECISIONS.md D1–D12, LEDGER.md, briefs).

Decisions (mine, Geoff accepted the shape): merge commit only, sha guard = the
head commit the finalizer built; merge answers are values
(`Merged|NotMergeable{Conflict|Blocked|Unknown}|HeadMoved|Denied|Unavailable|Ambiguous`);
a conflict at merge concludes the priced `FinalizationFailed/MergeConflict`,
blocked holds `ProposalMergeBlocked`, head moved holds `ProposalHeadMoved`, a
number-less stored identity holds `ProposalUnaddressed`; under `PullRequest` a
Merged proposal is still a contradiction, under `PullRequestMerge` it is
success (D8); one forge request per pass, bounds
`CHUG_FINALIZER_PROPOSAL_MERGES_MAX`/`_MERGE_READINGS_MAX` default 3; merge
evidence lives beside the proposal row (migration 093); model and fabric
untouched — the four model outcomes are the whole vocabulary (D11).
Migrations: 091 (default base), 092 (roster widening, literal list), 093
(merge columns, write-once trigger). See [[migrations-render-literals]].

Review record: opus slices got fresh adversarial rounds each fix; the sonnet
roster slice was reviewed inside the whole-goal review, which found the two
defects the slice reviews could not (a pre-change evidence row unreadable
because `number` became required; 050 rendering the live roster). Whole-goal
review also proved the `PullRequest` pure pass bit-identical to main over
every reachable publication state — worth repeating for any landing change.

Follow-ups left open (nits, not defects): the release case's extra NULL
assertions need a `Contradictory` reading stored first to bite;
`changeProposalMergeRequest` still takes an input with an unreachable throw
(type it as `ChangeProposalAddress`); 050/090 interpolate
`briefFinalizationDefault.mode` live for the column default (migration.test
hard-asserts 'Push'); `finalizerAdvance`'s Abort arm ignoring the ceiling
survives the run suite.

Rollout: DONE 2026-09-14 — fabric #221 merged (39ba3e78) by Geoff's `--merge`;
rig at 5be0eafc, ledger 93, all deployments verified on the released digests,
configuration imported at 5be0eafc. Geoff's live test (a ticket landing
"Pull request, then merge") not yet driven. Rig finding on the way: the
configuration importer has FAILED every run since 2026-09-11T19:10 because the
vestigial mirror binding `http://git.chuggy-git.svc.cluster.local./chuggy.git`
(bound 2026-08-25) is unreachable under the importer's egress policy (DNS,
postgres, public 443 only); the two GitHub bindings still import. Fix is
delete the binding row or admit chuggy-git:80 — Geoff's call.
Related: [[landing-default-2026-09-12]], [[github-pulls-list-lacks-mergeable]].
