## Setup (every 8b task)

You are launched in your own git worktree cut from `origin/main` (02bd9572, "Merge pull request #733"; confirm `git log -1 --oneline`). Bash is pinned to that worktree: do not `cd` into, or `git -C`, any other checkout. Absolute-path reads with the Read tool are fine.

- Branch: `git checkout -b <your branch>` (A, S) or `git fetch origin <branch> && git checkout <branch>` (B), once, as setup.
- `node_modules`: `ln -s /Users/david/chuggy/node_modules node_modules` (its lockfile equals 02bd9572's). If that is refused, `npm ci` at the root. **Never** `npm ci` under `ui/`.
- Every gate and test command runs with `PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH" TMPDIR=/tmp FORCE_COLOR=0 NO_COLOR=1`. Capture a gate's output to a file and echo its real exit code; never pipe a gate through `tail`.
- Effort dir: `/Users/david/chuggy-effort/ticket-language/` (read with Read). If unreadable, the same files are at `git show origin/handoff/ticket-language-2026-09-22:effort/ticket-language/<path>`. The package is at `/Users/david/chuggy-effort/ticket-language/package/` (76c95a9); if unreadable, `git clone -q https://github.com/kasofsk/chug-ticket-domain /tmp/pkg-$$ && git -C /tmp/pkg-$$ checkout -q 76c95a9`.
- The previous orchestrator's working notes (traps, false reds, migration recipes) are on the handoff branch: `git show origin/handoff/ticket-language-2026-09-22:memory/<name>.md`, e.g. `chuggy-false-reds.md`, `migrations-render-literals.md`, `migrations-edited-in-place.md`. Paths inside them are another machine's.
- Commits: small, in the tree's voice, ending `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never `--no-verify` unless the tree cannot compile until another task lands, and say so in the report. Do not push; the orchestrator pushes after reading your commits.
- Report: reply with the report's full text as your final message (the orchestrator files it). Do not write into the effort dir.
