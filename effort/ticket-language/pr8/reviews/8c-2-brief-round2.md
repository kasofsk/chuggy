# Review round 2 — PR 8c-2 "Update" (tip a173815d, branch `model/ticket-update`)

Setup: `_review-setup-8c-2.md` beside this file (part of this brief). Own postgres on 55449 if you need one; remove it after. Round 1's findings and the fixes are in `8c-2-ledger.md`. Diff under review: `git diff a26bf034..a173815d` (three commits f299de69, 5ba2994f, a173815d); read the round 1 briefs beside this file for context only.

Check, each with a failure that actually happens:
1. Each round 1 finding is closed: re-run the red-proof the ledger names (one mutation each, reverted) and confirm the new test goes red.
2. a173815d: `GRANT SELECT(configuration_revision)` edited into 016 in place — is 016 unreleased (yes: the rig is at 015), and do the privileges tests pin the grant and that `configuration_digest` stays closed? The optional wire fields: which reads fill them, does any consumer treat absent as a value?
3. The ticket page against decision 11: with the draft ahead, does anything still present draft content as what the ticket runs? The builder left open that the provenance "evaluation stages" and the ledger's grouping come from the draft's authoring — decide whether that contradicts what the ticket runs (what do evaluation stages derive from, and does an update change them?). A finding only if a reader is actually misled.
4. Gates at the tip, one at a time: check-source (test/rig playwright = baseline), check-postgres, check-console, check-console-sheets, check-queries, check-paths, check-comments, check-figures, check-duplication.

Verdict: APPROVE or CHANGES; findings with file:line, input, what goes wrong; under ~40 lines.
