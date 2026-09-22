# PR 5 release recipe (the first with a wipe)

1. Merge PR; `git pull`; note sha.
2. Dump: `ssh geoff@192.168.0.114 'kubectl -n chuggy exec postgres-0 -- pg_dump -U postgres -Fc chuggy > /home/geoff/backups/chuggy-pre-<sha>.dump'`.
3. Phase 1: `CHUG_RIG_SSH=geoff@192.168.0.114 deploy/rig/deploy-to-gtr.sh` → fabric PR; mechanical diff check.
4. Scale down the seven chuggy deployments to 0 (`kubectl -n chuggy scale deploy chuggy-{api,finalizer,scheduler,selector,ticket-service,worker-plane,ui} --replicas=0`), wait for pods gone. Suspend the importer/activation cronjobs if they write ticket tables (check).
5. Wipe: copy `deploy/rig/wipe-tickets.sql` to the rig, run as the owner: `kubectl -n chuggy exec -i postgres-0 -- psql -U chuggy_owner chuggy < wipe-tickets.sql` (the owner's password: see how the migrate job connects, `CHUG_MIGRATE_DATABASE_URL`; postgres superuser is fine too). Verify: `select count(*) from journal_entry; select head, ticket_next from project;`.
6. Merge fabric PR; reconcile source+kustomization; the migrate job applies 008 on the empty journal; flux restores replicas? — NO: flux applies the manifests' replica counts, which brings the deployments back. Confirm rollout status for all seven.
7. Sanity: console 200; tickets page empty; create a draft via the API (`POST $P/drafts` with the initialization body — see api-call.sh usage in pr3) and release it; watch it reach Work (scheduler picks it up; a worker pod appears). `GET $P/tickets/<n>` shows `phase` and no `escalation`. Importer job completes on the new image.
8. Record in GOAL.md, SPIKE Landed, memory, artifact.
