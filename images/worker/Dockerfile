# The zod the image installs as the agent SDK's peer. It is declared before any
# stage because two of them read it: the `core` stage holds it to the core's
# lock and the `runtime` stage installs it.
ARG ZOD_VERSION=4.5.4

# The Track Record the image ships, declared here for the same reason: the
# `track-record` stage builds it and the `worker` stage holds the binary to it.
ARG TRACK_RECORD_VERSION=0.1.0

# The base every stage builds from. The image one attempt runs in is built by
# the fabric, in a pod whose only way out of the cluster is public HTTPS on
# 443.
#
# THAT IS WHY THE BASE IS NOT THE SLIM ONE, AND WHY THE SOURCES ARE REWRITTEN.
# Debian's apt fetches over port 80, which that pod cannot reach — the packages
# below resolve and then fail to connect. Fetching them over 443 instead needs a
# CA store to verify the server with, and the slim base has none at all: no
# ca-certificates package, no /etc/ssl/certs. So the base is the one that ships
# it, and the sources are moved to HTTPS before anything is fetched. Disabling
# apt's peer verification would have kept the slim base and traded the transport
# away for it, which is a weakening nothing here needs.
#
# THE BASE IS TRIXIE BECAUSE THE MODEL GATE NEEDS ITS LIBC. `quint test` and
# `quint run` execute through the Rust evaluator quint fetches on first use, a
# binary linked against a glibc newer than bookworm's: on bookworm every model
# suite ends in QNT516 and `check-model` cannot run, which is not a pass, so no
# ticket touching the model could ever pass evaluation here.
#
# The digest is the multi-architecture index's, read on 2026-09-17 with
#   docker buildx imagetools inspect node:26.7.0-trixie
FROM node:26.7.0-trixie@sha256:40fd8249a701dab7431d15074ac4cf4f1c18eecd713807599cd76a7a6caad48b AS base

# The node chuggy's runtime runs the core on: Node 24, an LTS release, and not
# the base's. Node 26 also needs libatomic.so.1, which debian:trixie-slim,
# ubuntu:24.04 and even buildpack-deps:trixie-scm do not ship, so chuggy's node
# would not load in any of them.
# The official image's node is nodejs.org's own build, which that image's
# build verifies against the release's signed checksums, so it is taken from
# the image by digest rather than fetched and verified a second time here.
#
# The digest is the multi-architecture index's, read on 2026-10-15 with
#   docker buildx imagetools inspect node:24.22.0-trixie-slim
FROM node:24.22.0-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 AS runtime-node

# Track Record's client, installed by `go install` at its module's tag, whose
# content the Go checksum database holds to what every install of that tag
# gets. It is built without cgo, so the binary links against no library; it
# runs the `git` and `sh` it finds on PATH, and trusts the image's CA store.
#
# The digest is the multi-architecture index's, read on 2026-10-15 with
#   docker buildx imagetools inspect golang:1.27.2-trixie
FROM golang:1.27.2-trixie@sha256:47667934874913a449b96faa7ef4777fa285d9ec29126ee80ed61c45b7cccf0e AS track-record
ARG TRACK_RECORD_VERSION
RUN CGO_ENABLED=0 go install -trimpath \
    "github.com/kasofsk/track-record/cmd/track-record@v${TRACK_RECORD_VERSION}"

# The worker core: kasofsk/chuggy-common at the commit `core.json` pins, which
# `core.sh` fetches and refuses unless that commit is on the core's main. Only
# what the later stages copy leaves this one: the core's tree, for its suites;
# its shipped set, which is `package.json`'s `files` read off that tree rather
# than listed here, less the `check.sh` a job starts the core through, which is
# kept apart to sit at the runtime's root; and the contract release its lock
# names.
#
# THE CONTRACT IS THE ONE THE CORE WAS TESTED WITH. The lock names a release by
# the URL of its asset and the digest of its bytes, and the asset is refused
# unless its bytes are those. `ZOD_VERSION` is held to the lock for the same
# reason: it is the zod the contract's schemas and the tool shapes run under in
# a pod, and the lock's is the one they ran under in every suite of the core.
FROM base AS core
ARG ZOD_VERSION
RUN --mount=type=bind,source=images/worker/core.sh,target=/tmp/worker/core.sh \
    --mount=type=bind,source=images/worker/core.json,target=/tmp/worker/core.json \
  sh /tmp/worker/core.sh fetch /core \
  && rm -rf /core/.git
RUN node -e ' \
    const lock = require("/core/package-lock.json").packages; \
    const contract = lock["node_modules/@chuggy/worker-contract"] ?? {}; \
    const zod = lock["node_modules/zod"]?.version; \
    if (zod !== process.env.ZOD_VERSION) { \
      console.error(`the core locks zod ${zod} and the image installs ${process.env.ZOD_VERSION}`); \
      process.exit(1); \
    } \
    if (!contract.resolved || !contract.integrity) { \
      console.error("the core locks no contract release"); \
      process.exit(1); \
    } \
    console.log(`${contract.resolved} ${contract.integrity}`); \
  ' > /tmp/contract.txt \
  && read -r resolved integrity < /tmp/contract.txt \
  && curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --location "$resolved" --output /contract.tgz \
  && node -e ' \
    const bytes = require("node:fs").readFileSync("/contract.tgz"); \
    const hash = require("node:crypto").createHash("sha512").update(bytes); \
    const digest = `sha512-${hash.digest("base64")}`; \
    if (digest !== process.argv[1]) { \
      console.error(`the contract asset is ${digest} and the core locks ${process.argv[1]}`); \
      process.exit(1); \
    } \
  ' "$integrity"
RUN node -e 'for (const name of require("/core/package.json").files) console.log(name)' \
    > /tmp/files.txt \
  && mkdir /shipped \
  && while read -r name; do cp "/core/$name" "/shipped/$name" || exit 1; done < /tmp/files.txt \
  && mv /shipped/entrypoint.mjs /shipped/worker.mjs \
  && mv /shipped/check.sh /check.sh \
  && chmod 0555 /shipped/git-askpass.sh

# CHUGGY'S RUNTIME: the tree a job's container mounts read-only at `/opt/chuggy`
# whatever image the job names, and the image every stage below is built on.
#
#   bin/node      the `runtime-node` stage's node, which runs the core
#   bin/claude    the Claude Code the core and a session's SDK both run
#   bin/codex     the Codex the core runs
#   bin/tini      the init `check.sh` starts the core under, which reaps what
#                 a job orphans
#   lib/chuggy/   the shipped core, its entry named `worker.mjs`, and the
#                 packages it imports in a `node_modules` of its own
#   share/        the base's CA bundle, `ca-certificates.crt`, for Codex
#   check.sh      what a job's container runs first, in the job's own image
#
# The core finds `bin/` from where it sits, and nothing puts it on PATH.
#
# A SITE COPIES THE TREE OUT OF THIS IMAGE with this image's `cp`, as the user a
# job runs as. So `/opt/chuggy` is a directory and not a link, and every file in
# it is one that user can read; the last probe below makes that copy and runs
# the check from it.
#
# CLAUDE CODE IS THE SDK'S OWN. The Agent SDK spawns the binary shipped inside
# it as `@anthropic-ai/claude-agent-sdk-linux-x64`, and `bin/claude` is a link
# to that file, so a job and a session run one Claude Code. `CLAUDE_CODE_VERSION`
# names it, and the build fails unless that binary reports it; `just
# bump-claude-code` moves it with `AGENT_SDK_VERSION`. The SDK's `zod` peer is
# pinned beside it: `sdkProbe.mjs` reads the SDK's own declared range and fails
# the build where the pin no longer satisfies it. The pin is declared at the top
# of this file, where the `core` stage holds it to the core's lock.
#
# CODEX IS ITS STATIC BUILD. npm's `codex` is a node script that finds its
# platform package's binary and spawns it; the tree ships that binary alone,
# which links against nothing. Tini is its release's static build too.
#
# NO LIBRARY IS SHIPPED; THE JOB'S IMAGE PROVIDES THEM. Chuggy's node names no
# directory of its own to find a library in, so one shipped here would be found
# only through a variable every process it starts inherits; and the base's
# libstdc++ asks for a newer glibc than node does, which would raise the floor
# stated below.
FROM base AS runtime
ARG CLAUDE_CODE_VERSION=2.1.282
ARG CODEX_VERSION=0.151.0
ARG AGENT_SDK_VERSION=0.3.282
ARG TINI_VERSION=0.19.0
ARG TINI_SHA256=c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee
ARG ZOD_VERSION

# The packages the core imports, installed as one tree, so that npm keeps a
# single `zod` for the SDK, the contract and the core alike. The contract is the
# release the core's lock names.
RUN --mount=type=bind,from=core,source=/contract.tgz,target=/tmp/contract.tgz \
  mkdir -p /tmp/runtime /opt/chuggy/bin /opt/chuggy/lib/chuggy \
  && cd /tmp/runtime \
  && npm install --no-save --no-package-lock --no-audit --no-fund \
    "@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}" \
    "zod@${ZOD_VERSION}" \
    /tmp/contract.tgz \
  && mv node_modules /opt/chuggy/lib/chuggy/node_modules \
  && cd / \
  && rm -rf /tmp/runtime

# The platform package npm's `codex` names as its optional dependency, of which
# only the binary is kept.
RUN cd /tmp \
  && npm pack --silent "@openai/codex@${CODEX_VERSION}-linux-x64" > /tmp/codex.txt \
  && read -r packed < /tmp/codex.txt \
  && tar --extract --gzip --file "/tmp/$packed" --directory /tmp \
    package/vendor/x86_64-unknown-linux-musl/bin/codex \
  && install -m 0755 /tmp/package/vendor/x86_64-unknown-linux-musl/bin/codex /opt/chuggy/bin/codex \
  && rm -rf /tmp/package "/tmp/$packed" /tmp/codex.txt

RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://github.com/krallin/tini/releases/download/v${TINI_VERSION}/tini-static-amd64" \
    --output /tmp/tini \
  && echo "${TINI_SHA256}  /tmp/tini" | sha256sum --check --quiet - \
  && install -m 0755 /tmp/tini /opt/chuggy/bin/tini \
  && rm /tmp/tini \
  && /opt/chuggy/bin/tini --version

COPY --from=core /shipped/ /opt/chuggy/lib/chuggy/
COPY --from=core /check.sh /opt/chuggy/check.sh
COPY --from=runtime-node /usr/local/bin/node /opt/chuggy/bin/node
RUN ln -s ../lib/chuggy/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude \
    /opt/chuggy/bin/claude \
  && install -D -m 0644 /etc/ssl/certs/ca-certificates.crt \
    /opt/chuggy/share/ca-certificates.crt

# What the core needs, read off the tree rather than off this file. Each import
# runs from the directory the core's modules live in, because what finds a
# package is the `node_modules` walk up from there. The contract installed is the
# release a pod names in every request, so it is held to the one `core.json`
# names, and the tree to sitting where that release starts a job from.
#
# Both probes resolve the runtime through `session.mjs`'s own `sessionSdk`, so
# what they prove is the resolution a turn will make. `sdkProbe.mjs` holds the
# installed `zod` to the range the SDK declares for its peer; `toolProbe.mjs`
# then lists the whole chuggy server over the runtime's own transport, because a
# shape the runtime cannot render to JSON schema makes the entire listing throw
# while the server still reports itself connected — every tool silently absent,
# and the lead told they do not exist. What that probe asks is `toolListing.mjs`,
# which a suite drives against a stub server, so the gate itself is tested.
# `contractProbe.mjs` imports every entry of the installed contract and holds it
# to the scripts' own `zod`. Each argues itself in its own header, and every
# probe's files are removed once the probes have run, because a build's verdict
# is not something a pod needs.
#
# THEN THE ENTRY IS IMPORTED, AS A POD IMPORTS IT, from what is left. Loading it
# starts nothing, so a module it reaches that `files` did not ship fails the
# build here rather than the first pod. Last, what `coreRuntime.mjs` derives
# from where the core sits is held to be in this tree and readable, what the
# core runs of it to be executable, and each agent to report the version this
# file names.
RUN --mount=type=bind,source=images/worker/core.json,target=/tmp/core.json \
  cd /opt/chuggy/lib/chuggy \
  && /opt/chuggy/bin/node --input-type=module --eval ' \
    import { accessSync, constants, readFileSync } from "node:fs"; \
    import { workerContractRelease } from "@chuggy/worker-contract/workerContract"; \
    import { workerJobCommand, workerRuntimeDirectory } from "@chuggy/worker-contract/workerEnvironment"; \
    const { contractRelease } = JSON.parse(readFileSync("/tmp/core.json", "utf8")); \
    if (workerContractRelease !== contractRelease) { \
      console.error(`core.json names contract ${contractRelease} and the core installs ${workerContractRelease}`); \
      process.exit(1); \
    } \
    if (workerRuntimeDirectory !== "/opt/chuggy") { \
      console.error(`the contract starts a job from ${workerRuntimeDirectory} and the runtime is at /opt/chuggy`); \
      process.exit(1); \
    } \
    accessSync(workerJobCommand.at(-1), constants.R_OK); \
  ' \
  && /opt/chuggy/bin/node sdkProbe.mjs \
  && /opt/chuggy/bin/node toolProbe.mjs \
  && /opt/chuggy/bin/node contractProbe.mjs \
  && rm sdkProbe.mjs toolProbe.mjs toolListing.mjs contractProbe.mjs \
  && /opt/chuggy/bin/node --input-type=module --eval 'import "/opt/chuggy/lib/chuggy/worker.mjs";' \
  && /opt/chuggy/bin/node --input-type=module --eval ' \
    import { accessSync, constants } from "node:fs"; \
    import { coreRuntime } from "/opt/chuggy/lib/chuggy/coreRuntime.mjs"; \
    for (const [name, path] of Object.entries(coreRuntime)) { \
      if (!path.startsWith("/opt/chuggy/")) { \
        console.error(`the core finds its ${name} at ${path}, outside the runtime`); \
        process.exit(1); \
      } \
      accessSync(path, constants.R_OK); \
    } \
    for (const path of [coreRuntime.askpass, coreRuntime.claude, coreRuntime.codex]) \
      accessSync(path, constants.X_OK); \
    console.log(`the core finds ${Object.values(coreRuntime).join(", ")}`); \
  ' \
  && claude="$(/opt/chuggy/bin/claude --version)" \
  && codex="$(/opt/chuggy/bin/codex --version)" \
  && if [ "$claude" != "${CLAUDE_CODE_VERSION} (Claude Code)" ] || \
       [ "$codex" != "codex-cli ${CODEX_VERSION}" ]; then \
       echo "the runtime ships $claude and $codex, and this file names Claude Code ${CLAUDE_CODE_VERSION} and Codex ${CODEX_VERSION}"; \
       exit 1; \
     fi

# WHAT A JOB'S IMAGE MUST PROVIDE IS READ OFF THE TREE, AND STATED HERE ONCE:
# every library an ELF the tree ships needs, and for each family of symbol
# versions those ELFs reference the highest one, which is the oldest that
# family's library in the image may be. Only an ELF's version references are
# read, since its version definitions are what it provides rather than what it
# needs. The build fails unless the two are exactly these, so a bump that
# changes either changes this file. An image that lacks one of the libraries,
# or holds one older than its floor, is one where chuggy's node or claude
# cannot load, which `check.sh` reports with the status of
# `ImageLibcUnsupported`. `bin/claude` is held to be a native binary, which a
# link to anything else would not be.
ARG RUNTIME_LIBRARIES="ld-linux-x86-64.so.2 libc.so.6 libdl.so.2 libgcc_s.so.1 libm.so.6 libpthread.so.0 librt.so.1 libstdc++.so.6"
ARG RUNTIME_VERSION_FLOOR="CXXABI_1.3.11 GCC_3.4 GLIBCXX_3.4.21 GLIBC_2.28"
RUN find /opt/chuggy -type f > /tmp/files.txt \
  && : > /tmp/needed.txt \
  && while read -r file; do \
       [ "$(od -An -tx1 -N4 "$file" | tr -d ' \n')" = 7f454c46 ] || continue; \
       objdump -p "$file" > /tmp/elf.txt || exit 1; \
       echo "runtime: $file is an ELF"; \
       awk '$1 == "NEEDED" { print "library", $2 } \
         /^Version References:/ { references = 1; next } \
         !/^[ \t]/ { references = 0 } \
         references && $1 ~ /^0x/ && $4 ~ /^[A-Z]+_[0-9][0-9.]*$/ { print "version", $4 }' \
         /tmp/elf.txt >> /tmp/needed.txt || exit 1; \
     done < /tmp/files.txt \
  && libraries="$(sed -n 's/^library //p' /tmp/needed.txt | sort -u | tr '\n' ' ')" \
  && floor="$(sed -n 's/^version //p' /tmp/needed.txt | sort -u -V \
    | awk -F_ '{ highest[$1] = $0 } END { for (family in highest) print highest[family] }' \
    | sort | tr '\n' ' ')" \
  && stated_libraries="$(printf '%s\n' $RUNTIME_LIBRARIES | sort -u | tr '\n' ' ')" \
  && stated_floor="$(printf '%s\n' $RUNTIME_VERSION_FLOOR | sort | tr '\n' ' ')" \
  && rm -f /tmp/files.txt /tmp/needed.txt /tmp/elf.txt \
  && echo "runtime: needs ${libraries}at ${floor}" \
  && if [ "$libraries" != "$stated_libraries" ] || [ "$floor" != "$stated_floor" ]; then \
       echo "the runtime needs ${libraries}at ${floor}and RUNTIME_LIBRARIES and RUNTIME_VERSION_FLOOR state ${stated_libraries}at ${stated_floor}"; \
       exit 1; \
     fi \
  && if [ "$(od -An -tx1 -N4 /opt/chuggy/bin/claude | tr -d ' \n')" != 7f454c46 ]; then \
       echo "bin/claude is not a native binary"; \
       exit 1; \
     fi

# THE TREE IS COPIED AS A SITE COPIES IT, and the check passes both in place and
# in the copy. A site hands the check a workspace, which here is a temporary
# directory.
USER 1000:1000
RUN copy="$(mktemp -d)" \
  && workspace="$(mktemp -d)" \
  && cp -a /opt/chuggy "$copy/" \
  && if [ ! -d "$copy/chuggy" ] || [ -L "$copy/chuggy" ]; then \
       echo "the runtime copies as something other than a directory"; \
       exit 1; \
     fi \
  && CHUG_WORKER_WORKSPACE="$workspace" /bin/sh /opt/chuggy/check.sh check \
  && CHUG_WORKER_WORKSPACE="$workspace" /bin/sh "$copy/chuggy/check.sh" check \
  && rm -rf "$copy" "$workspace"

# What every image a pod runs is built from: chuggy's runtime, and the tools the
# trees it works on are checked with.
#
# THE IMAGE'S `claude` IS THE RUNTIME'S, linked onto PATH by name rather than by
# putting the runtime's `bin/` there, which would shadow the image's own node.
# The practices the `worker` stage installs through it, and `check-roster` lists
# through it, are then installed and listed by the Claude Code that loads them.
FROM runtime AS worker-base
USER 0:0
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
    build-essential ca-certificates curl fd-find git jq postgresql-client python3 ripgrep \
  && curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --location https://just.systems/install.sh \
    | bash -s -- --to /usr/local/bin \
  && ln -s /opt/chuggy/bin/claude /usr/local/bin/claude \
  && claude --version \
  && psql --version \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV DISABLE_AUTOUPDATER=1 \
    CHUG_WORKER_WORKSPACE=/workspace \
    TMPDIR=/tmp

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/opt/chuggy/bin/node", "/opt/chuggy/lib/chuggy/worker.mjs"]

# The image this tree's own tickets run on.
FROM worker-base AS worker

# THE IMAGE SHIPS THE KETO `check-keto` STARTS. A pod has no docker and nothing
# hands its gates an authority, so `.chug/tasks/_keto.sh` starts the `keto` on
# PATH from the checkout's own model. The sqlite build of the release is the one
# that runs, because `dsn: memory` in `.chug/tasks/keto/keto.yml` is an
# in-memory sqlite, and the release's own container image carries a binary
# linked against musl.
USER 0:0
ARG KETO_VERSION=26.2.0
ARG KETO_SHA256=37aaa6248eccb337503d618978520b18df4cad979e175134a1b017c291457ad0
RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://github.com/ory/keto/releases/download/v${KETO_VERSION}/keto_${KETO_VERSION}-linux_sqlite_64bit.tar.gz" \
    --output /tmp/keto.tgz \
  && echo "${KETO_SHA256}  /tmp/keto.tgz" | sha256sum --check --quiet - \
  && tar --extract --gzip --file /tmp/keto.tgz --directory /usr/local/bin keto \
  && rm /tmp/keto.tgz \
  && keto version
USER 1000:1000

# THE IMAGE SHIPS TRACK RECORD'S CLIENT, which reuses a pass on record rather
# than running a command again. The build fails unless the image's user runs it
# and it reports the version this file names.
ARG TRACK_RECORD_VERSION
COPY --from=track-record /go/bin/track-record /usr/local/bin/track-record
RUN version="$(track-record --version)" \
  && if [ "$version" != "track-record v${TRACK_RECORD_VERSION}" ]; then \
       echo "the image ships $version, and this file names Track Record ${TRACK_RECORD_VERSION}"; \
       exit 1; \
     fi

# THE PRACTICES THE TREE DECLARES ARE INSTALLED FOR THE IMAGE'S USER. An agent
# here is told to invoke them by name, and `check-roster` refuses a tree whose
# roster does not resolve, so the roster is read off the tree's own
# `.claude/settings.json` rather than listed a second time here. What is
# pinned is the roster, not its content: CLAUDE.md states that a practice's
# content is versioned outside this tree and moves without a commit here, and
# the marketplace is fetched as a developer's machine fetches it. The listing
# goes through a file so that a listing which fails is its own failure, rather
# than a loop that read nothing and installed nothing.
RUN --mount=type=bind,source=.claude/settings.json,target=/tmp/practices.json \
  node -e ' \
    const settings = require("/tmp/practices.json"); \
    for (const market of Object.values(settings.extraKnownMarketplaces ?? {})) \
      console.log(`marketplace ${market.source.repo}`); \
    for (const [id, enabled] of Object.entries(settings.enabledPlugins ?? {})) \
      if (enabled === true) console.log(`plugin ${id}`); \
  ' > /tmp/practices.txt \
  && while read -r kind name; do \
       case "$kind" in \
       marketplace) claude plugin marketplace add "$name" || exit 1 ;; \
       plugin) claude plugin install "$name" || exit 1 ;; \
       esac; \
     done < /tmp/practices.txt \
  && rm /tmp/practices.txt

# THE CORE'S SUITES RUN ON THE RUNTIME'S NODE, against the contract and the zod
# the runtime installed. The core's own gates run them on whatever Node its
# developers have, and nothing else would run them on the one a pod has. They
# sit inside the runtime's `lib/chuggy/` so that they resolve their packages by
# the walk the pod's modules resolve theirs by. Like the roster stage below,
# this is a stage and not an image, and each image binds its verdict.
FROM worker-base AS core-suites
COPY --from=core --chown=1000:1000 /core /opt/chuggy/lib/chuggy/core-suites
RUN cd /opt/chuggy/lib/chuggy/core-suites \
  && /opt/chuggy/bin/node --test --test-reporter=dot ./*.test.mjs \
  && touch /workspace/core-suites-clean

# THE BUILD REFUSES AN IMAGE THAT CANNOT RUN THE GATES. Every attempt's Check
# evaluation runs `.chug/tasks/ci.sh` inside this image, and the image a ticket
# runs on is pinned at its release: a gate that cannot run here exits 2 on
# every cycle of every ticket its cone touches, and nothing the ticket does can
# move it. So this stage stages the tree the image was built from, installs it
# and runs the whole roster, and the final stage binds this stage's verdict,
# which is what makes the build depend on it. Nothing installed here ships: it
# is a stage FROM the image, not the image.
#
# WHAT THIS PROVES IS THE IMAGE, NOT THE POD. A build has no sidecars, so the
# PostgreSQL the server gates are given is the stage's own: Debian's, started
# as the image's own user and named by the URL `_postgres.sh` accepts in place
# of a container. Its data directory is a tmpfs and it neither syncs nor writes
# full pages, since a run's scratch is all a crash would lose. In a pod it is
# the site's, which names it to the gates as `CHUG_PG_URL` in its own
# environment. Keto is handed to the gates in neither place: `_keto.sh` finds
# no docker and starts the `keto` the image ships, here as it does in a pod.
#
# THE STEP STARTS AS ROOT AND RUNS AS THE IMAGE'S USER. Some builders mount the
# tmpfs as root's at 0755, the rig's among them, where docker's is open to all,
# so the data directory is made in it as root and handed to the user, which
# runs the rest with its own home.
#
# THE POSTGRESQL LOG IS PRINTED ON THE WAY OUT. A server that does not come up
# ends the stage with only the gate's could-not-run line.
#
# THE SERVER IS INITIALISED IN UTF-8 BY NAME. A build has no locale in its
# environment, so `initdb` left to itself makes an SQL_ASCII cluster, under
# which a character pattern such as `[[:cntrl:]]` reads the bytes of a
# multibyte character one at a time, and a constraint the schema states goes
# red on text the sidecar's server accepts.
#
# THE TREE IS COMMITTED BEFORE THE ROSTER RUNS. `.dockerignore` keeps `.git`
# out of the context and every gate reads git, so the stage makes a repository
# of what it was handed; a full run needs no base.
#
# THE CONSOLE SUITE IS TOLD HOW MANY WORKERS TO START. A build step sees every
# core of the node it runs on and nothing of the allowance the builder meters
# it by, so the suite's runner starts a worker a core and they share a
# fraction of that. A test that watches text arrive at a pace then gets too
# few turns to see it paced, and fails on a tree that passes anywhere else.
# Nothing in the step can read the allowance, so the count is stated.
FROM worker AS roster
USER 0:0
RUN apt-get update \
  && apt-get install --yes --no-install-recommends postgresql-17 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY --chown=1000:1000 . /workspace/tree
RUN --mount=type=tmpfs,target=/tmp/postgres-memory \
  install --directory --owner 1000 --group 1000 --mode 0700 /tmp/postgres-memory/data \
  && HOME="$(getent passwd 1000 | cut -d: -f6)" \
    exec setpriv --reuid 1000 --regid 1000 --clear-groups /bin/sh -c ' \
  cd /workspace/tree \
  && export PATH="/usr/lib/postgresql/17/bin:$PATH" \
  && initdb --pgdata /tmp/postgres-memory/data --auth trust --username postgres \
    --encoding UTF8 --locale C >/dev/null \
  && pg_ctl --pgdata /tmp/postgres-memory/data --log /tmp/postgres.log \
    --options "-k /tmp -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    --wait start \
  && git init --quiet --initial-branch main \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid add --all \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid commit --quiet \
    --message "the tree this image is held to" \
  && npm ci \
  && CHUG_CI_FULL=1 \
    VITEST_MAX_WORKERS=4 \
    CHUG_PG_URL=postgres://postgres@127.0.0.1:5432/postgres \
    ./.chug/tasks/ci.sh \
  && touch /workspace/roster-clean \
  || { tail -n 50 /tmp/postgres.log; exit 1; }'

# The image any other tree runs on: the base and the toolchains a Python or Rust
# tree builds with. Rust's belongs to the image's user, so an attempt can fill
# cargo's registry and install the toolchain a `rust-toolchain.toml` names.
FROM worker-base AS generic
USER 0:0
ARG UV_VERSION=0.12.21
ARG UV_SHA256=23f02075b652bb1df64178cfae41b5caf160822e720e2663568f3f5d63bc52c0
ARG RUSTUP_VERSION=1.29.1
ARG RUSTUP_SHA256=dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71
ARG RUST_VERSION=1.98.1
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    libssl-dev pkg-config python3-pip python3-venv \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    --output /tmp/uv.tgz \
  && echo "${UV_SHA256}  /tmp/uv.tgz" | sha256sum --check --quiet - \
  && tar --extract --gzip --file /tmp/uv.tgz --directory /usr/local/bin \
    --strip-components 1 uv-x86_64-unknown-linux-gnu/uv uv-x86_64-unknown-linux-gnu/uvx \
  && rm /tmp/uv.tgz \
  && uv --version
RUN curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
    --output /tmp/rustup-init \
  && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum --check --quiet - \
  && chmod 0755 /tmp/rustup-init \
  && /tmp/rustup-init -y --no-modify-path --profile minimal \
    --default-toolchain "${RUST_VERSION}" --component clippy,rustfmt \
  && rm /tmp/rustup-init \
  && cargo --version \
  && cargo clippy --version \
  && cargo fmt --version \
  && chown -R 1000:1000 "$RUSTUP_HOME" "$CARGO_HOME"
# A login shell sets PATH afresh from `/etc/profile`, so cargo's is added there.
RUN printf 'export PATH="%s/bin:$PATH"\n' "$CARGO_HOME" > /etc/profile.d/cargo.sh
USER 1000:1000
RUN --mount=type=bind,from=core-suites,source=/workspace/core-suites-clean,target=/tmp/core-suites-clean \
  true

# The default image is the worker stage and nothing the stages FROM it added.
# The binds are what make the build refuse to finish without the core suites'
# verdict and the roster's, and they leave nothing behind, because a build's
# verdict is not something a pod needs.
FROM worker
RUN --mount=type=bind,from=core-suites,source=/workspace/core-suites-clean,target=/tmp/core-suites-clean \
    --mount=type=bind,from=roster,source=/workspace/roster-clean,target=/tmp/roster-clean \
  true
