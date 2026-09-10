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
#   exits     2 through the caller's shell when no server can be had
#   claims    its working names — the knobs below, $keto_prefix, $keto_waited,
#             $keto_model, $keto_digest, $keto_running, $keto_started_from —
#             in the sourcing gate's namespace
#
# THE SERVER IS A CONTAINER THE SOURCING GATES OWN, started under a name
# nothing else uses and on ports that are not the conventional ones, so a Keto
# a developer is running is never asked and never stopped. One already running
# under that name is reused, because a gate that pays a cold start every run is
# a gate that gets bypassed.
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
#   CHUG_KETO_READ_URL   run against this read API instead, skipping the
#                        container entirely; CHUG_KETO_WRITE_URL is then
#                        required, because a suite writes the tuples it reads
#   CHUG_KETO_WRITE_URL  the write API beside it
#   CHUG_KETO_IMAGE      the image to start
#   CHUG_KETO_READ_PORT  the host port its read API is published on
#   CHUG_KETO_WRITE_PORT the host port its write API is published on
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

# Whether the read API answers ready AND carries both namespaces, printing
# nothing: a message names the URL the caller already has.
keto_probe() { # <read url>
	node -e '
const at = new URL(process.argv[1]);
const ask = async (path) => {
  const response = await fetch(new URL(path, at), {
    signal: AbortSignal.timeout(2000),
  });
  return response.ok;
};
try {
  if (!(await ask("./health/ready"))) process.exit(1);
  for (const namespace of ["Project", "Tenant"])
    if (!(await ask(`./relation-tuples?namespace=${namespace}&page_size=1`)))
      process.exit(1);
} catch {
  process.exit(1);
}
' "$1" 2>/dev/null
}

keto_wait() { # <read url>
	keto_waited=0
	until keto_probe "$1"; do
		if [ "$keto_waited" -ge "$keto_ready_secs" ]; then
			return 1
		fi
		sleep 1
		keto_waited=$((keto_waited + 1))
	done
	return 0
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
			echo "$keto_prefix:                Point it at a Keto running .chug/tasks/keto/namespaces.ts, or unset it to use a container."
			exit 2
		fi
		return 0
	fi

	if ! command -v docker >/dev/null 2>&1; then
		echo "$keto_prefix: LINTER ERROR — no docker, so no authority can be started."
		echo "$keto_prefix:                Set CHUG_KETO_READ_URL and CHUG_KETO_WRITE_URL to test against one you have."
		exit 2
	fi
	if ! docker info >/dev/null 2>&1; then
		echo "$keto_prefix: LINTER ERROR — docker is installed but not running."
		echo "$keto_prefix:                Set CHUG_KETO_READ_URL and CHUG_KETO_WRITE_URL to test against an authority you have."
		exit 2
	fi

	keto_model="$(git rev-parse --show-toplevel)/.chug/tasks/keto"
	keto_digest="$(keto_model_digest "$keto_model")"
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
