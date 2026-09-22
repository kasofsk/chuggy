Three deletions from the ticket model, the second step of the convergence onto chug-ticket-domain (plan in `~/claude/chuggy-effort/ticket-language/SPIKE.md`; decided with Geoff 2026-09-20). Follows #714.

**NoFinalizer goes.** Every ticket enters Finalizing on a passing final stage. "No finalizer" is now one landing mode, `None`, which the finalizer service concludes at once: no forge call, no artifact read, no proposal. `Finalizer` leaves the model, the wire, the dispatch view and the console; the ticket-creation finalizer picker is the landing choice. A brief with no finalization takes the repository's landing default, and a repository may name `None` as that default.

**The revoke cascade goes.** Revoking a ticket transitions that ticket alone. A Pending ticket behind a Revoked dependency stays Pending, and the ticket read says so: `revokedDependencies` lists them, ascending, for a Pending ticket alone. The console shows "Blocked by revoked dependency N" with Revoke as the exit. `DependencyRevoked` leaves `Reason`; `cascadeSafety`, `revokeDoomed` and `noStructuralDeadlock` leave the model with it. The rig drill `test/rig/stranding.spec.ts` replaces the cascade drill.

**AnyPass goes.** A stage is its fan-out; evaluation is unanimous.

**Decision semantics 4.** Rows written under 1–3 keep replaying: `finalizer: ManagedFinalizer` and `combinator: UnanimousPass` are dropped on decode; a `ticket-done` record leaving any phase but Finalizing, or a `ticket-revoked` record transitioning more than one ticket, names a machine this one is not and is refused. A stored, undecided `ExecutionBlocked{DependencyRevoked}` operation is refused at decode naming the operation.

**Migration 005.** Guard first, naming the relations. Narrows both reason CHECKs; `native_action` keeps a settled-row arm because the rig's real project holds resolved desk tasks at the removed reason and the wire never reads a settled row. Drops `dispatch_candidate.finalizer`, re-renders `program`, widens the two landing-mode CHECKs with `None`, rewrites NULL draft modes to `None` (the baseline wrote NULL only under the NoFinalizer arm), replaces `decision_event_is_valid` and the two draft functions, and re-renders the lead observation bound. The rig was checked: no row any guard refuses.

**Rollout.** Ships alone; no fabric config change. The rig takes 005 at the next release.

Reviews: S round 1 APPROVE; A round 1 CHANGES (three prose lines, fixed); B round 1 CHANGES, round 2 CHANGES (the drill), fixed; whole-branch mutation sweep. Records under `~/claude/chuggy-effort/ticket-language/pr2/reviews/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
