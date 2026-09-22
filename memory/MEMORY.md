## How we work

- [Orchestration default](orchestration-default.md) — nontrivial work runs through subagents; opus chunks adversarially reviewed, sonnet pieces folded into a PR the orchestrator reviews as it sees fit; in a Workflow the review loop is a per-task flag; small fixes, gate runs and release steps stay mine to do in-line (Geoff 2026-09-21)
- [Review discipline](review-discipline.md) — fresh context-free reviewer every fix round on running code; docs get ONE factual review; two nit-only FIX verdicts end reviewing; a finding must name a failure that actually happens; delete a churned-on comment rather than reword it
- [Mutation sweep early](mutation-sweep-early.md) — whole-artifact mutation sweep is the SECOND review, not the sixth; a sweep round ships unless it finds a behaviour defect
- [Merge authority](merge-authority-2026-08-31.md) — merging to main on chuggy AND chuggy-fabric is MINE to do, not to request, after a clean review, up to date and clean; bare `gh pr merge --admin`; goal branches are ours
- [Rollout PRs need no adversarial review](rollout-prs-no-adversarial-review.md) — script-generated rollout PRs get a mechanical diff check, then merge; hand-written content still reviewed
- [Evaluation is the review](evaluation-is-the-review.md) — a rig ticket's evaluation stages ARE the review; Push straight to main is an accepted interim, never "unreviewed"
- [Overnight autonomy 2026-09-21](overnight-autonomy-2026-09-21.md) — continue all night through the convergence PRs; pull main after every merge; self-run cluster sanity checks after each rollout; free to mint identities and change cluster/config
- [Rig tickets disposable](rig-tickets-disposable.md) — Geoff 2026-09-21: blow away the rig's tickets if it simplifies a migration; no structural lifts for old rows from PR 5 on; push back on old-row fix requests
- [Decide and ship](decide-and-ship.md) — on a multi-step effort keep going to completion; decide as a principal engineer; no pauses for input when there is a clear recommended path (Geoff 2026-09-10)
- [Parallelism cap](parallelism-cap.md) — about three subagents at a time, reviewers included; eleven at once was too many (Geoff 2026-09-14)
- [Free-form questions](freeform-questions-one-at-a-time.md) — ask in chat, one at a time; no AskUserQuestion menus
- [Parallel agent worktrees](parallel-agent-worktrees.md) — parallel subagents need their own worktree and scratchpad subdir
- [Durable effort scratchpad](durable-effort-scratchpad.md) — effort dirs live under ~/claude/chuggy-effort, not /tmp; recover from transcripts if lost

- [Simplify effort 2026-09-14](simplify-effort-2026-09-14.md) — eleven wave-one tasks off the audit in chuggy-wt/simplify-*; briefs, ledger, reviews under chuggy-effort/audit-2026-09-14/simplify/
- [Code audit 2026-09-14](code-audit-2026-09-14.md) — repo-wide practice audit at 4ee3ab87; report under ~/claude/chuggy-effort/audit-2026-09-14/; two live divergences, four big copy sources, no check-gaming

## Traps in this tree

- [Guards fail open](guards-fail-open.md) — twelve signatures of a guard that passed while the property failed (incl. suites run as superuser hiding a missing service-role grant; fixtures shorter than the remote's real token); read built artifacts, red-proof one term at a time, re-prove kept tests on the branch
- [chuggy false reds](chuggy-false-reds.md) — the roster of environmental gate reds (colour, memory pressure, dead test children, shared postgres, TMPDIR, npm ci placement); attribute at the real base before filing
- [Scoped iteration gates](scoped-iteration-gates.md) — mutation/red-proof loops skip provably-non-informative gates; full ci.sh only to confirm survivors and at merge
- [Sibling PR integration gate](sibling-pr-integration-gate.md) — GitHub's CLEAN is per-PR-vs-main only; integrate a batch locally and run ci.sh before merging
- [Grep misses wrapped prose](grep-misses-wrapped-prose.md) — 80-column hard wrap means phrase greps silently miss wrapped instances; scan line-joined and by phrasing class
- [Migrations render literals](migrations-render-literals.md) — a landed migration renders its rosters as literals; render-diff every migration main vs branch before merging a roster change; 050 drifted twice
- [Migrations edited in place](migrations-edited-in-place.md) — the ledger can't see a rewritten body; find it by dump-and-diff, fix forward only
- [Stored text outside the journal](stored-text-outside-the-journal.md) — a rename must lift every opaque stored event text (draft_revision.authoring missed by #723, fixed #724); rig sanity checks must read a draft and the drafts page
- [Lockup empty git objects](lockup-empty-git-objects.md) — mid-commit lockup: zero-byte loose objects, ref at a missing commit; between-commands lockup (2026-09-11): git intact, find in-flight work from subagent transcript mtimes, an uncommitted worktree diff may be a red-proof mutation; restart check containers

## Environment

- [Command permissions](command-permissions.md) — allow rules match only bare commands; put filtering inside the ssh quotes; a worktree session refuses compound git and bare docker/npm
- [gh Projects-classic broken](gh-projects-classic-broken.md) — gh issue view/pr edit fail and pr edit silently no-ops; use REST
- [Chrome live-check quirks](chrome-live-check-quirks.md) — maximized Wayland Chrome cannot emulate a phone width; zoom toggle unsticks cropped screenshots; restore Geoff's theme
- [blessed-practices main reset](blessed-practices-main-reset.md) — quilbert bot resets that repo's main; fixed 2026-08-19 but unprotected. `claude plugin uninstall` edits tracked settings.json

## The rig

- [Worker image roster stage](worker-image-roster-stage.md) — the worker Dockerfile runs the whole gate roster at build and fails the fabric build (PR #680, 2026-09-17); found the practices missing from pods and no Keto in the pod; `_postgres.sh` clobbers `$image`
- [Finalizer PR landing traps](finalizer-pr-landing-traps.md) — rig finalizer needs CHUG_FINALIZER_FORGE_BINDINGS or PullRequest landings hold silently; minted token past the 256 bound crash-looped (chuggy #676); silent-hold diagnosis recipe
- [Ticket-chain decision 2026-09-16](ticket-chain-decision-2026-09-16.md) — build wait is a ticket's WORK (Dave's shape); chain 71→72→73 ran end to end on the rig 2026-09-17; selector basePrompt trap (rev 30), ManualDispatch recipe; effort dir self-rollout/ticket-chain/
- [Self-rollout chain 2026-09-14](self-rollout-chain-2026-09-14.md) — sessions read the frozen mirror (oldest binding), fabric-rollout brief names an unusable script, fabric landing set to PullRequest; effort dir self-rollout/
- [Step 7 rehearsal is Geoff's](step7-rehearsal-is-geoffs.md) — Geoff drives tickets through his thread in the UI; I watch the rig, diagnose, fix the fabric, merge (2026-09-16)
- [Rollout chain resolves main at run time](rollout-chain-resolves-main-at-run-time.md) — never merge to chuggy main between a rig build-request ticket and its rollout ticket; repair = file the request by script, resume the rollout ticket via the API
- [Worker must run ci](worker-must-run-ci.md) — the author taught itself "Do NOT run ci.sh"; rev 31 forbids it (2026-09-21); check reds were Prettier/lint/comments; no chuggy ticket filed by Geoff's choice
- [Chuggy rig](chuggy-rig.md) — the local k8s rehearsal box, its shape, how far agents may go on it
- [Rig release runbook](rig-release-runbook.md) — release shapes, worker/config chicken-and-egg, importer trap, failed-attempt reason, mint reproduction, 2026-09-16 baseline swap; worker 0.26 on trixie (quint evaluator glibc), configuration pin is release-time so a broken-image ticket is revoke-and-refile; wipe-release shape and the post-wipe sanity-ticket recipe (API base path, BriefNamesNoRepository, ManualDispatch under a Paused selector)
- [GitHub pulls list lacks mergeable](github-pulls-list-lacks-mergeable.md) — mergeable only on GET /pulls/{n} and POST; merge_commit_sha exists on open PRs; PUT merge 405/409
- [vteng.io single-label hosts](vteng-single-label-hosts.md) — Universal SSL covers one subdomain level; add a host in three places

## Product and UI

- [PR+merge landing 2026-09-13](pr-merge-landing-2026-09-13.md) — PullRequestMerge landing + #653 fix on main 5be0eafc, rolled to the rig 2026-09-14; D1–D12; nits left; importer failing since 09-11 on the vestigial mirror binding (egress)
- [Landing default 2026-09-12](landing-default-2026-09-12.md) — per-repository landing default shipped to main and rig; NoFinalizer stores no landing; #653 closed 2026-09-13; Finalizer panel / Approval+Handoff columns not yet seen by Geoff
- [Repository onboarding plan](repository-onboarding-plan.md) — "The Roster Becomes a Row" (2026-09-10): chuggy mints App tokens, installations claimed by state token, bind/create routes behind Administer, mirror and fabric roster retired; Keto first (no new authz columns, Geoff 2026-09-10)

- [Auth vision interview 2026-09-10](auth-vision-interview-2026-09-10.md) — chuggy cloud + local workers first; tenant is a relation; per-project admins; auth-as-a-feature with optional per-project identity pools; Keto early if analysis says so
- [Multi-repo project requirements](multi-repo-project-requirements.md) — one ticket one repo (atomicity reason), ticket names its repo, per-repo configurations, PR through the rig is acceptance, UI onboarding punted
- [Chuggy UI copy standard](chuggy-ui-copy-standard.md) — nouns, one-word statuses, one short line max; the codeSentences voice is NOT the standard; theme switcher lives in the header
- [Marketing copy voice](marketing-copy-voice.md) — chuggy is "Squarespace for any app": vibe management with AI helpers, hosting with paved-path infra included; non-technical audience first, engineers welcome; never internals, no claudeisms; fresh copy-editor pass before showing
- [Chat surface must look like ChatGPT](chat-surface-must-look-like-chatgpt.md) — the released conversation surface must feel exactly like ChatGPT/Claude.ai; design spike by interview
- [Radix when idiomatic](radix-when-idiomatic.md) — use Radix wherever idiomatic; vendor components (assistant-ui) adopted; Tailwind optional
- [Ticket language 2026-09-20](ticket-language-2026-09-20.md) — converge chuggy's ticket model onto chug-ticket-domain until importable; PRs 1–6 landed (#714, #719+#722, #723+#724, #725, #726 first wipe, #728, #729, 2026-09-21); PR 6 split into 6a/6b, both released with wipes; PR 7 split into 7a #730 (keyed evaluators, 011) and 7b #731 (evaluation instance, 012), both merged and released with wipes 2026-09-22 (main aaaff1ec, sanity ticket Done); semantics 6 alone, no old-row lifts remain; plan in chuggy-effort/ticket-language/SPIKE.md; rename PRs must run the full roster; PR 8 split into 8a released ticket / 8b events / 8c commands per pr8/survey.md; 8a #732+#733 merged and released 2026-09-22 (main 02bd9572); paused 2026-09-22 before 8b, handoff in pr8/HANDOFF-2026-09-22.md
- [Finalization unavailable 2026-09-21](finalization-unavailable-2026-09-21.md) — PR 4 decisions: thirteen holds escalate after a dwell recorded on the request row, five stay holds (human answers, rebuild, defect, awaiting review); knobs are the roster and holdPassesMax
- [Handoff removal 2026-09-20](handoff-removal-2026-09-20.md) — phases gone via #712/#713; rig needs 002+003 rolled; credentialReference chain removal starts in the fabric; Finalizing→Escalated PR not started
- [Worker pool PR 705](worker-pool-pr-705.md) — Dave's pull-based pool plane beside main's push port; reviewed 2026-09-20, fixes in #711 against dc/worker-pool; forge-credential policy question open
- [Mac vz node](mac-vz-node.md) — 89tracy@.175 M1 prepared for macOS-vz-kubelet on gtr; joined gtr as node macmini-m1 (2026-09-18); NodeRestriction/egress-selector/webhook-auth traps; VM registry at .114:30500; next is guest image
- [Cloudflare chug.gy token](cloudflare-chug-gy-token.md) — DNS-edit token on disk; account-owned, verify via accounts endpoint
