# Task C (PR 8c-1) — the console names the refusal

Branch `model/ticket-commands`, tip `1e257fa7` (B's). Setup: `_setup.md` beside this file (read it first; it is part of this brief) — **except** the branch step: `git fetch origin model/ticket-commands && git checkout model/ticket-commands` once, and confirm `git log -1 --oneline` is `1e257fa7`. The console's own dependencies: follow how `check-console` and `check-source` build `ui/chuggy-ui` (read those gates' headers); never `npm ci` under `ui/` if the gate does not.

Read, in order: `/Users/david/chuggy-effort/ticket-language/pr8/GOAL.md` §"PR 8c-1 — decisions" (7 is yours; 6 says what the wire carries) and every 8c-1 progress line, `pr8/tasks/8c-1/B-report.md` (the wire's `refusal` schema and the `ui/` sites you must answer), `pr8/survey.md` §7, `ui/chuggy-ui/app/core/{codeLabels,codeSentences,threads,operationFollow}.ts`, `CLAUDE.md`, `.chug/tasks/review-change.md`, and any console copy guide the tree or `.claude/settings.json`'s practice roster names (invoke the relevant skill if one covers interface copy).

## Scope

`ui/chuggy-ui/` and `test/ui/`.

- Every refusal code has a label and a sentence; `NotEnabled` and `CommandUnreadable` leave. A domain refusal's sentence reads its payload and names the numbers a reader needs to act: which dependencies are missing or not done (ticket numbers as the console links tickets elsewhere), which task is not current, which work cycle and generation a finalization result was for. The three update-only refusals get words now (they arrive in 8c-2) and say nothing that promises an edit offer.
- Follow the sheet and copy rules `check-console-sheets` and the console's existing sentences hold to; match their voice.
- Tests: `test/ui/mutationSentences.test.ts` and its siblings answer every code, and one test per payload shape asserts the numbers reach the sentence.
- Nothing outside `ui/` and `test/ui/`; if the wire is wrong for what a sentence needs, stop and say so rather than editing `src/contract`.

## Gates on the tip

`check-source`, `check-console`, `check-console-sheets`, `check-figures`, `check-comments`, `check-paths`, `check-duplication`. Report each exit.

## Report

Tip; each code's label and sentence as rendered for a sample payload; files touched; gates on the tip. Under ~50 lines.
