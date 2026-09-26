# The worker contract, packed from the tree the way it is published, so the
# image installs the package rather than the tree's sources. The base is the one
# `images/api/Dockerfile` pins, and only the tarball leaves this stage.
FROM node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS contract
WORKDIR /srv/chuggy
COPY package.json package-lock.json ./
COPY src/contract/package.json src/contract/package.json
RUN npm ci --ignore-scripts
COPY tsconfig.contract.json tsconfig.contract-pack.json ./
COPY src/contract src/contract
COPY scripts/pack-worker-contract.ts scripts/pack-worker-contract.ts
RUN node scripts/pack-worker-contract.ts --out /contract

# The image one attempt runs in, built by the fabric rather than by hand:
# `builds/` in gdoteof/chuggy-fabric holds the request, and the profile it names
# permits public HTTPS on 443 and nothing else outbound.
#
# THAT IS WHY THE BASE IS NOT THE SLIM ONE, AND WHY THE SOURCES ARE REWRITTEN.
# Debian's apt fetches over port 80, which that profile refuses — the packages
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
FROM node:26.7.0-trixie@sha256:40fd8249a701dab7431d15074ac4cf4f1c18eecd713807599cd76a7a6caad48b AS worker

# THE IMAGE RUNS TWO CLAUDE CODES AND THEY MUST BE THE SAME ONE. A work attempt
# spawns the global `claude`; a session's Agent SDK spawns a copy of its own,
# shipped inside the SDK as `@anthropic-ai/claude-agent-sdk-linux-x64` and named
# by the SDK's `manifest.json`. Nothing makes those two agree, so the probe
# below reads both versions off the built image and fails the build when they
# differ. `just bump-claude-code` moves the two ARGs together.
#
# THE SDK'S `zod` PEER IS INSTALLED HERE FOR THE SAME REASON: `sdkProbe.mjs`
# reads the SDK's own declared range and fails the build where this pin no
# longer satisfies it. The version is the one `package-lock.json` resolves, so
# the tool shapes the suites validate are validated by the same zod the image
# runs.
ARG CLAUDE_CODE_VERSION=2.1.282
ARG CODEX_VERSION=0.151.0
ARG AGENT_SDK_VERSION=0.3.282
ARG ZOD_VERSION=4.4.3

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
# `contractProbe.mjs` below fails the build on.
RUN --mount=type=bind,from=contract,source=/contract,target=/tmp/contract \
  npm install --global --legacy-peer-deps /tmp/contract/*.tgz

COPY images/worker/entrypoint.mjs /usr/local/lib/chuggy/worker.mjs
COPY images/worker/agent.mjs /usr/local/lib/chuggy/agent.mjs
COPY images/worker/checks.mjs /usr/local/lib/chuggy/checks.mjs
COPY images/worker/chuggyApi.mjs /usr/local/lib/chuggy/chuggyApi.mjs
COPY images/worker/chuggyTools.mjs /usr/local/lib/chuggy/chuggyTools.mjs
COPY images/worker/claude.mjs /usr/local/lib/chuggy/claude.mjs
COPY images/worker/codex.mjs /usr/local/lib/chuggy/codex.mjs
COPY images/worker/contractProbe.mjs /usr/local/lib/chuggy/contractProbe.mjs
COPY images/worker/leadDecision.mjs /usr/local/lib/chuggy/leadDecision.mjs
COPY images/worker/lease.mjs /usr/local/lib/chuggy/lease.mjs
COPY images/worker/planeCredential.mjs /usr/local/lib/chuggy/planeCredential.mjs
COPY images/worker/postgres.mjs /usr/local/lib/chuggy/postgres.mjs
COPY images/worker/rateLimit.mjs /usr/local/lib/chuggy/rateLimit.mjs
COPY images/worker/repository.mjs /usr/local/lib/chuggy/repository.mjs
COPY images/worker/result.mjs /usr/local/lib/chuggy/result.mjs
COPY images/worker/runEvidence.mjs /usr/local/lib/chuggy/runEvidence.mjs
COPY images/worker/sdkProbe.mjs /usr/local/lib/chuggy/sdkProbe.mjs
COPY images/worker/session.mjs /usr/local/lib/chuggy/session.mjs
COPY images/worker/sessionCheckout.mjs /usr/local/lib/chuggy/sessionCheckout.mjs
COPY images/worker/sessionMailbox.mjs /usr/local/lib/chuggy/sessionMailbox.mjs
COPY images/worker/sessionStore.mjs /usr/local/lib/chuggy/sessionStore.mjs
COPY images/worker/sessionTransport.mjs /usr/local/lib/chuggy/sessionTransport.mjs
COPY images/worker/snapshot.mjs /usr/local/lib/chuggy/snapshot.mjs
COPY images/worker/source.mjs /usr/local/lib/chuggy/source.mjs
COPY images/worker/toolListing.mjs /usr/local/lib/chuggy/toolListing.mjs
COPY images/worker/toolProbe.mjs /usr/local/lib/chuggy/toolProbe.mjs
COPY images/worker/transcriptPage.mjs /usr/local/lib/chuggy/transcriptPage.mjs
COPY images/worker/transport.mjs /usr/local/lib/chuggy/transport.mjs
COPY --chmod=0555 images/worker/git-askpass.sh /usr/local/lib/chuggy/git-askpass.sh

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
RUN cd /usr/local/lib/chuggy \
  && node sdkProbe.mjs \
  && node toolProbe.mjs \
  && node contractProbe.mjs \
  && rm sdkProbe.mjs toolProbe.mjs toolListing.mjs contractProbe.mjs \
  && bundled="$(node -e "console.log(require('/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json').version)")" \
  && global="$(claude --version)" \
  && if [ "${global% (Claude Code)}" != "$bundled" ]; then \
       echo "the SDK spawns Claude Code $bundled while the image installs $global"; \
       exit 1; \
     fi

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/lib/chuggy/worker.mjs"]

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

# THE BUILD REFUSES AN IMAGE THAT CANNOT RUN THE GATES. Every attempt's Check
# evaluation runs `.chug/tasks/ci.sh` inside this image, and the image a ticket
# runs on is pinned at its release: a gate that cannot run here exits 2 on
# every cycle of every ticket its cone touches, and nothing the ticket does can
# move it. So this stage stages the tree the image was built from, installs it
# and runs the whole roster, and the final stage binds this stage's verdict,
# which is what makes the build depend on it. Nothing installed here ships: it
# is a stage FROM the image, not the image.
#
# WHAT THIS PROVES IS THE IMAGE, NOT THE POD. The server gates are given
# servers of the stage's own, because a build has no sidecars: Debian's
# PostgreSQL, started as the image's own user, and Ory Keto from its release.
# The sqlite build of Keto is the one that runs, because `dsn: memory` in
# `.chug/tasks/keto/keto.yml` is an in-memory sqlite, and the release's own
# container image carries a binary linked against musl. The URLs are the ones
# `_postgres.sh` and `_keto.sh` accept in place of a container. In a pod the
# servers are the fabric's: its PostgreSQL sidecar reaches the gates as
# `CHUG_PG_URL` through `postgres.mjs`, and nothing hands them a Keto yet
# (kasofsk/chuggy#681), which a green build here does not say otherwise.
#
# THE SUITE BUDGET IS THE BUILD'S, NOT A LAPTOP'S. `ci.sh` bounds its shell
# suites by default at figures chosen for a keyboard, and the whole set runs
# close to that bound on a fast machine, so the bound is named here at what the
# profile's hour affords; a build that reds on a slow builder for a reason that
# is not the image is a control that gets bypassed. A server that does not
# come up ends the stage with only the gate's could-not-run line, so the
# servers' logs are printed on the way out.
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
FROM worker AS roster
USER 0:0
ARG KETO_VERSION=26.2.0
ARG KETO_SHA256=37aaa6248eccb337503d618978520b18df4cad979e175134a1b017c291457ad0
RUN apt-get update \
  && apt-get install --yes --no-install-recommends postgresql-17 \
  && curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
    "https://github.com/ory/keto/releases/download/v${KETO_VERSION}/keto_${KETO_VERSION}-linux_sqlite_64bit.tar.gz" \
    --output /tmp/keto.tgz \
  && echo "${KETO_SHA256}  /tmp/keto.tgz" | sha256sum --check --quiet - \
  && tar --extract --gzip --file /tmp/keto.tgz --directory /usr/local/bin keto \
  && rm /tmp/keto.tgz \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY .chug/tasks/keto/keto.yml .chug/tasks/keto/namespaces.ts /etc/keto/
COPY --chown=1000:1000 . /workspace/tree
USER 1000:1000
RUN cd /workspace/tree \
  && export PATH="/usr/lib/postgresql/17/bin:$PATH" \
  && initdb --pgdata /tmp/postgres --auth trust --username postgres \
    --encoding UTF8 --locale C >/dev/null \
  && pg_ctl --pgdata /tmp/postgres --log /tmp/postgres.log --options '-k /tmp' --wait start \
  && (keto serve -c /etc/keto/keto.yml >/tmp/keto.log 2>&1 &) \
  && git init --quiet --initial-branch main \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid add --all \
  && git -c user.name=roster -c user.email=roster@chuggy.invalid commit --quiet \
    --message 'the tree this image is held to' \
  && npm ci \
  && CHUG_CI_FULL=1 \
    CHUG_CI_SUITE_TIMEOUT_SECS=300 \
    CHUG_CI_SUITES_BUDGET_SECS=900 \
    CHUG_PG_URL=postgres://postgres@127.0.0.1:5432/postgres \
    CHUG_KETO_READ_URL=http://127.0.0.1:4466/ \
    CHUG_KETO_WRITE_URL=http://127.0.0.1:4467/ \
    ./.chug/tasks/ci.sh \
  && touch /workspace/roster-clean \
  || { tail -n 50 /tmp/postgres.log /tmp/keto.log; exit 1; }

# The image is the worker stage and nothing the roster stage added. The bind is
# what makes the build refuse to finish without the roster's verdict, and it
# leaves nothing behind, because a build's verdict is not something a pod needs.
FROM worker
RUN --mount=type=bind,from=roster,source=/workspace/roster-clean,target=/tmp/roster-clean true
