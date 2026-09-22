---
name: code-audit-2026-09-14
description: Repo-wide practice audit of chuggy at main 4ee3ab87 (2026-09-14); consolidated report and six area reports under ~/claude/chuggy-effort/audit-2026-09-14/
metadata: 
  node_type: memory
  type: project
  originSessionId: 703a066f-eff9-4f9a-ab54-6f18faac82dc
  modified: 2026-09-14T14:30:53.559Z
---

On 2026-09-14 Geoff asked for a repo-wide audit of duplication, dead code,
verbosity and complexity. Consolidated report: `~/claude/chuggy-effort/audit-2026-09-14/AUDIT.md`;
six area reports under `reports/`. Verdict: drifting, not in trouble; no
static-check gaming; the drift is "build a sibling by copying and renaming",
which house rule 11 makes look idiomatic and jscpd's floor cannot see.

Two live divergences found: `roots/ticketService.ts` stops the runtime twice
(copied from selector.ts without the memoised stop); the two GitHub request
stacks disagree on denied statuses (422). Largest payoffs: migrations
re-creating SQL routines (~2,700 lines), hand-rolled JSON parsers despite
zod (~1,050), 20 jscpd exemptions in ui tests resting on a false vitest claim,
and `ui/console` still shipping beside chuggy-ui (~11k lines if retired).

**Why:** the ordered fix list in AUDIT.md is the plan if Geoff picks it up;
the findings are cited by file:line and were spot-checked, so a later session
can act on them without re-auditing.

**How to apply:** before starting any cleanup from it, re-verify the cited
lines against current main; the tree moves daily. Related: [[migrations-render-literals]],
[[review-discipline]], [[durable-effort-scratchpad]].
