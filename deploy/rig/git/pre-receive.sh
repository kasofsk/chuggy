#!/bin/sh
# The git service's pre-receive hook: what a credential may do to a ref, once
# nginx has admitted it to receive-pack. nginx decides whether a push is
# admitted at all and cannot see a ref; this decides which refs, and it decides
# per repository. `seed.sh` installs this file unchanged as `hooks/pre-receive`
# on every repository the service carries, and `audit-credentials.sh` exercises
# it there.
#
#   worker  may only CREATE a branch under
#           `refs/heads/chuggy/tickets/<ticket>/attempts/<attempt>`, so an agent
#           cannot move a branch another party reads.
#   mirror  may only update `refs/heads/main`, and never on `rig.git`. Creating
#           it is an update: a mirror's first push to an empty repository is
#           what makes the branch. Deleting it is not.
#   anyone  else is nginx's alone. The readers and writers files are the whole
#           of what admits them and this adds nothing, which is what keeps the
#           operator's break-glass a break-glass.
#
# `rig.git` is the mirror's exception because it mirrors nothing: Flux
# reconciles the cluster from its default branch — it is the URL of the
# GitRepository in `deploy/rig/git/bootstrap/flux.yaml`, and a push to that
# branch is the deploy — so a push that made it equal to some other
# repository's `main` would deploy that repository's tree.
#
# Exits 0 to accept the push, 1 to refuse it whole. Nothing here is a partial
# verdict: git applies no command from a refused push.
set -eu

zero=0000000000000000000000000000000000000000

# git runs a hook with the bare repository as its working directory, and that
# is the only place this is told which repository the push is for.
repository="$(pwd)"
repository="${repository##*/}"

case "${REMOTE_USER:-}" in
worker)
	while read -r old new ref; do
		if [ "$old" != "$zero" ] || [ "$new" = "$zero" ] \
			|| ! printf '%s\n' "$ref" | grep -Eq \
				'^refs/heads/chuggy/tickets/[0-9]+/attempts/[0-9a-f]{64}$'; then
			echo "worker may only create an attempt-scoped ticket branch" >&2
			exit 1
		fi
	done
	;;
mirror)
	if [ "$repository" = rig.git ]; then
		echo "mirror may not push to rig.git, which Flux deploys from" >&2
		exit 1
	fi
	while read -r old new ref; do
		if [ "$ref" != refs/heads/main ] || [ "$new" = "$zero" ]; then
			echo "mirror may only update main, and may not delete it" >&2
			exit 1
		fi
	done
	;;
esac
