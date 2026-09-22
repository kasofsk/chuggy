---
name: blessed-practices-main-reset
description: kasofsk/blessed-practices main was reset backwards by the quilbert bot; restored 2026-08-19 but main is still unprotected
metadata:
  type: project
---

`kasofsk/blessed-practices` publishes the 8 practice plugins that chuggy's
`.claude/settings.json` declares, at commit `12389882` ("Publish the practices as
a plugin marketplace", 2026-08-15). A bot account **`quilbert`** ("Wizard's
Magical Quill") repeatedly reset that repo's `main` back to `6cb8c995`
(2026-03-30), which has no `.claude-plugin/marketplace.json` — on 2026-08-16
(also deleting the `plugin-marketplace` and `layering-and-domain-modelling`
branches) and again on 2026-08-18 after davemo88 restored it on 2026-08-17.

**Resolved 2026-08-19**: main is back at `12389882` and this machine installs the
8 plugins from the real GitHub source. **But `main` is still unprotected**, so the
bot can reset it again. If `check-roster` starts failing, check
`gh api repos/kasofsk/blessed-practices/commits/main` first — if it reads
`6cb8c995`, the bot has struck again and davemo88 must fast-forward it back
(Geoff's `gdoteof` account has `push: false` there; he contributed PR #2 from a
fork). `12389882` stays fetchable by SHA even when unreachable from any ref, so a
local clone checked out there and registered as a directory marketplace is the
stopgap.

**Why:** without the marketplace on `main`, the 8 plugins cannot install and
`.chug/tasks/check-roster.sh` exits 2, which makes `just check` exit 2 for
everyone. The gate is correct; the source was broken.

**How to apply:** never "fix" this by trimming `.claude/settings.json` — that
would falsify CLAUDE.md's claim that settings.json is the roster. Note that
**`claude plugin uninstall` and `claude plugin marketplace remove` silently edit
the tracked project `.claude/settings.json`**, emptying `enabledPlugins` and
`extraKnownMarketplaces`. After any uninstall in this repo, check `git status`
and `git checkout -- .claude/settings.json`. Installs write to *user* settings,
so the tracked file only ever needs restoring, never re-adding.
See [[scoped-iteration-gates]] for when a full `ci.sh` run is warranted.
