---
name: gh-projects-classic-broken
description: gh issue view / pr edit fail on this account via GraphQL projectCards; use the REST API instead
metadata:
  type: reference
---

`gh issue view N`, `gh pr edit N` and similar fail against kasofsk/chuggy with:
`GraphQL: Projects (classic) is being deprecated ... (repository.issue.projectCards)`.
The command errors and — importantly — `gh pr edit` **silently does not apply the
edit**, so a body update appears to have failed loudly but actually did nothing.
Still true on 2026-09-08.

Working equivalents:
- read an issue: `gh api repos/:owner/:repo/issues/N --jq '{title,body,state}'`
- edit a PR body: `gh api --method PATCH repos/:owner/:repo/pulls/N -F body=@<file>`
- `gh pr view N --json <fields>` works (it is the human-readable view that dies),
  as do `gh pr create`, `gh pr ready`, `gh pr merge`, `gh pr comment`,
  `gh issue list` and `gh issue create`.

**Why:** the GraphQL path gh uses still requests `projectCards`, which GitHub has
sunset. It is not a permissions or auth problem, and retrying does not help.

**How to apply:** always verify a `gh pr edit` landed by reading the body back
before reporting the update as done.
