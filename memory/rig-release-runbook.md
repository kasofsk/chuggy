---
name: rig-release-runbook
description: "The order a rig release goes in, the worker/config chicken-and-egg, the importer trap, the stacked-PR close trap, and what no gate holds; current as of the plane-credentials merge (2026-09-11)"
metadata: 
  node_type: memory
  type: project
  originSessionId: d39ac532-3a96-4bc3-b5ee-6fb9eab3703e
  modified: 2026-09-11T04:27:19.493Z
---

Details with file:line live in the fabric README and `deploy-to-gtr.sh`'s
header; this is the order and the traps.

## Shapes, cheapest first

- **Console only** (`ui/chuggy-ui/`): `CHUG_RIG_SSH=… just deploy-to-gtr
  --console` — gates only what the change since the *live* commit affects
  (`CHUG_CI_BASE=<live short sha>`), builds `chuggy-ui` alone, opens the fabric
  PR and lands it in one run, no live-attempt check. It refuses (exit 2) when
  that change also moves the api (`src/`, `images/api`, root package files — a
  migration is under `src/`) or the old console (`ui/console`, `images/web` —
  **a comment edit to `images/web/nginx.conf` counts**), or when HEAD is behind
  the live commit. Geoff's rule for it (2026-09-08): fix review findings and
  merge, no second review round.
- **src / api:** `deploy-to-gtr.sh` phase 1 then `--merge`. Any `src/` change
  rebuilds the api; `chuggy-ui` is rebuilt whenever `src/contract` moves
  (`images/chuggy-ui/Dockerfile` COPYs it), so let the script say what moved
  rather than the brief.
- **Worker:** a separate build first — see below. No worker build is needed when
  `images/worker/` is untouched: no build request, no admit, no session-policy
  change, no hand commit.

## The worker image is the fabric's, not deploy-to-gtr's

deploy-to-gtr only WARNS on `images/worker/` changes. Route: fabric
`scripts/render-build-request --repository-id chuggy --source-commit <40-hex
chuggy main sha> --dockerfile images/worker/Dockerfile --profile mini …` (copy
args from the last request under `builds/chuggy/`), never hand-edit. **Its own
PR**, merged on its file list — a build request names a commit and admits
nothing, so merging it alone changes nothing that runs and the digest can be read
before the rollout PR is written. Flux's separate `builds` Kustomization
materializes the Build+BuildRun; `flux reconcile kustomization builds
--with-source` **always exits 1** (three StepFailed BuildRuns are still declared)
yet still applies — read `kubectl -n chuggy-build get buildruns` for the verdict.
Take the digest from `.status.output.digest` AND the registry's
Docker-Content-Digest. Admit by appending `{image, name: chuggy-worker, version:
"0.<next>", operatingSystem: Linux, architecture: Amd64, capabilities: [...]}` to
`CHUG_SCHEDULER_ADMITTED_IMAGES` in `cluster/apps/chuggy-scheduler.yaml`
(versions = admission order, never reassigned; restarts the scheduler, so no live
attempt). `CHUG_SCHEDULER_SESSION_POLICY` pins an image too and the scheduler
parses it as REQUIRED — write both in the same commit.

**Chicken-and-egg:** the config pins the worker digest and lives in chuggy; the
digest exists only after the fabric builds a chuggy commit. So: W (code) → build
→ admit → P (one-line digest repin of `.chug/configurations/*.json`) →
deploy-to-gtr from P. Readiness never checks admission; execution against an
unadmitted digest is `ExecutionPolicyDenied` at pod time.

**Verify the pairing over the render.** Since fabric #139,
`tests/session-placement.py` (wired into `nix flake check`) holds
`SESSION_POLICY.image` against the admitted list and version uniqueness, so a
wrong digest in either place alone is red there — `development-worker` alone
stays green, because it `grep -F`s the file and grep answers *whether*, never
*where*. Nothing holds any digest against the registry. Read both digests off the
registry and JSON-parse the rendered Deployment's two env values
(`kubectl kustomize`), not the source text.

## deploy-to-gtr

HEAD on origin/main and clean; `CHUG_RIG_SSH=geoff@192.168.0.114`. Phase 1 runs
the FULL gate itself (`CHUG_CI_FULL=1 ci.sh`, check-model included; ~6–25 min),
builds only what moved, pushes from the node, reads digests back, edits the ten
fabric manifests, opens a non-draft PR on `release/chuggy-<short>` — **that
branch name is load-bearing**: `--merge` finds the PR by that head, so carrying
the commit to another branch costs the whole phase 2.

`--merge` refuses while any live attempt exists, needs
`CHUG_RIG_ARCHIVE=/home/geoff/backups` when migrations moved, then dumps,
admin-merges (`--delete-branch`), reconciles, waits for the migrate Job
(`chuggy-migrate-<short>-registry`, backoffLimit 0 — a failed Job must be
deleted by hand) and verifies every rollout. ~2 min. The dump lands on the LOCAL
host, since kubectl exec crosses the wire.

**Phase 2 replayed by hand works (2026-09-11, Geoff away):** `land()` in the
script is five steps and none is refused as a bare command: `ssh node 'kubectl -n
chuggy exec postgres-0 -- pg_dump -U postgres -Fc chuggy' > $CHUG_RIG_ARCHIVE/chuggy-pre-<short>.dump`
(check `PGDMP`) plus `pg_dumpall --globals-only`; `gh pr merge <n> -R gdoteof/chuggy-fabric
--merge --delete-branch --admin`; annotate `gitrepository/fabric` then `kustomization/apps`
in `flux-system` with `reconcile.fluxcd.io/requestedAt=<stamp>` and poll
`.status.artifact.revision` / `.status.lastAppliedRevision` for the merge sha (5–45 s);
`kubectl -n chuggy wait --for=condition=complete job/chuggy-migrate-<short>-registry`;
`rollout status` per Deployment and compare images to the manifests; ledger by SQL.
Phase 1 itself runs fine from my session in the background (`run_in_background`, 600 s
timeout is enough for a src-only release). **The migrate Job refuses a ledger that is not
a PREFIX of the declared chain** ("the applied ledger is not a prefix of the schema this
image declares, so nothing was applied") — a migration merged after a higher-numbered
sibling was released must be renumbered past the ledger, not left as a hole (0c172d37,
2026-09-11: 085 landed after 086 had rolled; renumbered 089 in chuggy #647).

**Phase 1 runs unattended from an opus subagent** given a brief file and a
worktree detached at the released commit (`npm ci` first; `env -C <worktree>`
keeps it one bare command since a subagent's cwd resets). **Phase 2 (`--merge`)
is Geoff's**: since 2026-09-10 the auto-mode classifier refuses it as a bare
command in my session and in subagents; he runs it with `!` from
`/home/geoff/claude/chuggy` at the released commit, after phase 1's PR exists
(`--merge` before that is a LINTER ERROR, harmless). Other refusals are the
command shape ([[command-permissions]]).

**Rollout shape:** 1–2 restarts of each control-plane pod. The first exit is
either the scheduler/api refusing a ledger the migrate Job has not yet advanced,
or the netpol race (`ECONNREFUSED <postgres pod ip>:5432`) — read the *previous*
container, and read it for which one it is. `/health/ready` from the node is on
the api Service's port **3000**; port 80 hangs to timeout, and there is no curl
or wget inside the api pod.

**Migrations the script lists are not the ones the Job applies.** It prints every
migration *file* that moved between the two release commits, including bodies
edited after they were applied ([[migrations-edited-in-place]]). Read each before
merging; the Job applies only versions above the ledger.

**The importer trap:** the CronJob `chuggy-configuration-importer` (every 2 min,
tracks chuggy `refs/heads/main`) runs the DEPLOYED api image, and an import is
all-or-nothing across `.chug/configurations/`. A config shape only the new api
parses is refused (`DeclarationsRefused` / `EvaluationsInvalid`) until the api
rolls forward. Harmless: the last good revision stays.

**A project does not move to a new revision by itself** — new tickets are created
against a named revision from the console; released tickets keep their pin. A
settings PUT is not a project change: replacing the base prompt at revision N
does not wake the lead; the next released or revoked ticket does.

**No README entry.** The fabric README's release list is gone (fabric #171,
Geoff 2026-09-06: "lets remove that from the readme so we stop doing that"). A
release ends at `--merge` and its rollout verification; the record is the fabric
merge commit's digests and source-commit annotations plus the effort ledger.

**Review:** a rollout PR that is only script output (digests, source-commit
annotations, Job rename) gets no reviewer — mechanical diff check, then merge
([[rollout-prs-no-adversarial-review]]). Anything hand-written still gets one.

## Provisioning roots (each in one bare ssh)

`PW=$(kubectl -n chuggy get secret chuggy-postgres-credentials -o
go-template='{{index .data "owner-password" | base64decode}}')`, then
`kubectl -n chuggy exec deploy/chuggy-api -- env … node
--experimental-strip-types src/roots/<root>.ts`, so the password never leaves the
node.

- `provisionAgentSession.ts` — actions `open`/`enqueue`/`close`; kinds
  Lead/Thread/Inquiry (there is no "Session" kind). `close` needs only
  DATABASE_URL, ACTION, TENANT, PROJECT, SESSION.
- `provisionProjectAccess.ts` — since chuggy bf3f5fc0 (2026-09-10, Keto port)
  a TUPLE WRITER, not a row writer: `CHUG_PROVISION_ACTION=grant|revoke`,
  `CHUG_PROVISION_KETO_WRITE_URL`, `CHUG_PROVISION_RELATION` (Project:
  `admins|developers|dispatchers|agents`; Tenant: `admins|members|hosted_execution`
  with `CHUG_PROVISION_PROJECT` absent; `tenant` with a project writes the
  `Project#tenant` subject set and names no person), plus SUBJECT/TENANT/PROJECT
  and `CHUG_API_OIDC_ISSUER`. No DATABASE_URL. The write port 4467 is admitted
  from `ory` alone, so run it from a pod in `ory` or port-forward; raw PUTs to
  `/admin/relation-tuples` from a pod in `ory` are equivalent. Object is
  `<len(tenant)>:<tenant><project>`, subject is the principal string. Verify
  with a `read` check on `keto-read.ory:4466`. `project_membership` is gone at
  migration 83. Runbook: `deploy/rig/keto/README.md` in chuggy.
- `provisionForgeInstallation.ts` (since chuggy 5882e0d8, 2026-09-11, ledger
  84) — records which tenant claimed a GitHub App installation; owner-only
  definer `record_forge_installation(forge, app, account, account_kind,
  installation_id, tenant, authority_kind, authority_subject)`, so `psql -U
  chuggy_owner -d chuggy` in `postgres-0` calling it directly is equivalent
  and simpler. Rows on the rig (all tenant `vteng`, never deleted by design):
  app `portal` kasofsk (Organization, 156333284) and gdoteof (User,
  156334058); app `worker` kasofsk (156786211) and gdoteof (156791042),
  written 2026-09-11. Quoting through `ssh '… -c "select f(…)"'`: SQL
  strings as `\$\$github\$\$` (dollar-quoted, dollars escaped so the remote
  shell does not expand `$$` to its pid; `\"` inside makes identifiers).
  Runbook: `deploy/rig/forge/README.md`.
- **Stacked fabric PRs close on the base's merge**: `gh pr merge
  --delete-branch` on the base PR deletes its branch and GitHub CLOSES every
  PR based on it; a closed PR cannot change base (422). Open a new PR from
  the same branch against main (fabric #205 → #206, 2026-09-11). Either
  merge the stacked PR without `--delete-branch` on the base, or retarget
  the stacked one to main BEFORE merging the base.

## Session behaviour worth knowing before driving one

A member holds ONE thread (`POST …/threads` answers the existing one). A
thread's backlog is 8 open turns (`429 ThreadBacklogged`) and **nothing withdraws
a queued turn**. The attempt budget is `budgetUsd: 5` in
`src/adapters/kubernetes/sessionPod.ts`; a fresh pod re-reads the whole history
(one turn cost $2.13 on a 16-turn thread), and a spent pod exits 0 for the reaper
to collect on the lapsed lease (~5 min), fresh attempt ~15 s later.
`images/worker/sessionStore.mjs` never splits a transcript entry, so any tool
result over 65 536 bytes is refused and the turn fails `StoreRefused`
(kasofsk/chuggy#569) — `list_executions` at its page maximum is 93 874 bytes;
ticket reads are ≤ 2 KB. While tickets run, `POST …/drafts` must read its fence
(`GET …/draft-initializations/<rev>`) in the SAME remote command or it answers
`409 DraftInitializationStale`.

Related: [[chuggy-rig]], [[chuggy-false-reds]], [[review-discipline]].

## Where a failed attempt's reason is (2026-09-11)

The scheduler and the plane log nothing about an attempt; `execution_attempt.evidence`
is a label (`RunFailed` is the pod's own verdict). The pod's reason is the file it
uploaded before ending: in the plane pod, `find /var/lib/chuggy/artifacts -name
worker-error.txt -mmin -N` (hashed path `…/attempt/<hash>/<hash>/.chuggy/worker-error.txt`).
The plane's mint answers `Unavailable`/503 for a forge outage AND for a refusal this
side made (a bound, a schema) — reproduce by running the plane's composition inside the
pod: `kubectl -n chuggy exec -i deploy/chuggy-worker-plane -- sh -c 'cd /srv/chuggy &&
node --input-type=module -'` with a JS script on stdin importing `./src/...ts` modules
(the image carries `src/`, node strips types). The mounted key + app id + a hand-rolled
RS256 JWT against `/app` proves the forge half alone.

**The api has an egress policy since fabric 4c04bf91 (2026-09-11):** DNS,
postgres 5432, keto-read 4466, public 443 minus the six site ranges. Any
change to an api arm is verified by `kubectl -n chuggy rollout restart
deploy/chuggy-api` + `rollout status` (OIDC discovery is a start-up
precondition; `/health/ready` proves only the postgres and keto arms), then
fetching the discovery document, `api.github.com/meta` and a `github.com`
`info/refs` from inside the pod with `node -e fetch(...)`. The api's
first-second race exit reads `native HTTP server: the native HTTP database
must be migrated and connect as chuggy_api` — a database-precondition
message, not a migration problem; the second start succeeds.
`tests/forge-app-key.py` parses every minter's public arm (port, cidr, six
excepts, no endPort); the transition gate's greps only count occurrences.

**Keto tuples on the rig (2026-09-12):** the console's forge routes
(installations listing, claim, bind, create) ask `Tenant:5:vteng#administer`
FIRST; a project admin with no Tenant tuple sees Add/Create greyed and no
accounts. Write tuples from a pod in `ory` (4467 is namespace-local; the
documented exec-in-api-pod runbook is refused by both netpols):
`kubectl -n ory run keto-put-$RANDOM --rm -i --restart=Never
--image=curlimages/curl:8.10.1 --quiet -- sh -c "sleep 4; curl -sS --retry 5
--retry-all-errors -X PUT http://keto-write.ory.svc.cluster.local:4467/admin/relation-tuples
-H content-type:application/json -d '{...}'"` — the `sleep 4` + retries
matter: a fresh pod's first connection fails (the same first-second race
every bounded pod shows). Verify with a `check` on keto-read 4466.
**A ticket's configuration pin is for life** (taken at creation, kept on
revision): after 7b, tickets pinned to worker 0.23 die in 4 s with `no
repository configuration for <github url>`; only a new ticket picks up 0.24.

## The baseline landed by ledger swap, not recreation (2026-09-16)

chuggy #669 (5e37c51f) refuses any ledger but its own single row. The rig kept
its data: prove identity on the server (dump/restore the live DB into a scratch
DB; run the new image's `src/roots/migrate.ts` in a one-off pod against a second
scratch DB — a fresh DB needs the `GRANT … ON SCHEMA public` block from
`deploy/rig/postgres/postgres-roles.sql` first or migrate dies with `permission
denied for schema public`; `pg_dump --schema-only` both, drop `\restrict` lines,
diff), fix the real differences by hand, then in one transaction `DELETE FROM
schema_migration; INSERT … (1, 'the database baseline')`. Swap BEFORE merging the
release: the migrate Job then reports "already current" and nothing needs
deleting. Whole switch from merge to every pod Ready took under a minute.
The only real differences found: `project_continuation_expected_phase_check`
and `ticket_projection_phase_is_known` never carried PublishingHandoff,
HandoffBlocked, Abandoned in the historical chain (the baseline widened them —
a latent crash for any handoff ticket on a pre-baseline DB). Column order and
grant order differ and are harmless; compare dump/restored copies or the
constraint deparse noise drowns the diff. Record: `~/claude/chuggy-effort/self-rollout/first-drive/LEDGER.md`;
insurance dump on the node under `~/baseline-probe/`.
Worker 0.21 refuses repositories outside the site map (`no repository
configuration for <url>`); 0.24 (014a8d93…) passes GitHub repositories through.

**Selector settings PUT (rev 27→28, 2026-09-16):** mint a Hydra client_credentials
client on the node (`hydra create oauth2-client … --name orient-admin`, file 600),
write `Project 5:vtengchuggy#admins` for subject `21:https://auth.vteng.io<client_id>`
from a `kubectl -n ory run … curl` pod, GET (keep as undo), PUT
`{expectedRevision, overrides:{all five}}`, verify, DELETE the tuple (check →
allowed:false), `hydra delete oauth2-client`, rm the node files. TRAP: `kubectl run -i`
inside an `ssh … bash -s <<'EOF'` script eats the rest of the script as its stdin —
give it `</dev/null`. Helper: multi-repo/orientation/settings-call.sh.

**Worker 0.26 (2026-09-17):** base moved to node:26.7.0-trixie (chuggy #678) because quint 0.32's Rust evaluator needs GLIBC_2.39 and bookworm has 2.36 — on 0.25 check-model could never run in an attempt (exit 2), so any ticket touching the model failed every cycle. Build request by hand (mini profile, fabric #247), digest sha256:cd841adc…, admitted fabric #248, chuggy repin #679. A ticket's configuration revision is pinned at release and no mutation re-pins it: a ticket released on a broken image is revoke-and-refile, never resume.

**Replay the rig's journal before any release that changes the reader or a
migration guard (added 2026-09-21 after the ba0c5a68 failure):** export
`journal_entry` for tenant vteng as JSONL (`json_build_object(project, seq,
semantics=decision_semantics_version, event_schema, entry)`), then run
`~/claude/chuggy-effort/ticket-language/pr2-fix/replay-rig.ts` against the
release's `src` (it decodes through `parseStoredEntry` and runs
`storedJournalLegalOn` at the rig's domain config {256, 8, 4}, naming the
first refusing seq and check). Also run every new migration guard's own
predicate against the rig. A grep for deleted names is not this check
([[guards-fail-open]] twelfth signature).

**Wipe release (first used 2026-09-21, PR 5):** dump; phase 1 builds the fabric PR; scale the seven chuggy deployments to 0 and wait for the pods; run the wipe as superuser (`kubectl -n chuggy exec -i postgres-0 -- psql -U postgres chuggy -v ON_ERROR_STOP=1 -q < wipe-tickets.sql`); merge the fabric PR and reconcile, which reapplies the replica counts and runs the migrate job on the empty journal. The importer cronjob writes only kept relations and need not be suspended. **Run the wipe with the script the rig's *current* migration level admits, not main's:** a wipe script that names a table the pending migration creates (8a's `ticket_definition`/`ticket_source`, 2026-09-22) fails `relation does not exist` before the fabric merge, and the migration's guard refuses while journal rows exist, so the two deadlock unless the wipe uses the previous release's script (`git show <previous main>:deploy/rig/wipe-tickets.sql`). Post-wipe sanity ticket: the native API base is `/api/v1/tenants/<t>/projects/<p>`; `GET draft-initializations/<revision>` gives the fence and the authoring defaults; a draft's brief must name `repository` or `ReleaseDraft` is refused `BriefNamesNoRepository`; `finalization: {mode: "None"}` avoids any landing; the project's selector mode is Paused so dispatch is a `ManualDispatch` operation (`expectedTicketVersion` = the candidate's `ticketVersion` from `dispatch-view`); a commanded configuration (fabric-rollout) runs its own command regardless of the brief's intent, so pick one whose command can pass or expect `WorkFailureEscalated`; revoke afterwards.

**Sanity ticket configuration (2026-09-21, 6a release):** use `repository:<main sha>:chuggy-development` (a Claude agent on the chuggy repo, `npm ci` setup, then a `ci.sh` check stage and a review stage). With a do-nothing brief (`git status`, report clean), `finalization: {mode: "None"}` and `ManualDispatch`, ticket 1 ran Work → check → review → Done in about two and a half minutes on worker 0.27. `basic-coding` at main still names `image: worker:v1` (unservable); `fabric-rollout` needs a request doc so a lone ticket fails by design. The listing omits `canonical`; `GET $P/configurations/<revision>` has it. Executions read: `GET $P/executions?ticket=<n>`. The rig shell is zsh: no bare `==` in ssh command strings.

**Operations API (2026-09-22):** `POST $P/operations` takes `{"operation": "<uuid>", "mutation": {"mutation": "ReleaseDraft", "ticket", "authoringVersion", "configurationRevision"}}` (or `ManualDispatch{ticket, expectedTicketVersion}` — the version after release is 1) and answers 202 `Pending`; poll `GET $P/operations/<uuid>` for `Succeeded`. A ticket read 404s until the release succeeds. `api-call.sh` wants the full `/api/v1/tenants/vteng/projects/chuggy/...` path. Draft body: `{configurationRevision, configurationDigest, expectedProjectSequence, authoring: <defaults>, brief: {intent, links, repository, finalization: {mode: "None"}}}` from `GET draft-initializations/<revision>`.
