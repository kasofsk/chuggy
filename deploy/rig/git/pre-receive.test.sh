#!/bin/sh
# Shell test for pre-receive.sh, over what it decides and no more: which user
# may move which ref, in which repository.
#
# IT IS DRIVEN BY GIT, NOT BY THE HOOK'S STDIN. Bare repositories in a temp
# directory, a real `git push` at each of them, and `REMOTE_USER` exported
# around it the way the service exports it — nginx passes the authenticated
# user to git-http-backend, which puts it in the hook's environment. What is
# read afterwards is the refs the repository actually carries: a hook that
# printed a refusal and let the push through would pass a test that read only
# the message.
#
# THE ACCEPTING CASES MATTER AS MUCH. A hook that refuses everything is the
# same defect wearing the other face, so every refusal here has a mirror case
# where the same user moves the ref it is allowed to move, and one where a user
# the hook says nothing about is not stopped.
#
# NOTHING HERE REACHES A CLUSTER. There is no kubectl, no ingress and no
# credential: the wall driven here is the hook alone. The credential half —
# whom nginx admits to receive-pack at all — is `audit-credentials.sh`'s, and
# needs a rig.
#
# Run:  ./deploy/rig/git/pre-receive.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../../.chug/tasks/_suite.sh"
SUT="$HERE/pre-receive.sh"

SERVED="$WORK/git"
mkdir -p "$SERVED"

# The pusher's side: two commits, so an update of an existing branch is a real
# movement rather than a no-op.
SRC="$WORK/src"
fresh_repo "$SRC"
: > "$SRC/one"
git -C "$SRC" add one
git -C "$SRC" commit -qm one
FIRST="$(git -C "$SRC" rev-parse HEAD)"
: > "$SRC/two"
git -C "$SRC" add two
git -C "$SRC" commit -qm two
SECOND="$(git -C "$SRC" rev-parse HEAD)"

# A commit on no shared history with either, fetched into the pusher's object
# store: what a rewrite of the branch looks like from the serving side.
REWRITE="$WORK/rewrite"
fresh_repo "$REWRITE"
: > "$REWRITE/rewritten"
git -C "$REWRITE" add rewritten
git -C "$REWRITE" commit -qm rewritten
REWRITTEN="$(git -C "$REWRITE" rev-parse HEAD)"
git -C "$SRC" fetch -q "$REWRITE" HEAD

# The hook reads the attempt as sha256 hex, and this suite has no opinion about
# what a real attempt identifier is, so an object name doubled and cut to
# length does.
ATTEMPT="$(printf '%s%s' "$FIRST" "$FIRST" | cut -c1-64)"
ATTEMPT_REF="refs/heads/chuggy/tickets/7/attempts/$ATTEMPT"

# A bare repository under the served root, carrying the hook. Seeded with a
# main when a commit is named: the seeding push carries no REMOTE_USER, the arm
# the hook says nothing about, so no fixture is built by a rule under test.
stand_up() { # <name> [<commit>]
	rm -rf "$SERVED/$1"
	git init --bare -q -b main "$SERVED/$1"
	cp "$SUT" "$SERVED/$1/hooks/pre-receive"
	chmod 0755 "$SERVED/$1/hooks/pre-receive"
	if [ "$#" -ge 2 ]; then
		git -C "$SRC" push -q "$SERVED/$1" "$2:refs/heads/main"
	fi
}

# A push as <user>, or as nobody when the user is `-`. What the repository
# holds afterwards goes into the same output, so a case asserts the state and
# not only what was said about it.
push() { # <user> <repository> <refspec>...
	OUT="$WORK/.out"
	_user="$1"
	_repo="$2"
	shift 2
	set +e
	if [ "$_user" = "-" ]; then
		(
			unset REMOTE_USER
			exec git -C "$SRC" push "$SERVED/$_repo" "$@"
		) > "$OUT" 2>&1
	else
		REMOTE_USER="$_user" git -C "$SRC" push "$SERVED/$_repo" "$@" > "$OUT" 2>&1
	fi
	RC=$?
	set -e
	_main="$(git -C "$SERVED/$_repo" rev-parse --verify --quiet refs/heads/main || true)"
	printf -- '--- %s afterwards: main is %s\n' "$_repo" "${_main:-absent}" >> "$OUT"
	git -C "$SERVED/$_repo" for-each-ref --format='%(refname) %(objectname)' >> "$OUT"
}

# --- the mirror, on a repository that is not rig.git -------------------------

stand_up other.git "$FIRST"
push mirror other.git "$SECOND:refs/heads/main"
check "the mirror moves main" 0 "$RC" "other.git afterwards: main is $SECOND"

stand_up other.git
push mirror other.git "$SECOND:refs/heads/main"
check "the mirror creates main on an empty repository" 0 "$RC" \
	"other.git afterwards: main is $SECOND"

# A mirror follows its source, and a source's main can be rewritten, so the
# hook asks nothing about ancestry. The refspec is forced because the pusher
# refuses to send this one otherwise, and it is the server's answer that is
# under test.
stand_up other.git "$FIRST"
push mirror other.git "+$REWRITTEN:refs/heads/main"
check "the mirror rewrites main onto unrelated history" 0 "$RC" \
	"other.git afterwards: main is $REWRITTEN"

stand_up other.git "$FIRST"
push mirror other.git "$SECOND:refs/heads/release"
check "the mirror may not create a branch beside main" 1 "$RC" \
	"mirror may only update main"
check "the branch beside main is not there" 1 "$RC" \
	"other.git afterwards: main is $FIRST"

stand_up other.git "$FIRST"
push mirror other.git ":refs/heads/main"
check "the mirror may not delete main" 1 "$RC" "mirror may only update main"
check "main survives the attempted delete" 1 "$RC" \
	"other.git afterwards: main is $FIRST"

stand_up other.git "$FIRST"
push mirror other.git "$SECOND:refs/tags/v1"
check "the mirror may not push a tag" 1 "$RC" "mirror may only update main"

# The hook refuses the whole push, so a ref it would allow does not ride along
# with one it would not.
stand_up other.git "$FIRST"
push mirror other.git "$SECOND:refs/heads/main" "$SECOND:refs/heads/release"
check "one refused ref refuses the push whole" 1 "$RC" \
	"other.git afterwards: main is $FIRST"

# --- the mirror, on rig.git --------------------------------------------------

stand_up rig.git "$FIRST"
push mirror rig.git "$SECOND:refs/heads/main"
check "the mirror may not move rig.git's main" 1 "$RC" \
	"mirror may not push to rig.git"
check "rig.git's main is where it was" 1 "$RC" "rig.git afterwards: main is $FIRST"

stand_up rig.git "$FIRST"
push mirror rig.git "$SECOND:refs/heads/side"
check "the mirror may not push any ref to rig.git" 1 "$RC" \
	"mirror may not push to rig.git"

# --- the worker, which the mirror arm leaves alone ---------------------------

stand_up other.git "$FIRST"
push worker other.git "$SECOND:$ATTEMPT_REF"
check "the worker creates an attempt branch" 0 "$RC" "$ATTEMPT_REF $SECOND"

stand_up other.git "$FIRST"
push worker other.git "$SECOND:refs/heads/main"
check "the worker may not move main" 1 "$RC" \
	"worker may only create an attempt-scoped ticket branch"
check "main survives the worker's push" 1 "$RC" \
	"other.git afterwards: main is $FIRST"

stand_up rig.git "$FIRST"
push worker rig.git "$SECOND:$ATTEMPT_REF"
check "the worker's attempt branch is no rig.git exception" 0 "$RC" \
	"$ATTEMPT_REF $SECOND"

stand_up other.git "$FIRST"
git -C "$SRC" push -q "$SERVED/other.git" "$SECOND:$ATTEMPT_REF"
push worker other.git ":$ATTEMPT_REF"
check "the worker may not delete an attempt branch" 1 "$RC" \
	"worker may only create an attempt-scoped ticket branch"

# Create-only means the branch an attempt already made is closed to it, and
# nothing else in this suite refuses a worker for that reason alone: the pushes
# above are refused by their ref name as well.
stand_up other.git "$FIRST"
git -C "$SRC" push -q "$SERVED/other.git" "$FIRST:$ATTEMPT_REF"
push worker other.git "$SECOND:$ATTEMPT_REF"
check "the worker may not move an attempt branch it made" 1 "$RC" \
	"worker may only create an attempt-scoped ticket branch"
check "the attempt branch keeps what it was created at" 1 "$RC" \
	"$ATTEMPT_REF $FIRST"

# The attempt segment is a sha256, and a ref that is attempt-shaped without
# being attempt-named is the shape a loosened pattern would admit.
stand_up other.git "$FIRST"
push worker other.git "$SECOND:refs/heads/chuggy/tickets/7/attempts/not-a-sha256"
check "the worker may not name an attempt something else" 1 "$RC" \
	"worker may only create an attempt-scoped ticket branch"

# --- everyone else, whom nginx alone decides ---------------------------------

stand_up rig.git "$FIRST"
push operator rig.git "$SECOND:refs/heads/main"
check "a named user the hook says nothing about moves rig.git's main" 0 "$RC" \
	"rig.git afterwards: main is $SECOND"

stand_up rig.git "$FIRST"
push - rig.git "$SECOND:refs/heads/side"
check "an unnamed pusher makes the branch the mirror may not" 0 "$RC" \
	"refs/heads/side $SECOND"

done_ pre-receive.test.sh
