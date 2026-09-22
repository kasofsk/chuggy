---
name: finalizer-pr-landing-traps
description: "PullRequest landings on the rig hold silently without CHUG_FINALIZER_FORGE_BINDINGS; the minted GitHub token was longer than the forge credential bound (fixed chuggy #676); PR landing was never exercised end to end before 2026-09-17"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7094dd0e-8c29-45ea-8e39-cdbf937e969c
  modified: 2026-09-17T01:50:08.455Z
---

Two traps found 2026-09-17 when ticket 71 (the first PullRequestMerge ticket driven on the rig) sat in Finalizing forever:

1. **No forge binding → silent hold.** The rig's finalizer (fabric `cluster/apps/chuggy-finalizer.yaml`) had the App id and key but no `CHUG_FINALIZER_FORGE_BINDINGS`. `forgeBindingOf` finds nothing for github.com, the pass holds `ProposalDenied`, the claim is renewed, and nothing is logged (telemetry sink is silent; the root logs only starting/ready/stopped). The candidate is already promoted to its branch by then. Binding shape: `[{"forge":"github","repositoryHost":"github.com","apiHost":"api.github.com","credentialReference":"portal-app"}]`, no `path` because the host's credential is minted. Fabric #240 added it, #241 reverted it while the bound was wrong, #244 re-applied it once chuggy 9162378a was on the rig (fabric #243). Ticket 71 then landed as kasofsk/chuggy#677 at 2026-09-17 01:59Z.
2. **Minted token past the credential bound → crash loop.** With the binding, `asForgeCredential` refused GitHub's ~390-char installation token at the 256 identity bound and the finalizer process died on every pass (CrashLoopBackOff). Fixed in chuggy #676 (bound is `repositoryCredentialCharsMax`, 4096).

**How to diagnose a silent hold:** run a second finalizer in the pod for ~40 s with a preload that rewrites `silentFinalizerMetrics` in `/srv/chuggy/src/interpreter/finalizerTelemetry.ts` to print; it names the hold. Remove the preload after.

**Why:** the PR path had only ever run in tests; nothing on the rig had opened a PR under the App before. See [[ticket-chain-decision-2026-09-16]], [[pr-merge-landing-2026-09-13]].

**How to apply:** any new finalizer deployment needs the bindings env; treat "Finalizing with the branch on the forge and no PR" as a binding/credential problem first.
