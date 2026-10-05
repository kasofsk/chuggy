# A Keto for a gate to run against, acquired the same way for every gate that
# needs one.
#
# Contract for a sourcing gate (source as "$here/_keto.sh" via a $here resolved
# from $0 before any cd, as `_postgres.sh` prescribes; the sourcing gate sets
# its own shell options):
#   call      keto_acquire <message prefix>
#   provides  $keto_read_url    the read API a client should ask
#             $keto_write_url   the write API a client should write to
#             $keto_subject     what the verdict line should name
#             keto_release      for the caller's EXIT trap, set before the call
#   exits     2 through the caller's shell when no server can be had
#   claims    its working names — the knobs below, $keto_prefix, $keto_waited,
#             $keto_model, $keto_digest, $keto_running, $keto_started_from,
#             $keto_binary, $keto_version, $keto_port, $keto_refusal,
#             $keto_remedy, $keto_exit, $keto_pid, $keto_log — in the sourcing
#             gate's namespace
#
# THE SERVER IS A CONTAINER THE SOURCING GATES OWN, started under a name
# nothing else uses and on ports that are not the conventional ones, so a Keto
# a developer is running is never asked and never stopped. One already running
# under that name is reused, because a gate that pays a cold start every run is
# a gate that gets bypassed.
#
# WHERE THERE IS NO DOCKER IT IS THE `keto` ON PATH, STARTED FOR THIS RUN AND
# STOPPED BY `keto_release`. A process has no cold start worth keeping it for,
# and one that does not outlive its run cannot be answering about a model the
# tree no longer states. It is started from the same two files, bound to
# loopback, and in an environment holding only what points it there, so nothing
# the caller's environment names reaches it. The verdict names the version the
# binary states, and no version is refused.
#
# ITS PORTS ARE ITS OWN, BELOW THE RANGE THE KERNEL HANDS TO OUTGOING
# CONNECTIONS (`net.ipv4.ip_local_port_range`, where a box has not widened it).
# The container's are inside that range, and there a gate that ran just before
# can have left one end of a loopback connection on one of them. Keto cannot
# bind such a port; it stays up, serves its other API and says nothing until it
# is stopped, so the run waits out its cap on a server that is never coming.
# The container keeps its ports all the same: it outlives runs and every
# worktree on a box shares it, so a tree with other defaults would wait on a
# port the running one is not published on.
#
# A PORT THE PROCESS COULD NOT LISTEN ON IS A COULD-NOT-RUN, SAID BEFORE IT IS
# STARTED. The test is the bind Keto itself makes. Asking whether something
# answers there misses the port the paragraph above is about, which refuses a
# listener and accepts nothing; a port something does answer on is refused for
# a second reason, that the wait would be answered by whoever holds it.
#
# A REUSED CONTAINER IS ONE STARTED FROM THIS MODEL. Keto compiles
# `keto/namespaces.ts` at start-up and the bind mount is not live, so a
# container that outlived a change to the model keeps answering about the model
# it booted with — agreement reported as a verdict about a model the tree no
# longer states. The digest of `keto/keto.yml` and `keto/namespaces.ts` is a
# label on the container, and one whose label differs is removed and started
# again rather than reused.
#
# IT HOLDS NOTHING BETWEEN RUNS. `dsn: memory` in `keto/keto.yml` means the
# tuples a suite writes live in the process, so a reused container carries the
# previous run's tuples — which is why every suite addresses objects nothing
# else does rather than trusting an empty server.
#
# A SERVER THAT DOES NOT ANSWER, OR ANSWERS WITHOUT THE MODEL, IS A
# COULD-NOT-RUN. Readiness alone would pass a server carrying some other
# namespace file, and every check against it would then answer `false` — a
# suite of refusals reported as findings about the adapter. So the wait ends
# only when both namespaces the model declares are listable.
#
# Env:
#   CHUG_KETO_READ_URL   run against this read API instead, starting nothing;
#                        CHUG_KETO_WRITE_URL is then required, because a suite
#                        writes the tuples it reads
#   CHUG_KETO_WRITE_URL  the write API beside it
#   CHUG_KETO_IMAGE      the image a container is started from
#   CHUG_KETO_READ_PORT  the host port the read API of either is on
#   CHUG_KETO_WRITE_PORT the host port the write API of either is on
#   CHUG_KETO_READY_SECS how long to wait for the server to answer
#
# The container outlives the run so the next one is warm. To remove it:
#   docker rm -f chuggy-check-keto

keto_image="${CHUG_KETO_IMAGE:-oryd/keto:v26.2.0}"
keto_read_port="${CHUG_KETO_READ_PORT:-54466}"
keto_write_port="${CHUG_KETO_WRITE_PORT:-54467}"
keto_ready_secs="${CHUG_KETO_READY_SECS:-30}"
keto_container="chuggy-check-keto"
keto_model_label="chuggy.keto.model"
keto_model_query="{{index .Config.Labels \"$keto_model_label\"}}"
# How much of what a process said is printed when it never answers.
keto_log_lines=5
keto_pid=""
keto_log=""

# The digest of the model a container would be started from, printing nothing
# when the model cannot be read.
keto_model_digest() { # <model directory>
	node -e '
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const digest = createHash("sha256");
for (const file of ["keto.yml", "namespaces.ts"])
  digest.update(readFileSync(`${process.argv[1]}/${file}`));
console.log(digest.digest("hex"));
' "$1" 2>/dev/null
}

# Whether an API answers ready AND carries every namespace named, printing
# nothing: a message names the URL the caller already has.
keto_probe() { # <url> [<namespace>...]
	node -e '
const [url, ...namespaces] = process.argv.slice(1);
const at = new URL(url);
const ask = async (path) => {
  const response = await fetch(new URL(path, at), {
    signal: AbortSignal.timeout(2000),
  });
  return response.ok;
};
try {
  if (!(await ask("./health/ready"))) process.exit(1);
  for (const namespace of namespaces)
    if (!(await ask(`./relation-tuples?namespace=${namespace}&page_size=1`)))
      process.exit(1);
} catch {
  process.exit(1);
}
' "$@" 2>/dev/null
}

keto_wait() { # <read url>
	keto_waited=0
	until keto_probe "$1" Project Tenant; do
		if [ "$keto_waited" -ge "$keto_ready_secs" ]; then
			return 1
		fi
		sleep 1
		keto_waited=$((keto_waited + 1))
	done
	return 0
}

# Whether a loopback port can be listened on, printing why when it cannot.
# Node's listener sets SO_REUSEADDR as Go's does, so this refuses what Keto
# would be refused and nothing else: without it, the port of a listener stopped
# a moment ago would be refused here and bound by Keto.
keto_port_free() { # <port>
	node -e '
const server = require("node:net").createServer();
server.on("error", (error) => {
  console.log(error.code);
  process.exit(1);
});
server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());
' "$1" 2>/dev/null
}

# Whether something accepts a connection on a loopback port.
keto_port_taken() { # <port>
	node -e '
const net = require("node:net");
const socket = net.connect(Number(process.argv[1]), "127.0.0.1");
socket.setTimeout(2000);
socket.on("connect", () => socket.destroy());
socket.on("timeout", () => socket.destroy());
socket.on("error", () => process.exit(1));
' "$1" 2>/dev/null
}

keto_stop() {
	kill "$keto_pid" 2>/dev/null || true
	wait "$keto_pid" 2>/dev/null || true
}

# Stops the process this run started and removes its log. A container is left
# running, and a run that started nothing has nothing to stop.
keto_release() {
	[ -n "$keto_pid" ] || return 0
	keto_stop
	rm -f "$keto_log"
	keto_pid=""
}

keto_answer() { # <url>
	if keto_probe "$1"; then echo "answers ready"; else echo "does not answer ready"; fi
}

keto_acquire_process() {
	keto_model="$(git rev-parse --show-toplevel)/.chug/tasks/keto"
	keto_version="$("$keto_binary" version 2>/dev/null | sed -n 's/^Version:[[:space:]]*//p')"
	keto_subject="keto${keto_version:+ $keto_version} from PATH"
	# From here on these are the process's own, so that the test, the start,
	# the wait and every message name one pair of ports.
	keto_read_port="${CHUG_KETO_READ_PORT:-24466}"
	keto_write_port="${CHUG_KETO_WRITE_PORT:-24467}"
	keto_read_url="http://127.0.0.1:$keto_read_port/"
	keto_write_url="http://127.0.0.1:$keto_write_port/"

	for keto_port in "$keto_read_port" "$keto_write_port"; do
		if keto_refusal="$(keto_port_free "$keto_port")"; then
			continue
		fi
		if keto_port_taken "$keto_port"; then
			keto_refusal="something is already listening on port $keto_port, and this run did not start it."
			keto_remedy="Stop what holds it"
		else
			keto_refusal="port $keto_port cannot be listened on${keto_refusal:+ ($keto_refusal)}, and nothing listens there to stop."
			keto_remedy="One end of a connection holds a port so while it is open and for a while after; run again then"
		fi
		echo "$keto_prefix: LINTER ERROR — $keto_refusal"
		echo "$keto_prefix:                No CHUG_KETO_READ_URL and no docker, so $keto_binary would be started on ports $keto_read_port and $keto_write_port."
		echo "$keto_prefix:                $keto_remedy, or set CHUG_KETO_READ_PORT and CHUG_KETO_WRITE_PORT."
		exit 2
	done

	if ! keto_log="$(mktemp 2>/dev/null)"; then
		echo "$keto_prefix: LINTER ERROR — no temporary file for the log of $keto_binary"
		exit 2
	fi
	env -i \
		NAMESPACES_LOCATION="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$keto_model/namespaces.ts")" \
		SERVE_READ_HOST=127.0.0.1 SERVE_READ_PORT="$keto_read_port" \
		SERVE_WRITE_HOST=127.0.0.1 SERVE_WRITE_PORT="$keto_write_port" \
		SERVE_METRICS_HOST=127.0.0.1 SERVE_METRICS_PORT=0 \
		SERVE_OPL_HOST=127.0.0.1 SERVE_OPL_PORT=0 \
		"$keto_binary" serve --sqa-opt-out -c "$keto_model/keto.yml" \
		>"$keto_log" 2>&1 </dev/null &
	keto_pid=$!
	echo "$keto_prefix: started $keto_subject on ports $keto_read_port and $keto_write_port"

	if ! keto_wait "$keto_read_url"; then
		echo "$keto_prefix: LINTER ERROR — $keto_subject did not answer ready with both namespaces within ${keto_ready_secs}s"
		echo "$keto_prefix:                No CHUG_KETO_READ_URL and no docker, so $keto_binary was started from $keto_model."
		if kill -0 "$keto_pid" 2>/dev/null; then
			echo "$keto_prefix:                It is still running: its read API $(keto_answer "$keto_read_url") and its write API $(keto_answer "$keto_write_url")."
		else
			keto_exit=0
			wait "$keto_pid" 2>/dev/null || keto_exit=$?
			echo "$keto_prefix:                It exited with status $keto_exit."
		fi
		# Stopped before its log is read: a port Keto could not bind is the last
		# thing it says, and it says it only as it exits. A Keto that came up
		# says nothing at all, so an empty log is not reported.
		keto_stop
		if [ -s "$keto_log" ]; then
			echo "$keto_prefix:                The last it said:"
			tail -n "$keto_log_lines" "$keto_log"
		fi
		exit 2
	fi
}

keto_acquire() { # <message prefix>
	keto_prefix="$1"

	if ! command -v node >/dev/null 2>&1; then
		echo "$keto_prefix: LINTER ERROR — no node, so nothing can run"
		exit 2
	fi

	if [ -n "${CHUG_KETO_READ_URL:-}" ]; then
		if [ -z "${CHUG_KETO_WRITE_URL:-}" ]; then
			echo "$keto_prefix: LINTER ERROR — CHUG_KETO_READ_URL names a server with no CHUG_KETO_WRITE_URL beside it."
			echo "$keto_prefix:                A suite writes the tuples it reads, so both are needed."
			exit 2
		fi
		keto_read_url="$CHUG_KETO_READ_URL"
		keto_write_url="$CHUG_KETO_WRITE_URL"
		keto_subject="the server CHUG_KETO_READ_URL names"
		if ! keto_wait "$keto_read_url"; then
			echo "$keto_prefix: LINTER ERROR — nothing ready with both namespaces answered CHUG_KETO_READ_URL within ${keto_ready_secs}s"
			echo "$keto_prefix:                Point it at a Keto running .chug/tasks/keto/namespaces.ts, or unset it to have one started."
			exit 2
		fi
		return 0
	fi

	if ! command -v docker >/dev/null 2>&1; then
		keto_binary="$(command -v keto || true)"
		if [ -z "$keto_binary" ]; then
			echo "$keto_prefix: LINTER ERROR — no docker and no keto on PATH, so no authority can be started."
			echo "$keto_prefix:                Set CHUG_KETO_READ_URL and CHUG_KETO_WRITE_URL to test against one you have."
			exit 2
		fi
		keto_acquire_process
		return 0
	fi
	if ! docker info >/dev/null 2>&1; then
		echo "$keto_prefix: LINTER ERROR — docker is installed but not running."
		echo "$keto_prefix:                Set CHUG_KETO_READ_URL and CHUG_KETO_WRITE_URL to test against an authority you have."
		exit 2
	fi

	keto_model="$(git rev-parse --show-toplevel)/.chug/tasks/keto"
	# `|| true` so the guard below is what reports a model that cannot be read,
	# rather than the sourcing gate's own `set -e` ending the run unexplained.
	keto_digest="$(keto_model_digest "$keto_model" || true)"
	if [ -z "$keto_digest" ]; then
		echo "$keto_prefix: LINTER ERROR — no model to start an authority from at $keto_model"
		exit 2
	fi
	keto_running="$(docker inspect -f '{{.State.Running}}' "$keto_container" 2>/dev/null || echo false)"
	keto_started_from="$(docker inspect -f "$keto_model_query" "$keto_container" 2>/dev/null || true)"
	if [ "$keto_running" = "true" ] && [ "$keto_started_from" != "$keto_digest" ]; then
		echo "$keto_prefix: $keto_container carries another model, so it is started again"
		keto_running=false
	fi
	if [ "$keto_running" = "true" ]; then
		echo "$keto_prefix: reusing $keto_container on ports $keto_read_port and $keto_write_port"
	else
		docker rm -f "$keto_container" >/dev/null 2>&1 || true
		if ! docker run -d --name "$keto_container" \
			--label "$keto_model_label=$keto_digest" \
			-v "$keto_model/keto.yml:/etc/keto/keto.yml:ro" \
			-v "$keto_model/namespaces.ts:/etc/keto/namespaces.ts:ro" \
			-p "$keto_read_port:4466" -p "$keto_write_port:4467" \
			"$keto_image" serve -c /etc/keto/keto.yml >/dev/null 2>&1; then
			echo "$keto_prefix: LINTER ERROR — could not start $keto_image as $keto_container"
			exit 2
		fi
		echo "$keto_prefix: started $keto_container on ports $keto_read_port and $keto_write_port"
	fi
	# Read back from the container rather than from CHUG_KETO_IMAGE, which says
	# what a fresh start would have used and not what a reused one is running.
	keto_subject="$(docker inspect -f '{{.Config.Image}}' "$keto_container" 2>/dev/null || echo "$keto_image")"
	keto_read_url="http://127.0.0.1:$keto_read_port/"
	keto_write_url="http://127.0.0.1:$keto_write_port/"

	if ! keto_wait "$keto_read_url"; then
		echo "$keto_prefix: LINTER ERROR — $keto_container did not answer ready with both namespaces within ${keto_ready_secs}s"
		echo "$keto_prefix:                docker logs $keto_container says why; the model is .chug/tasks/keto/namespaces.ts."
		exit 2
	fi
}
