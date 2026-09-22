---
name: grep-misses-wrapped-prose
description: "chuggy hard-wraps prose at 80 columns, so grepping a multi-word phrase silently misses every instance that wrapped mid-phrase"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6be30584-a640-446b-b318-92e65638d96e
  modified: 2026-08-20T17:57:31.247Z
---

On chuggy: this tree hard-wraps prose at 80 columns in `*.md`, in gate and manifest headers, and in `*.qnt` comments. So `grep -n "some multi-word claim"` **cannot see any instance that wrapped inside the phrase**, and reports clean.

Every completeness check over prose has to join lines first. Something like `grep -rl . --include='*.md' | xargs -I{} sh -c 'tr "\n" " " < {} | grep -q "phrase" && echo {}'`, or search a distinctive single word and read the hits.

**Why:** on 2026-08-20 an author corrected a refuted claim in `deploy/rig/postgres/`, verified completeness with `grep -n "crossing the pod network"`, and missed a third instance that wrapped at `never crosses / the pod network` — in the same file the same commit was already editing. It cost a full adversarial review round. The reviewer caught it, then re-ran the scan line-joined **on the whole class of phrasings** rather than the one string, which is the stronger move: searching `cross* the [pod] network`, `no packet`, `without a packet`, `never cross*` surfaced two further hits that turned out to be correctly-scoped single-path statements, and knowing that is what made "no other instance survives" a claim worth anything.

**How to apply:** when a change corrects a claim that may appear more than once, brief the author to scan line-joined and to search the phrasing *class*, not the exact string — and brief the reviewer to re-run its own scan with its own patterns rather than accept the author's result. Two scans that agree are worth something only if they were derived independently. Related: [[guards-fail-open]], [[scoped-iteration-gates]].
