#!/bin/sh
# The git service's pre-receive hook: what a credential may do to a ref, once
# nginx has admitted it to receive-pack. nginx decides whether a push is
# admitted at all and cannot see a ref; this decides which refs. `seed.sh`
# installs this file unchanged as `hooks/pre-receive` on every repository the
# service carries.
#
#   worker  may only CREATE a branch under
#           `refs/heads/chuggy/tickets/<ticket>/attempts/<attempt>`, so an agent
#           cannot move a branch another party reads.
#   anyone  else is nginx's alone. The readers and writers files are the whole
#           of what admits them and this adds nothing, which is what keeps the
#           operator's break-glass a break-glass.
#
# Exits 0 to accept the push, 1 to refuse it whole. Nothing here is a partial
# verdict: git applies no command from a refused push.
set -eu

[ "${REMOTE_USER:-}" = worker ] || exit 0
zero=0000000000000000000000000000000000000000
while read -r old new ref; do
	if [ "$old" != "$zero" ] || [ "$new" = "$zero" ] || \
		! printf '%s\n' "$ref" | grep -Eq \
		'^refs/heads/chuggy/tickets/[0-9]+/attempts/[0-9a-f]{64}$'; then
		echo "worker may only create an attempt-scoped ticket branch" >&2
		exit 1
	fi
done
