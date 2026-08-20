#!/bin/sh
# Shell test for rehearse.sh, over what it names here and no more: the stdin the
# `kubectl` stub below does and does not take, the mode an archive full of
# verifiers is held to, the digest and receipt comparisons standing between
# `verify` and `destroy`, the inventory `restore` needs before it can say
# anything about what came back, the derivation `epoch` holds the establish to,
# the witness partition every later stage reads, what `teardown` observes before
# it says anything, and what a status from a tool underneath is worth by the
# time it leaves.
#
# WHY IT IS A SUITE AND NOT A RIG RUN. Every guard here was once written so that
# the absence of the thing being checked read as agreement: a digest taken
# through a pipeline, a receipt searched rather than parsed, an inventory
# nothing derived an expectation from, a partition half-read. A rig run says
# they hold on the day it is run; only a suite stops the shape returning.
# `.chug/tasks/check-gates.sh` does not reach this directory, but
# `.chug/tasks/ci.sh` discovers suites tree-wide, so every `just check` runs
# this one under the same per-suite cap and shared budget as the rest: a case
# here that waited on anything real would cost another suite its run.
#
# NOTHING HERE TALKS TO A CLUSTER, and the cases whose subject is a refusal that
# comes first require that nothing reached one. `kubectl` is a stub on `PATH`
# that logs every invocation, and the context, namespace and database are named
# so that even a stub that was missed would resolve against no rig.
#
# THE MIRROR CASES MATTER AS MUCH. A guard that refuses everything is the same
# defect wearing the other face, so each refusal has a case where the thing
# being checked is there and the stage goes on.
#
# Run:  ./deploy/rig/durability/rehearse.test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../../.chug/tasks/_suite.sh"
SUT="$HERE/rehearse.sh"

BIN="$WORK/bin"
SHIM="$WORK/shim"
A="$WORK/archive"
LOG="$WORK/kubectl.log"
REPLIES="$WORK/replies"
FAKE="$(printf '%064d' 0)"
mkdir -p "$BIN"

cat > "$BIN/kubectl" << 'STUB'
#!/bin/sh
# The cluster as far as this suite lets the script see it. Every invocation is
# appended to the log, and an `exec` takes the next line of the replies file as
# what the server said: `-` for nothing at all, `!` for a call that never
# landed, `!` and a number for one that came back with a status of its own. It
# decides nothing a server decides; it supplies an answer so the shell around
# it can be judged.
set -u

# One line per invocation, so the log's length is how many calls were made and
# its order is the order they were made in. A remote command arrives carrying
# its own newlines, and unflattened it would count as several calls.
{
	printf '%s' "$*" | tr '\n' ' '
	printf '\n'
} >> "$CHUG_STUB_LOG"
case " $* " in
*' exec '*) ;;
*) exit 0 ;;
esac

# `kubectl exec` attaches stdin only when it is asked to, and the bare `exec`
# calls in the script under test ask for none. A stub that drained stdin for
# those would be draining the suite's own, which on a terminal never ends. So
# the flag is looked for ahead of the `--` and a `-i` behind it is not one —
# and the cut is taken on a plain variable, because `${*%%…}` is not a string
# operation on the joined arguments: bash removes the suffix from each
# positional parameter and joins afterwards, so an argument list in which no
# single argument holds the pattern comes back whole and nothing is cut.
invocation=" $* "
case " ${invocation%% -- *} " in
*' -i '*) cat > /dev/null ;;
esac
served="$CHUG_STUB_LOG.served"
printf 'x\n' >> "$served"
reply="$(sed -n "$(wc -l < "$served")p" "$CHUG_STUB_REPLIES" 2> /dev/null || true)"
case "$reply" in
'!') exit 1 ;;
'!'[0-9]*) exit "${reply#!}" ;;
'-' | '') ;;
*) printf '%s\n' "$reply" ;;
esac
STUB
chmod +x "$BIN/kubectl"

fresh_case() {
	rm -rf "$A" "$SHIM"
	mkdir -p "$A" "$SHIM"
	# The script refuses an archive the rest of the host can read, so a fixture
	# left at the suite's umask would fail every case for the wrong reason.
	chmod 700 "$A"
	: > "$LOG"
	: > "$REPLIES"
	rm -f "$LOG.served"
}

run() { # <stage>
	OUT="$WORK/.out"
	set +e
	env PATH="$SHIM:$BIN:$PATH" \
		CHUG_RIG_ARCHIVE="$A" \
		CHUG_RIG_CONTEXT=no-such-context \
		CHUG_RIG_NAMESPACE=no-such-namespace \
		CHUG_RIG_DATABASE=fixture \
		CHUG_STUB_LOG="$LOG" CHUG_STUB_REPLIES="$REPLIES" \
		sh "$SUT" "$1" > "$OUT" 2>&1
	RC=$?
	set -e
	printf 'the cluster was reached %s time(s)\n' "$(wc -l < "$LOG" | tr -d ' ')" >> "$OUT"
}

also() { # <path> — fold a file the run wrote into what the assertions read
	if [ -f "$1" ]; then
		echo "--- $1" >> "$OUT"
		cat "$1" >> "$OUT"
	else
		echo "--- $1 was never written" >> "$OUT"
	fi
}

# The verbs the stub was called with, in call order — `kube` puts the context
# and the namespace ahead of the verb, so the verb is the field after the
# namespace. Folded into the output as one line because an assertion here is a
# substring of what the run printed, and an order is not a substring of
# anything until something states it.
calls() {
	echo "the calls, in order: $(awk '{ for (i = 1; i < NF; i++) if ($i == "-n") { print $(i + 2); break } }' "$LOG" | tr '\n' ' ')" >> "$OUT"
}

untouched="the cluster was reached 0 time(s)"

# --- the stub's stdin, which is the suite's own ------------------------------

# The stub takes stdin on the flag and not on the remote command behind the
# `--`, and no other case here can see which: no remote command in the script
# under test carries a ` -i ` for the flag test to mistake for one, so removing
# that test would change nothing any case below reports. What a stub that took
# a stdin it was never given does is not fail — it stalls, on a terminal for as
# long as the terminal is open. These two hand it a file, so the one that
# proves the drain cannot stall either.
stub_stdin() { # <args...> — what the stub left of a stdin it was handed
	OUT="$WORK/.out"
	printf 'unread\n' > "$WORK/.stdin"
	{
		set +e
		env CHUG_STUB_LOG="$WORK/.stdin.log" CHUG_STUB_REPLIES=/dev/null \
			"$BIN/kubectl" "$@" > /dev/null 2>&1
		RC=$?
		set -e
		printf 'the stub left: [%s]\n' "$(cat)"
	} < "$WORK/.stdin" > "$OUT"
}

stub_stdin exec podname -- env CHUG_HOST=h sh -c 'exec pg_restore -i /tmp/x.dump'
check "the stub leaves stdin alone for a -i behind the --" 0 "$RC" "the stub left: [unread]"

stub_stdin exec -i podname -- sh -c 'exec psql'
check "the stub takes stdin for a -i ahead of the --" 0 "$RC" "the stub left: []"

# --- the archive: credential material before it is anything else -------------

# `globals.sql` carries every login role's SCRAM verifier, so the mode of the
# directory it is written into is what stands between the dump and the rest of
# the host. It refuses before a stage is so much as dispatched. Every other
# case here is its mirror: none of them reaches a guard without `fresh_case`
# having made the mode right.
fresh_case
chmod 755 "$A"
run destroy
check "an archive the rest of the host can read is refused" 2 "$RC" "carries every login role's verifier"
check "a widened archive reaches nothing" 2 "$RC" "$untouched"

# --- destroy: the ordering this script exists to enforce ---------------------

fresh_case
run destroy
check "destroy without a receipt refuses" 2 "$RC" "no receipt in"
check "destroy without a receipt reaches nothing" 2 "$RC" "$untouched"

# The reachable half-tidy the archive invites: the dump deleted, the receipt
# left behind. Behind a pipeline the missing dump left an empty string as the
# digest, and an empty needle is one every haystack contains.
fresh_case
printf 'dump-sha256 %s\n' "$FAKE" > "$A/verified.txt"
run destroy
check "destroy refuses when the dump is gone and the receipt is not" 2 "$RC" "is missing or empty"
check "destroy with no dump reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'dump-sha256 %s\n' "$FAKE" > "$A/verified.txt"
: > "$A/fixture.dump"
run destroy
check "destroy refuses an empty dump" 2 "$RC" "is missing or empty"
check "destroy with an empty dump reaches nothing" 2 "$RC" "$untouched"

# A sha256sum that printed something other than a digest. Behind the pipeline
# the caller could not tell that from a digest it had.
fresh_case
printf 'dump-sha256 %s\n' "$FAKE" > "$A/verified.txt"
printf 'a dump\n' > "$A/fixture.dump"
cat > "$SHIM/sha256sum" << 'STUB'
#!/bin/sh
printf 'not a digest  %s\n' "$1"
STUB
chmod +x "$SHIM/sha256sum"
run destroy
check "destroy refuses a digest that is not hex" 2 "$RC" "printed no digest"
check "destroy with no hex digest reaches nothing" 2 "$RC" "$untouched"

# A receipt that names no digest on a line of its own. The form that searched
# the whole receipt agreed with one that merely mentioned the digest anywhere.
fresh_case
printf 'a dump\n' > "$A/fixture.dump"
{
	echo "this dump restored into a scratch database whose inventory matched the live one"
	sha256sum "$A/fixture.dump"
} > "$A/verified.txt"
run destroy
check "destroy refuses a receipt naming no digest" 2 "$RC" "names no digest"
check "destroy with an unnamed digest reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'dump-sha256 %s\n' "$FAKE" > "$A/verified.txt"
run destroy
check "destroy refuses a receipt written for another dump" 2 "$RC" "written for a different dump"
check "destroy with the wrong digest reaches nothing" 2 "$RC" "$untouched"

# The mirror: the receipt names the dump that is there, so the stage goes on.
# The server is given nothing to say, and the refusal `destroy` reports is
# required rather than displayed.
fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'dump-sha256 %s\n' "$(sha256sum "$A/fixture.dump" | cut -d' ' -f1)" > "$A/verified.txt"
run destroy
check "destroy accepts the receipt for the dump that is there" 1 "$RC" "was not refused"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'dump-sha256 %s\n' "$(sha256sum "$A/fixture.dump" | cut -d' ' -f1)" > "$A/verified.txt"
printf -- '-\n-\n-\nFATAL:  database "fixture" does not exist\n' > "$REPLIES"
run destroy
check "destroy takes the refusal the server gives it" 0 "$RC" "a connection to it is refused"

# --- the statuses underneath, which are not this script's to spend -----------

# `psql` spends 2 on a connection it could not make and 3 on a statement the
# server refused under ON_ERROR_STOP; `kubectl exec` propagates the remote
# status and `set -e` carries it out. A 2 arriving that way is the status this
# script spends on a refusal that touched nothing — and here it arrives at the
# read-back after `DROP DATABASE`, where nothing could be further from true.
fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'dump-sha256 %s\n' "$(sha256sum "$A/fixture.dump" | cut -d' ' -f1)" > "$A/verified.txt"
printf -- '!2\n' > "$REPLIES"
run destroy
check "a connection destroy could not make leaves as a finding" 1 "$RC" "the cluster was reached 1 time(s)"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'dump-sha256 %s\n' "$(sha256sum "$A/fixture.dump" | cut -d' ' -f1)" > "$A/verified.txt"
printf -- '!3\n' > "$REPLIES"
run destroy
check "a statement the server refused leaves as a finding" 1 "$RC" "the cluster was reached 1 time(s)"

# --- epoch: the derivation the establish is held to --------------------------

# With no recovery_epoch row count there is nothing to derive an expectation
# from, and the stage refuses while refusing is still free.
fresh_case
printf 'rows|project|7\n' > "$A/inventory-restored.txt"
run epoch
check "epoch refuses an inventory with no recovery_epoch row count" 2 "$RC" "carries no recovery_epoch row count"
check "epoch with nothing to derive reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'rows|project|7\nrows|recovery_epoch|3\n' > "$A/inventory-restored.txt"
run epoch
also "$A/inventory-expected-after-epoch.txt"
check "epoch derives before it establishes" 2 "$RC" "recorded no epoch"
check "the derivation adds one recovery_epoch row" 2 "$RC" "rows|recovery_epoch|4"
check "the derivation moves nothing else" 2 "$RC" "rows|project|7"
check "the derivation reaches nothing" 2 "$RC" "$untouched"

# A host with no source of an unpredictable identifier. The guard that stood
# here compared the prefixed string, which is non-empty whatever the
# substitution did, so what a missing source met was `set -e`.
fresh_case
printf 'rows|recovery_epoch|3\n' > "$A/inventory-restored.txt"
cat > "$SHIM/cat" << 'STUB'
#!/bin/sh
exit 1
STUB
cat > "$SHIM/uuidgen" << 'STUB'
#!/bin/sh
exit 1
STUB
chmod +x "$SHIM/cat" "$SHIM/uuidgen"
run epoch
check "epoch refuses a host with no uuid source" 2 "$RC" "no source of an unpredictable epoch"
check "a host with no uuid source reaches nothing" 2 "$RC" "$untouched"

# --- restore: the inventory it compares against, and the witness partition ---

# The comparison `restore` is for is against the inventory `snapshot` took, and
# with that file gone `diff` reports a difference like any other. A one there
# says the restore came back wrong; what is true is that nobody ever recorded
# what right was, and by then the database has already been replaced.
fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'tenant t\n' > "$A/witness-before.txt"
printf 'tenant t\nproject p\n' > "$A/witness-partition.txt"
run restore
check "restore refuses when there is no live inventory to compare against" 2 "$RC" "no live inventory to compare against"
check "restore with nothing to compare against reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'rows|project|7\n' > "$A/inventory-live.txt"
printf 'tenant t\n' > "$A/witness-before.txt"
run restore
check "restore refuses when snapshot recorded no partition" 2 "$RC" "there is no witness recorded in"
check "restore without a partition reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'rows|project|7\n' > "$A/inventory-live.txt"
printf 'tenant t\n' > "$A/witness-before.txt"
printf 'tenant t\n' > "$A/witness-partition.txt"
run restore
check "restore refuses a partition naming only the tenant" 2 "$RC" "names no partition"
check "restore with half a partition reaches nothing" 2 "$RC" "$untouched"

fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'rows|project|7\n' > "$A/inventory-live.txt"
printf 'tenant t\n' > "$A/witness-before.txt"
printf 'project p\n' > "$A/witness-partition.txt"
run restore
check "restore refuses a partition naming only the project" 2 "$RC" "names no partition"
check "restore with the other half reaches nothing" 2 "$RC" "$untouched"

# The mirror: the inventory and both fields are there, so the stage goes on to
# the cluster and fails on the comparison instead of before it.
fresh_case
printf 'a dump\n' > "$A/fixture.dump"
printf 'rows|project|7\n' > "$A/inventory-live.txt"
printf 'tenant t\n' > "$A/witness-before.txt"
printf 'tenant t\nproject p\n' > "$A/witness-partition.txt"
run restore
check "restore accepts a live inventory and a partition naming both fields" 1 "$RC" "what came back is not what was dumped"

# --- teardown: a line that reports what it observed --------------------------

# The order is the property, not the line: the read-back is only worth anything
# through a session the pod is still up to serve, and the refusal on a surviving
# scratch database is only true because the pod outlives it.
fresh_case
printf -- '-\n-\n' > "$REPLIES"
run teardown
calls
check "teardown reads the drop back before the pod goes" 0 "$RC" "the calls, in order: exec exec delete"
check "teardown says the drop is gone from pg_database" 0 "$RC" "gone from pg_database"

fresh_case
printf -- '-\nfixture_restore_check\n' > "$REPLIES"
run teardown
check "teardown refuses a scratch database that survived the drop" 1 "$RC" "survived the drop"

fresh_case
printf -- '!\n' > "$REPLIES"
run teardown
calls
check "teardown says so when no session can be opened" 0 "$RC" "no session could be opened to drop"
check "teardown reads nothing back through a session that never opened" 0 "$RC" "the calls, in order: exec delete"

done_ "rehearse.test.sh"
