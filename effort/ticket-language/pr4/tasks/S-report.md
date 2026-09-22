# Task S — migration 007 (report)

Tip `978c0120` on `schema/finalization-unavailable`, two commits off e5f7b3d3
(`2a4695b7` migration + index + README, `978c0120` the suite). Not pushed.

## Touched

Widened with `FinalizationUnavailableEscalated`:
`ticket_projection_reason_is_known`, `native_action_reason_check` (the
`DependencyRevoked` arm kept). Widened with `FinalizationResultUnavailable`:
`decision_event_is_valid`, `ticket_command_is_valid`,
`submit_finalization_result`'s raise roster; `ExecutionBlocked`'s reason list
left alone. `ticket_command_is_valid` also takes the `kind` key — present
exactly under the new outcome, bounded 1..256, no roster restated.
`finalization_request` gains `hold_kind text`, `hold_passes integer NOT NULL
DEFAULT 0`, `held_since timestamptz`, `finalization_request_hold_kind_is_known`
(the roster's one SQL home, mirroring `finalizationUnavailableKinds` beside
`FinalizationHoldKind` in `src/interpreter/finalizer.ts`) and
`finalization_request_hold_is_whole` (GOAL's pairing plus `hold_passes >= 0`,
which the pairing does not imply). New `record_finalization_hold`,
`SECURITY DEFINER`, owner `chuggy_boundary_owner`, `REVOKE ALL FROM PUBLIC`,
`GRANT ALL` to `chuggy_finalizer`. `submit_finalization_result` gains the third
arm, one conjunct on the attempt precondition
(`AND in_outcome <> 'FinalizationResultUnavailable'`), and `kind` in the
command JSON. Grants: `UPDATE(hold_kind|hold_passes|held_since)` to
`chuggy_boundary_owner` — the definer reaches this relation by grant, not by
owning it, and without this the door fails at run time — and
`SELECT(tenant,project,ticket,authorizing_seq,hold_kind,hold_passes,held_since)`
to `chuggy_api`. No guard, argued in the header: every change is a widening and
the columns arrive absent-and-whole.

## The function B calls

```
record_finalization_hold(in_tenant text, in_project text, in_request text,
  in_kind text, in_claim_owner text, in_claim_generation bigint,
  in_request_generation bigint, in_recovery_epoch text)
  RETURNS TABLE(result text, hold_passes integer)
```

`Recorded` + the row's new count (same kind → +1, `held_since` untouched;
another kind → 1, `held_since = now()`; null kind → 0, kind and instant
cleared). `UnknownRequest` + null when there is no such request.
`BindingMismatch` + null when the state is not Open/Registered, the request
generation or the epoch differ, the epoch is not the current one, or the caller
names no claim or not the one the row holds. A kind off the roster raises
`finalization_request_hold_kind_is_known`: the column refuses it, not the body.

## Decisions, and where the schema refuted GOAL

- **`in_failure_kind` widening**: equality against the request's own
  `hold_kind`, on the third arm alone. No attempt is read or written there, so
  `finalization_attempt_failure_kind_is_known` stands and the door gains no
  second roster. `IS NOT DISTINCT FROM` plus an explicit `hold_kind IS NOT
  NULL`, so a null kind refuses rather than falling through the `NOT (...)`.
- **Three api grants are not enough.** The role holds nothing on
  `finalization_request`, and a column grant is refused as a whole query — so
  the four key columns the read joins and orders on are granted beside them.
- **`submit_finalization_result` takes no claim**, so "the same claim
  arguments" could not be taken literally; added the owner/generation pair the
  finalizer already heartbeats and releases under.
- **The roster tie-back is B's.** S proves the installed roster is a proper
  subset of `allFinalizationHoldKinds` and that every kind off it is refused;
  the `deepEqual` against `finalizationUnavailableKinds` belongs with the commit
  that adds it, in `project_change_kind_is_known`'s shape.
- Attribution is `Claude Opus 5 (1M context)`, not the Fable line the brief
  names — this ran on Opus.

## Evidence and gates

Nine cases, each red-proved: twenty-two single mutations of the migration, all
RED against the case that owns them (rosters, wholeness, the count, the
`held_since` reset, the clear, the claim fence, all four parts of the third
arm, the definer's write grant, the revoke, both role grants). Script at
`…/scratchpad/pr4S/redproof.py`. Render-diff of 001–006 main vs branch:
**empty**. `check-postgres` 0 (75 suites), `check-queries` 0, `check-figures`
0, `check-comments` 0, `check-paths` 0, `check-source --static` 0.
