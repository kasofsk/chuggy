#!/bin/sh
# The vendored ticket package is the pinned package, byte for byte.
#
# Every tracked file under `model/task-contract/` and `model/ticket-domain/` is
# a copy of the package's own file at the pin, and `model/vendored.sha256` is
# the pin: the package's repository, the commit, the command that produced the
# digests in a clone at that commit, and one sha256 per file. A file whose
# digest differs, a tracked file there the manifest does not list, a listed file
# that is not tracked, and a row outside those two directories are each a
# finding. A pin bump is a new manifest and a
# re-vendored tree, never a hand edit to either.
#
# WHAT IT CANNOT SEE is the upstream repository. It holds the tree to the
# manifest; that the manifest is the package at that commit is re-derived by
# running the recorded command in a clone.
#
# Exits 0 clean, 1 on a finding, 2 when it could not run. Two is not a pass.
set -eu
export LC_ALL=C

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
	echo "check-vendored: LINTER ERROR — not a git checkout" >&2
	exit 2
fi
cd "$root" || exit 2

manifest="model/vendored.sha256"
if [ ! -r "$manifest" ]; then
	echo "check-vendored: LINTER ERROR — cannot read $manifest; there is no pin to hold"
	exit 2
fi

# Probed by hashing, because `command -v` says a binary exists, not that it
# runs. macOS ships `shasum` and no `sha256sum`.
if printf '' | sha256sum >/dev/null 2>&1; then
	hash_file() { sha256sum <"$1"; }
elif printf '' | shasum -a 256 >/dev/null 2>&1; then
	hash_file() { shasum -a 256 <"$1"; }
else
	echo "check-vendored: LINTER ERROR — neither sha256sum nor shasum runs, so nothing can be hashed"
	exit 2
fi

for field in repository pin command; do
	if ! grep -q "^# $field ." "$manifest"; then
		echo "check-vendored: LINTER ERROR — $manifest names no $field; it is not a pin"
		exit 2
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

grep -v '^#' "$manifest" >"$work/rows" || true
if [ ! -s "$work/rows" ]; then
	echo "check-vendored: LINTER ERROR — $manifest lists no file"
	exit 2
fi
if grep -v -E '^[0-9a-f]{64}  [^ ]+$' "$work/rows" >"$work/malformed"; then
	echo "check-vendored: LINTER ERROR — $manifest has rows that are not '<sha256>  <path>':"
	sed 's/^/    /' "$work/malformed"
	exit 2
fi

findings=0
listed=0
while read -r want path; do
	listed=$((listed + 1))
	if [ ! -f "$path" ]; then
		echo "ERROR $path: listed in $manifest and not in the tree"
		findings=$((findings + 1))
		continue
	fi
	if ! got="$(hash_file "$path")"; then
		echo "check-vendored: LINTER ERROR — could not hash $path"
		exit 2
	fi
	got="${got%% *}"
	if [ "$got" != "$want" ]; then
		echo "ERROR $path: sha256 $got, pinned $want"
		findings=$((findings + 1))
	fi
done <"$work/rows"

cut -c67- "$work/rows" | sort >"$work/listed"
git ls-files -- model/task-contract model/ticket-domain | sort >"$work/tracked"
comm -13 "$work/listed" "$work/tracked" >"$work/unlisted"
while read -r path; do
	echo "ERROR $path: vendored and not in $manifest"
	findings=$((findings + 1))
done <"$work/unlisted"
# A listed file only the working tree holds passes every check above and is
# absent from the commit, so a clone of it fails where this checkout passed.
comm -23 "$work/listed" "$work/tracked" >"$work/untracked"
while read -r path; do
	case "$path" in
	model/task-contract/* | model/ticket-domain/*)
		echo "ERROR $path: listed in $manifest and not tracked by git" ;;
	*)
		echo "ERROR $path: listed in $manifest outside the vendored directories" ;;
	esac
	findings=$((findings + 1))
done <"$work/untracked"

echo "check-vendored: $findings finding(s) across $listed pinned file(s)"
[ "$findings" -eq 0 ]
