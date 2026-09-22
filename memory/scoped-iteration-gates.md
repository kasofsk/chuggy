---
name: scoped-iteration-gates
description: Mutation/red-proof inner loops scope the gates to what the edit can move; full ci.sh only to confirm survivors and at merge
metadata:
  node_type: memory
  type: feedback
  originSessionId: 21ab2867-aeed-44fd-9cc5-a097fe635542
  modified: 2026-08-16T23:50:19.278Z
---

On the chuggy effort: speed up the iteration loop without reducing final quality by scoping which gates a probe runs to what the edit can actually move.

Cost structure (measured by sweep 3 lens C at phantom-main 3bb71fd): full `bash .chug/tasks/ci.sh` ≈ 93s. `check-model` alone ≈ 50.4s (quint: typecheck + unit suite + witnesses + refinement + randomized invariant search over 3 mc instances). node suite ≈ 38s, `check-ts` ≈ 13.8s, every other gate < 0.2s combined.

**Why scoping is lossless, not a shortcut:** `check-model` reads only `model/*.qnt`. A mutation to `src/*.ts` provably cannot change its verdict — quint never reads TypeScript. Re-running it after a src edit re-confirms a gate that structurally cannot move.

**How to apply — put this in every builder/reviewer brief:**
- Inner loop (mutation probes, red-proofs): scope gates to the edit. A `src/`-only mutation runs `check-ts` + node suite + `check-conformance` + the sub-0.2s shell gates, and SKIPS `check-model`. A red-proof of a *named* test runs that one test file first (`node --test <file>`, seconds), escalating to the full suite only to confirm nothing ELSE changed. A `model/` mutation runs everything (model changes ripple through mirrors and rosters).
- Full `ci.sh` stays MANDATORY at the two quality gates: confirming a claimed *survivor* (a survivor must beat the whole suite — see [[guards-fail-open]]), and every merge/landing gate (the Orchestrator's merge-preview always runs full ci.sh after npm ci).

Net ≈ 40–50% off the dominant per-probe cost; confirmation and landing gates untouched, so final quality is identical. Related: [[orchestration-default]], [[guards-fail-open]].
