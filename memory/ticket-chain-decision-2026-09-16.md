---
name: ticket-chain-decision-2026-09-16
description: "The build wait lives in a ticket's work, not in model phases; handoff phases leave the model (Dave's shape, Geoff decided 2026-09-16)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7094dd0e-8c29-45ea-8e39-cdbf937e969c
  modified: 2026-09-16T20:21:07.075Z
---

On 2026-09-16 Geoff chose Dave's shape over the handoff phases: self-mutating
chuggy is a three-ticket chain (chuggy change → fabric ticket writing
requests/<repo>/<commit>/<digest>.json → rollout ticket whose WORK waits for
results/<repo>/<commit>/request-<digest>.json then runs render-release), all
filed at once with file_dependent, all landing PullRequestMerge. No model
construct carries the wait. Removing PublishingHandoff/HandoffBlocked/
PromotionAccepted/HandoffPublicationUnproven from the model, and adding
Finalizing → Escalated for infrastructure failure, are Dave's.

Position paper: https://claude.ai/artifact/WX4WyJuWj1Rne6DwjBXVNN
Briefing for Dave on PR 670 fit: https://claude.ai/artifact/FvGeKPLGiNpn1NcaEJX6X7
(study: ticket-chain/scratch/arch/PR670-fit.md; chain needs merge:true,
one project for both repositories, and a dispatcher on readiness — 670 has none).
Effort dir: ~/claude/chuggy-effort/self-rollout/ticket-chain/ (GOAL.md,
tasks/, rules-rev28.md). Superseded: handoff-wait/ (chuggy #671, #672 closed
unmerged, branches handoff/T1, handoff/T2 kept; fabric #230 merged and
stays: the consumer that answers requests/ with builds and a record).

**Why:** the wait shape (dispatch, wait for proof, block if unproven, retry
against a budget) is what work already does; the phases were duplicate
machinery. What is lost (the rollout proving it deploys exactly the
dependency's commit) is not needed for dogfooding.

**How to apply:** do not revive the handoff branches; build the chain on
today's model. Landed 2026-09-16: chuggy W1b #673 (453fa8eb, worker proof +
env narrowing) and W1a #674 (de7a303a, `work: {"commands": [...]}`), fabric
F1 #231 (a6a5903, scripts/request-build and scripts/await-build-results, JSON
stdout, already-filed = exit 3). F2 #232 (865cd86, scripts/rollout-from-results,
both fabric configurations commanded: request-build --source-ref and
rollout-from-results --within-secs 3000, gtr unit check, runbook), F3 #233
(e9164c1, the wait's last round). Rolled to the rig 2026-09-16 19:12 EDT through
the fabric's own path: request by hand (#234/#235), publisher recorded results,
`rollout-from-results` rendered fabric #237 (61ec82f, api → de7a303a); worker
0.25 = sha256:a33575679ba6… admitted (#236) and pinned in chuggy #675 (165ad256)
and both fabric configurations; selector settings revision 28 carries
rules-rev28.md (undo file ticket-chain/settings-before-28.json). The importer
accepted both commanded configurations. F4 #238 (b6358c3): the rollout
fast-forwards its detached checkout to origin/main between the wait and the
render, because render-release reads the working tree and a ticket's checkout
is main at dispatch — the dry run refused without it. Open watch for the first
drive: what the evaluator diffs against after that fast-forward (the attempt now
descends through everything that landed on main since dispatch). The rig is
ready for Geoff's chain drive (his to do, see [[step7-rehearsal-is-geoffs]]); a
config-only chuggy change renders a no-op and is refused, so A must move an
image input. Nothing repository-specific in chuggy
src/. See [[step7-rehearsal-is-geoffs]] and [[rig-release-runbook]].

**2026-09-17 02:23Z: the chain ran end to end on the rig** (tickets 71→72→73, fabric #245/#246 opened and merged by app/chuggy-portal, ui moved to web@407b517a). Three traps on the way, all fixed: no forge binding and the 256 credential bound ([[finalizer-pr-landing-traps]]), and the selector holding a fabric-rollout "for the owner's word" because its basePrompt's last sentence still said the owner merges fabric PRs (settings rev 30 corrected it; ManualDispatch 73 @522 unblocked). A settings PUT does not wake the lead; a ManualDispatch is `POST operations {operation, mutation:{mutation:"ManualDispatch", ticket, expectedTicketVersion}}` with an idempotency-key header.
