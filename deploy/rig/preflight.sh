#!/bin/sh
# Everything a bring-up needs and cannot create for itself, named here so that
# the list is the list.
#
# THE VALUES CANNOT LIVE IN THIS REPOSITORY AND THE NAMES CAN. Every object
# below is a credential, a key or a served repository an operator issues by
# hand; what this script asks is whether each one is there, and what it prints
# when one is not is the symptom its absence causes. That is the whole of it:
# it creates nothing, reads no value out of any Secret, and changes nothing on
# the cluster.
#
# IT IS HERE BECAUSE NOTHING ELSE CLAIMS COMPLETENESS. A missing `grafana-admin`
# left its Deployment in `CreateContainerConfigError` for half a day on the
# installation this list was written from, because no procedure named it and no
# control looked for it. A checklist that is not run is a checklist that is not
# there, so this one fails closed: an object that is absent is a finding, and a
# finding is a non-zero status.
#
# ABSENT IS NOT UNREACHABLE. The two read the same to an operator and mean
# opposite things, so they leave by different statuses: the cluster is probed
# once before anything is looked for, and a probe that does not answer is a
# could-not-run that reports nothing absent. What this cannot separate is a
# namespace that is not there from one this identity may not read — both read
# as absent — so it is run with the operator's own credential.
#
# THE TWO FORGE APP KEYS ARE REQUIRED ON AN INSTALLATION THAT REACHES NO FORGE.
# The API, the finalizer and the scheduler each refuse to start on a key they
# cannot sign with, so the pods never become ready and nothing says why. Two
# throwaway RSA keys satisfy every precondition on an installation that mints
# nothing:
#
#   openssl genrsa -traditional -out portal.pem 4096
#   openssl genrsa -traditional -out worker.pem 4096
#
# `deploy/rig/forge/README.md` is what the real ones are for.
#
# WHAT IS DECLARED AND WHAT IS DERIVED. The fixed table below is this file's
# claim. The rest is asked of the estate itself — the Secrets the scheduler's
# `CHUG_SCHEDULER_WORKER_CREDENTIAL_MOUNTS` names, and the Secret the
# finalizer's `CHUG_FINALIZER_RECOVERY_EPOCH` is taken from — because a
# deployment that renames one of those renames it here too, and a list that had
# to be edited alongside would be a list that is wrong by the next release. A
# Deployment that is not there to be asked is itself a finding: this runs on an
# otherwise-deployed estate.
#
# Env:
#   CHUG_RIG_CONTEXT     kubectl context, default chuggy-fabric
#   CHUG_RIG_NAMESPACE   namespace holding the control plane, default chuggy
#   CHUG_RIG_WORK_NAMESPACE        where attempts run, default chuggy-work
#   CHUG_RIG_GIT_NAMESPACE         the git service, default chuggy-git
#   CHUG_RIG_ORY_NAMESPACE         Hydra, Kratos and Keto, default ory
#   CHUG_RIG_MONITORING_NAMESPACE  the monitoring stack, default monitoring
#   CHUG_RIG_GIT_REPOSITORY        the served repository a worker clones,
#                                  default chuggy.git
#
# Usage:
#   deploy/rig/preflight.sh
#
# Exits 0 clean, 1 when an object is absent, 2 when it could not run. Two is
# not a pass.
set -eu
export LC_ALL=C

context="${CHUG_RIG_CONTEXT:-chuggy-fabric}"
namespace="${CHUG_RIG_NAMESPACE:-chuggy}"
work_namespace="${CHUG_RIG_WORK_NAMESPACE:-chuggy-work}"
git_namespace="${CHUG_RIG_GIT_NAMESPACE:-chuggy-git}"
ory_namespace="${CHUG_RIG_ORY_NAMESPACE:-ory}"
monitoring_namespace="${CHUG_RIG_MONITORING_NAMESPACE:-monitoring}"
git_repository="${CHUG_RIG_GIT_REPOSITORY:-chuggy.git}"

# A refusal leaves by a status no tool under this script returns, so that a
# refusal raised inside a subshell arrives as a refusal rather than as a
# finding.
refused_status=97
say() { printf 'preflight: %s\n' "$*"; }
cannot() {
	printf 'preflight: LINTER ERROR — %s\n' "$*" >&2
	exit "$refused_status"
}
leave() {
	rc=$?
	trap - EXIT
	[ -z "$work" ] || rm -rf "$work"
	case "$rc" in
	0) exit 0 ;;
	"$refused_status") exit 2 ;;
	*) exit 1 ;;
	esac
}
work=""
trap leave EXIT

kube() { kubectl --context "$context" "$@"; }

command -v kubectl > /dev/null 2>&1 || cannot "no kubectl on PATH, so nothing was looked for"
command -v node > /dev/null 2>&1 || cannot "no node on PATH, and the credential mounts are read as JSON"

work="$(mktemp -d)" || cannot "no scratch directory could be made, so nothing was looked for"

# The one probe that separates an absent object from a cluster that did not
# answer. It asks for the version rather than for an object, so an identity
# with no rights over any namespace still reaches a verdict.
kube get --raw /version > /dev/null 2>&1 \
	|| cannot "the cluster at context $context did not answer, so nothing was looked for and nothing is absent"

# --- what is there ------------------------------------------------------------

absent=0
checked=0

namespaces="$namespace $work_namespace $git_namespace $ory_namespace $monitoring_namespace"
for candidate in $namespaces; do
	if [ -f "$work/secrets.$candidate" ]; then
		continue
	elif kube get namespace "$candidate" -o name > /dev/null 2>&1; then
		kube -n "$candidate" get secret \
			-o go-template='{{range .items}}{{.metadata.name}}{{"\n"}}{{end}}' \
			> "$work/secrets.$candidate" \
			|| cannot "the Secrets in namespace $candidate could not be listed, so what is there is unknown"
	else
		: > "$work/secrets.$candidate"
		printf '%s\n' "$candidate" >> "$work/namespaces-absent"
	fi
done

# One record per expected object: where it lives, what it is called, the keys
# it must carry, and what its absence looks like to an operator who does not
# know it is absent.
# A record the table already carries is not written twice: the estate names
# some of the same objects the table does, and an operator reading a name twice
# has to work out whether they are two objects.
expect() { # <namespace> <name> <comma-separated keys or -> <symptom>
	if [ -f "$work/expected" ] && grep -q "^$1|$2|" "$work/expected"; then
		return 0
	fi
	printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$work/expected"
}

expect "$namespace" chuggy-postgres-credentials \
	owner-password,ticket-service-password,api-password,scheduler-password,finalizer-password,worker-plane-password \
	"a control-plane process cannot authenticate as its own role and refuses to serve"
expect "$namespace" postgres-superuser password \
	"the roles cannot be created and no gate can reach the server"
expect "$namespace" chuggy-recovery-epoch - \
	"the finalizer refuses to start, and a repository binding has no epoch to be made under"
expect "$namespace" chuggy-finalizer-credentials - \
	"the finalizer resolves no credential for any repository and is refused at start-up"
expect "$namespace" chuggy-github-app-portal - \
	"the API and the finalizer refuse to start on a key they cannot sign with"
expect "$namespace" chuggy-github-app-worker - \
	"the scheduler refuses to start, and a worker claim answers ForgeNotConfigured"
expect "$namespace" tailnet-tls - \
	"the ingress serves no certificate and the console is unreachable by name"
expect "$work_namespace" chuggy-git-worker password \
	"an attempt pod is FailedMount and is never built"
expect "$ory_namespace" hydra - "the console's login is answered by nothing"
expect "$ory_namespace" kratos - "no identity can be registered or recovered"
expect "$ory_namespace" keto - "every project read is refused and the API is NOT READY"
expect "$ory_namespace" ory-ui - "the self-service screens do not come up"
expect "$monitoring_namespace" grafana-admin admin-user,admin-password \
	"Grafana's Deployment sits in CreateContainerConfigError, and nothing else reports it"

# --- what the estate names for itself -------------------------------------------

# The value of one variable on one Deployment, and nothing when the Deployment
# or the variable is not there — so a caller has to say what an absence means.
deployment_value() { # <deployment> <variable>
	kube -n "$namespace" get "deployment/$1" -o go-template="{{range .spec.template.spec.containers}}{{range .env}}{{if eq .name \"$2\"}}{{if .value}}{{.value}}{{end}}{{end}}{{end}}{{end}}" 2> /dev/null || true
}

# The Secret and key one variable is taken from, for a variable a Deployment
# supplies by reference rather than by value.
deployment_reference() { # <deployment> <variable>
	kube -n "$namespace" get "deployment/$1" -o go-template="{{range .spec.template.spec.containers}}{{range .env}}{{if eq .name \"$2\"}}{{with .valueFrom}}{{with .secretKeyRef}}{{.name}} {{.key}}{{end}}{{end}}{{end}}{{end}}{{end}}" 2> /dev/null || true
}

derived() { # <what>
	printf 'DERIVED  %s\n' "$1"
}

mounts="$(deployment_value chuggy-scheduler CHUG_SCHEDULER_WORKER_CREDENTIAL_MOUNTS)"
if [ -z "$mounts" ]; then
	derived "chuggy-scheduler names no CHUG_SCHEDULER_WORKER_CREDENTIAL_MOUNTS, so the credentials an attempt mounts could not be named"
	absent=$((absent + 1))
else
	printf '%s' "$mounts" > "$work/mounts.json"
	node -e 'const fs = require("node:fs");
const mounts = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const [credential, mount] of Object.entries(mounts))
  console.log(`${mount.secretName}|${mount.key}|${credential}`);' \
		"$work/mounts.json" > "$work/mounts.txt" \
		|| cannot "CHUG_SCHEDULER_WORKER_CREDENTIAL_MOUNTS is not the JSON object the scheduler reads, so what an attempt mounts is unknown"
	while IFS='|' read -r mount_secret mount_key credential; do
		[ -n "$mount_secret" ] || continue
		expect "$work_namespace" "$mount_secret" "$mount_key" \
			"the scheduler mounts it as the $credential credential, and an attempt that needs one is FailedMount"
	done < "$work/mounts.txt"
fi

epoch_reference="$(deployment_reference chuggy-finalizer CHUG_FINALIZER_RECOVERY_EPOCH)"
if [ -n "$epoch_reference" ]; then
	expect "$namespace" "${epoch_reference%% *}" "${epoch_reference##* }" \
		"the finalizer is the estate's record of which epoch is current, and a binding made under another one is refused"
elif [ -z "$(deployment_value chuggy-finalizer CHUG_FINALIZER_RECOVERY_EPOCH)" ]; then
	derived "chuggy-finalizer names no CHUG_FINALIZER_RECOVERY_EPOCH, so the current recovery epoch could not be read"
	absent=$((absent + 1))
fi

# --- the report ------------------------------------------------------------------

# A Secret's keys, which are asked for only once the Secret is known to be
# there: a key list is what separates a Secret somebody created empty from one
# that carries what reads it.
secret_keys() { # <namespace> <name>
	kube -n "$1" get secret "$2" \
		-o go-template='{{range $key, $value := .data}}{{$key}}{{"\n"}}{{end}}' 2> /dev/null || true
}

while IFS='|' read -r object_namespace object_name object_keys symptom; do
	checked=$((checked + 1))
	if ! grep -qxF "$object_name" "$work/secrets.$object_namespace"; then
		printf 'ABSENT   %s/%s — %s\n' "$object_namespace" "$object_name" "$symptom"
		absent=$((absent + 1))
		continue
	fi
	held="$(secret_keys "$object_namespace" "$object_name")"
	lacking=""
	if [ "$object_keys" != "-" ]; then
		for key in $(printf '%s' "$object_keys" | tr ',' ' '); do
			printf '%s\n' "$held" | grep -qxF "$key" || lacking="$lacking $key"
		done
	fi
	if [ -n "$lacking" ]; then
		printf 'INCOMPLETE %s/%s — carries no%s; %s\n' \
			"$object_namespace" "$object_name" "$lacking" "$symptom"
		absent=$((absent + 1))
	else
		printf 'present  %s/%s\n' "$object_namespace" "$object_name"
	fi
done < "$work/expected"

if [ -f "$work/namespaces-absent" ]; then
	while read -r missing; do
		printf 'ABSENT   namespace %s — everything above in it reads as absent for that reason alone\n' "$missing"
	done < "$work/namespaces-absent"
fi

# --- the served repository --------------------------------------------------------

# Not a Secret, and the one object here whose presence is not the whole of the
# question. A bare repository made with `git init --bare` carries
# `HEAD -> refs/heads/master`, and a push of a `main` branch leaves that HEAD
# naming a ref the repository does not have: a clone of it has no working tree
# and `git rev-parse HEAD` in it fails on an ambiguous argument, which is what
# an attempt meets rather than a clone it can work in. So HEAD is resolved as
# well as the directory looked for, and a repository with no commits yet is not
# held to it.
checked=$((checked + 1))
if grep -qxF "$git_namespace" "${work}/namespaces-absent" 2> /dev/null; then
	printf 'ABSENT   %s/%s — the git service namespace is not there, so a worker clone has nowhere to go\n' \
		"$git_namespace" "$git_repository"
	absent=$((absent + 1))
else
	verdict="$(kube -n "$git_namespace" exec deployment/git -- sh -c '
		set -eu
		[ -d "/git/$1" ] || { echo absent; exit 0; }
		git -C "/git/$1" rev-parse --verify --quiet HEAD > /dev/null && { echo ok; exit 0; }
		[ -n "$(git -C "/git/$1" for-each-ref --count=1 refs/heads)" ] || { echo empty; exit 0; }
		git -C "/git/$1" symbolic-ref HEAD
	' _ "$git_repository" 2> /dev/null || true)"
	case "$verdict" in
	ok | empty) printf 'present  %s/%s\n' "$git_namespace" "$git_repository" ;;
	absent)
		printf 'ABSENT   %s/%s — a worker clone fails at attempt time\n' "$git_namespace" "$git_repository"
		absent=$((absent + 1))
		;;
	'')
		cannot "the git service in namespace $git_namespace could not be reached, so whether $git_repository is there is unknown"
		;;
	*)
		printf 'INCOMPLETE %s/%s — HEAD names %s, which this repository does not have; a clone of it has no working tree\n' \
			"$git_namespace" "$git_repository" "$verdict"
		absent=$((absent + 1))
		;;
	esac
fi

say "$absent absent or incomplete, across $checked expected object(s)"
[ "$absent" -eq 0 ] || say "nothing above was created; each is the operator's to issue"
[ "$absent" -eq 0 ]
