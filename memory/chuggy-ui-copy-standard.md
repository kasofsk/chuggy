---
name: chuggy-ui-copy-standard
description: "Geoff rejects prose in the chuggy UI — the codeSentences 'explaining voice' is NOT the standard; copy is idiomatic product UI: nouns, one-word statuses, one short line max, numbers in fields"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 187a3968-e9bb-4a7a-9efc-de58120154f3
  modified: 2026-08-31T13:19:33.124Z
---

On 2026-08-31, reviewing the first ticket-page mockup, Geoff rejected the
console's explanatory prose outright: "stage 1 of 2 failed the current
artifact, and there is no rework left to pay for another cycle: this ticket
was authored with 2, and both are spent" is "nearly nonsense and so far from
idiomatic"; "the thing every stage below judges" is "not something any human
would ever write or want to read". He "hates paragraphs of text" in a UI. He
also wants the theme switcher in the global header, never inside a page.

**Why:** `ui/chuggy-ui/app/core/codeSentences.ts` established a voice that
turns every code into an explaining sentence ("the rework this ticket was
authored to pay for ran out"), and that sentence is exactly what confused him
about ticket 21 in the first place. I made it worse by briefing two design
agents to "keep the codeSentences voice — that part is good". Don't.

**How to apply:** every UI brief carries the standard — labels are nouns
("Cycle 3", "Stage 1 of 2"); status is one or two words (Passed, Failed,
Running, Skipped, Superseded, Parked); explanation is at most one short plain
line ("Rework budget exhausted · 2 of 2 used"); numbers live in fields and
meters, not prose; actions state effect as a fragment ("Resume — re-runs
evaluation from stage 1 · costs 1 gas"); no term is defined on the page — pick
a better term; nothing over ~60 characters except the ticket's own brief. The
codeSentences reason sentences are to be replaced, not extended. Related:
[[chat-surface-must-look-like-chatgpt]], [[radix-when-idiomatic]].
