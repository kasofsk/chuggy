# The zod the image installs as the agent SDK's peer. It is declared before any
# stage because two of them read it: the `core` stage holds it to the core's
# lock and the `worker-base` stage installs it.
ARG ZOD_VERSION=4.5.4

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

# The worker core: kasofsk/chuggy-common at the commit `core.json` pins, which
# `core.sh` fetches and refuses unless that commit is on the core's main. Only
# what the later stages copy leaves this one: the core's tree, for its suites;
# its shipped set, which is `package.json`'s `files` read off that tree rather
# than listed here; and the contract release its lock names.
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
  && chmod 0555 /shipped/git-askpass.sh

# What every image a pod runs is built from: the worker core, the contract it
# speaks and the agents it drives.
FROM base AS worker-base

# THE IMAGE RUNS TWO CLAUDE CODES AND THEY MUST BE THE SAME ONE. A work attempt
# spawns the global `claude`; a session's Agent SDK spawns a copy of its own,
# shipped inside the SDK as `@anthropic-ai/claude-agent-sdk-linux-x64` and named
# by the SDK's `manifest.json`. Nothing makes those two agree, so the probe
# below reads both versions off the built image and fails the build when they
# differ. `just bump-claude-code` moves the two ARGs together.
#
# THE SDK'S `zod` PEER IS INSTALLED HERE FOR THE SAME REASON: `sdkProbe.mjs`
# reads the SDK's own declared range and fails the build where this pin no
# longer satisfies it. The pin is declared at the top of this file, where the
# `core` stage holds it to the core's lock.
ARG CLAUDE_CODE_VERSION=2.1.282
ARG CODEX_VERSION=0.151.0
ARG AGENT_SDK_VERSION=0.3.282
ARG ZOD_VERSION

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
    build-essential ca-certificates curl fd-find git jq postgresql-client python3 ripgrep \
  && curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --location https://just.systems/install.sh \
    | bash -s -- --to /usr/local/bin \
  && npm install --global \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}" \
    "zod@${ZOD_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
  && claude --version \
  && codex --version \
  && psql --version \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV DISABLE_AUTOUPDATER=1 \
    CHUG_WORKER_WORKSPACE=/workspace \
    NODE_PATH=/usr/local/lib/node_modules \
    TMPDIR=/tmp

# The contract's global install nests its own copy of its `zod` peer unless told
# to leave peers alone: that would be a second `zod` beside the one above, which
# `contractProbe.mjs` below fails the build on. The release installed is the one
# a pod names in every request, so it is held to the one `core.json` names.
RUN --mount=type=bind,from=core,source=/contract.tgz,target=/tmp/contract.tgz \
    --mount=type=bind,source=images/worker/core.json,target=/tmp/core.json \
  npm install --global --legacy-peer-deps /tmp/contract.tgz \
  && cd /usr/local/lib \
  && node --input-type=module --eval ' \
    import { readFileSync } from "node:fs"; \
    import { workerContractRelease } from "@chuggy/worker-contract/workerContract"; \
    const { contractRelease } = JSON.parse(readFileSync("/tmp/core.json", "utf8")); \
    if (workerContractRelease !== contractRelease) { \
      console.error(`core.json names contract ${contractRelease} and the core installs ${workerContractRelease}`); \
      process.exit(1); \
    } \
  '

COPY --from=core /shipped/ /usr/local/lib/chuggy/

# What the session mode needs, read off the image rather than off this file. The
# import runs from the directory the scripts live in, because that is what
# decides whether it resolves: `NODE_PATH` above is honoured by `require` and
# ignored by `import`, and what actually finds the SDK is the node_modules walk
# up from `/usr/local/lib/chuggy/`. The second half holds the two Claude Codes
# to the same version.
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
# build here rather than the first pod.
RUN cd /usr/local/lib/chuggy \
  && node sdkProbe.mjs \
  && node toolProbe.mjs \
  && node contractProbe.mjs \
  && rm sdkProbe.mjs toolProbe.mjs toolListing.mjs contractProbe.mjs \
  && node --input-type=module --eval 'import "/usr/local/lib/chuggy/worker.mjs";' \
  && bundled="$(node -e "console.log(require('/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json').version)")" \
  && global="$(claude --version)" \
  && if [ "${global% (Claude Code)}" != "$bundled" ]; then \
       echo "the SDK spawns Claude Code $bundled while the image installs $global"; \
       exit 1; \
     fi

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/lib/chuggy/worker.mjs"]

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

# THE CORE'S SUITES RUN ON THE IMAGES' NODE, against the contract and the zod
# the base installed. The core's own gates run them on whatever Node its
# developers have, and nothing else would run them on the one a pod has. They
# sit under `/usr/local/lib` so that they resolve their packages by the walk the
# pod's modules resolve theirs by. Like the roster stage below, this is a stage
# and not an image, and each image binds its verdict.
FROM worker-base AS core-suites
COPY --from=core --chown=1000:1000 /core /usr/local/lib/chuggy-core
RUN cd /usr/local/lib/chuggy-core \
  && node --test --test-reporter=dot ./*.test.mjs \
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
# of a container. In a pod it is the site's, which names it to the gates as
# `CHUG_PG_URL` in its own environment. Keto is handed to the gates in neither
# place: `_keto.sh` finds no docker and starts the `keto` the image ships, here
# as it does in a pod.
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
USER 1000:1000
RUN cd /workspace/tree \
  && export PATH="/usr/lib/postgresql/17/bin:$PATH" \
  && initdb --pgdata /tmp/postgres --auth trust --username postgres \
    --encoding UTF8 --locale C >/dev/null \
  && pg_ctl --pgdata /tmp/postgres --log /tmp/postgres.log --options '-k /tmp' --wait start \
  && git init --quiet --initial-branch main \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid add --all \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid commit --quiet \
    --message 'the tree this image is held to' \
  && npm ci \
  && CHUG_CI_FULL=1 \
    VITEST_MAX_WORKERS=4 \
    CHUG_PG_URL=postgres://postgres@127.0.0.1:5432/postgres \
    ./.chug/tasks/ci.sh \
  && touch /workspace/roster-clean \
  || { tail -n 50 /tmp/postgres.log; exit 1; }

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
