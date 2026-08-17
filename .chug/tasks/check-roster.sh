#!/bin/sh
# Every practice `.claude/settings.json` enables resolves: installed, enabled,
# and with its files on disk. A name resolving to nothing reads, to a reader and
# to an agent told to invoke it, exactly like one that resolves.
#
# The installed list carries a row per scope and rows about other checkouts, so
# it is filtered to the ones applying here and a name resolves when any of them
# has it enabled. Keying by name would let array order stand in for precedence.
#
# Exits 0 when every one resolves and 2 otherwise. There is no finding state: an
# unresolved name is a machine that has not been provisioned, not a tree that is
# wrong, and 2 is not a pass either way.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-roster: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

settings=".claude/settings.json"
if [ ! -r "$settings" ]; then
	echo "check-roster: LINTER ERROR — cannot read $settings"
	exit 2
fi

for tool in node claude; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "check-roster: LINTER ERROR — no $tool, so the roster cannot be resolved"
		exit 2
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# From the CLI rather than the plugin cache, which is private state with no
# contract this tree can rely on.
if ! claude plugin list --json >"$work/installed.json" 2>/dev/null; then
	echo "check-roster: LINTER ERROR — could not list installed plugins"
	exit 2
fi

resolved="$(node -e '
const fs = require("fs")
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const enabled = settings.enabledPlugins || {}
const declared = Object.keys(enabled).filter((id) => enabled[id] === true)
const installed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
if (!Array.isArray(installed)) { console.log("badlist -"); process.exit(0) }
const root = process.argv[3]
// Resolved, or a checkout reached through a symlink reports one path to git
// and another to the CLI.
const sameTree = (path) => {
  if (path === root) { return true }
  try { return fs.realpathSync(path) === fs.realpathSync(root) } catch { return false }
}
const mine = installed.filter(
  (plugin) => plugin.projectPath == null || sameTree(plugin.projectPath),
)
for (const id of declared) {
  const rows = mine.filter((plugin) => plugin.id === id)
  if (rows.length === 0) { console.log("absent " + id); continue }
  const live = rows.filter((plugin) => plugin.enabled === true)
  if (live.length === 0) { console.log("disabled " + id); continue }
  if (!live.some((plugin) => plugin.installPath && fs.existsSync(plugin.installPath))) {
    console.log("missing-files " + id); continue
  }
  console.log("ok " + id)
}
' "$settings" "$work/installed.json" "$root" 2>/dev/null || true)"

case "$resolved" in
badlist*)
	echo "check-roster: LINTER ERROR — the installed plugins came back as something other than a list"
	exit 2
	;;
esac

if [ -z "$resolved" ]; then
	echo "check-roster: LINTER ERROR — $settings declares no enabled practice, or could not be read"
	exit 2
fi

findings=0
count=0
IFS='
'
for row in $resolved; do
	count=$((count + 1))
	status="${row%% *}"
	id="${row#* }"
	case "$status" in
	ok) ;;
	absent)
		echo "ERROR $id: declared by $settings, not installed on this machine"
		findings=$((findings + 1))
		;;
	disabled)
		echo "ERROR $id: installed but disabled, so nothing can invoke it"
		findings=$((findings + 1))
		;;
	*)
		echo "ERROR $id: installed, but its files are not on disk"
		findings=$((findings + 1))
		;;
	esac
done
unset IFS

if [ "$findings" -gt 0 ]; then
	echo "check-roster: LINTER ERROR — $findings of $count declared practice(s) did not resolve"
	echo "check-roster: one is installed with: claude plugin install <name>@<marketplace>"
	exit 2
fi

echo "check-roster: $count declared practice(s) resolve"
