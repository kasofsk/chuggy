#!/bin/sh
# Remove what attempts left on the workers' server, and nothing a live attempt
# is still using.
#
# WHAT LEAVES ANYTHING BEHIND. An attempt drops its own role and every database
# that role owns when it ends, and `images/worker/termination.mjs` makes a
# cancelled one do the same. What neither reaches is a container killed rather
# than signalled — SIGKILL when the grace period runs out, or a node that stops
# — and what it leaves is a role owning databases no pod names any more.
#
# THE CLUSTER DECIDES WHAT IS LIVE, NOT AN AGE OR A NAME. There is no creation
# time on a role or a database to sweep by, and a name says which attempt made
# something rather than whether that attempt is still running. So the scopes
# the worker pods carry are read first and every one of them is left alone;
# what is dropped is what no pod claims. A run with the namespace unreachable
# drops nothing, because an empty pod list and a namespace that could not be
# asked look identical here and only one of them means "sweep everything".
#
# DATABASES BEFORE THE ROLE THAT OWNS THEM. Dropping a role that still owns one
# is refused, so each role's databases go first; `WITH (FORCE)` is what removes
# one a connection is still open to, and a gate that died mid-run is exactly
# that.
#
# Usage:
#   deploy/rig/postgres/sweep-worker-databases.sh            # report only
#   deploy/rig/postgres/sweep-worker-databases.sh --remove   # and remove them
#
# Env:
#   KUBECONFIG                  the cluster to ask; the default is the caller's
#   CHUG_SWEEP_NAMESPACE        where the worker pods run. Default chuggy-work
#   CHUG_SWEEP_SERVER_NAMESPACE where the server pod runs. Default chuggy
#   CHUG_SWEEP_SERVER_POD       the server pod. Default postgres-0
#
# Exits 0 clean, 1 when something could not be removed, 2 when it could not run.
# Two is not a pass.
set -eu
export LC_ALL=C

remove=0
case "${1:-}" in
	--remove) remove=1 ;;
	"") ;;
	*) echo "sweep-worker-databases: LINTER ERROR — expected --remove or no argument" >&2; exit 2 ;;
esac

work_namespace="${CHUG_SWEEP_NAMESPACE:-chuggy-work}"
server_namespace="${CHUG_SWEEP_SERVER_NAMESPACE:-chuggy}"
server_pod="${CHUG_SWEEP_SERVER_POD:-postgres-0}"

command -v kubectl >/dev/null 2>&1 || {
	echo "sweep-worker-databases: LINTER ERROR — no kubectl on PATH, so what is live cannot be established" >&2
	exit 2
}

# The scopes live pods carry. A namespace that cannot be asked is unknown
# rather than empty, and unknown sweeps nothing.
if ! live="$(kubectl -n "$work_namespace" get pods \
	-o jsonpath='{range .items[*]}{range .spec.containers[0].env[?(@.name=="CHUG_WORKER_DATABASE_SCOPE")]}{.value}{"\n"}{end}{end}' 2>/dev/null)"; then
	echo "sweep-worker-databases: LINTER ERROR — could not list pods in $work_namespace; nothing was swept" >&2
	exit 2
fi

psql() { # <sql>
	kubectl -n "$server_namespace" exec "$server_pod" -- \
		psql -U postgres -d postgres -tAc "$1"
}

if ! roles="$(psql "SELECT rolname FROM pg_roles WHERE rolname ~ '^chug_[0-9a-f]{32}\$' ORDER BY rolname")"; then
	echo "sweep-worker-databases: LINTER ERROR — could not ask $server_pod which roles it holds" >&2
	exit 2
fi

swept=0
failed=0
for role in $roles; do
	if printf '%s\n' "$live" | grep -Fqx "$role"; then
		echo "sweep-worker-databases: $role is a live attempt's, left alone"
		continue
	fi
	owned="$(psql "SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = '$role'" || true)"
	printf 'sweep-worker-databases: %s is claimed by no pod' "$role"
	if [ -n "$owned" ]; then
		printf ', owning %s' "$(printf '%s' "$owned" | tr '\n' ' ')"
	fi
	printf '\n'
	swept=$((swept + 1))
	[ "$remove" -eq 1 ] || continue
	for database in $owned; do
		psql "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || failed=$((failed + 1))
	done
	psql "DROP ROLE IF EXISTS \"$role\"" >/dev/null || failed=$((failed + 1))
done

if [ "$failed" -gt 0 ]; then
	echo "sweep-worker-databases: $failed statement(s) failed"
	exit 1
fi
if [ "$remove" -eq 1 ]; then
	echo "sweep-worker-databases: removed $swept abandoned attempt(s)"
else
	echo "sweep-worker-databases: $swept abandoned attempt(s); pass --remove to drop them"
fi
