---
name: github-pulls-list-lacks-mergeable
description: "GitHub's pull list endpoint never carries mergeable/mergeable_state; only GET /pulls/{number} and POST /pulls do; merge_commit_sha exists on OPEN PRs too"
metadata:
  type: reference
---

`GET /repos/{o}/{r}/pulls?head=…` (the by-head/by-marker listing) returns no
`mergeable` or `mergeable_state`; reading mergeability needs
`GET /pulls/{number}` (which the chuggy adapter does as `readByNumber`) or the
`POST /pulls` answer. `mergeable_state`: `dirty` → conflicting; `behind`,
`blocked`, `draft` → blocked; `clean`/`unstable` mergeable; `unknown` while
GitHub computes. `merge_commit_sha` is set on open PRs (the trial merge), so a
merge commit is evidence only where `status` is `Merged`. Merge:
`PUT /pulls/{number}/merge` with `{sha, merge_method:"merge"}`; 405 not
mergeable, 409 head moved. Used by [[pr-merge-landing-2026-09-13]].
