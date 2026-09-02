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
# The digest is the multi-architecture index's, read on 2026-08-27 with
#   docker buildx imagetools inspect node:26.7.0-bookworm
FROM node:26.7.0-bookworm@sha256:e929171d35b9df7773a3ec5b068e387fa109441dc90f91e6560af5d39b7e9bf1

# THE IMAGE RUNS TWO CLAUDE CODES AND THEY MUST BE THE SAME ONE. A work attempt
# spawns the global `claude`; a session's Agent SDK spawns a copy of its own,
# shipped inside the SDK as `@anthropic-ai/claude-agent-sdk-linux-x64` and named
# by the SDK's `manifest.json`. Nothing makes those two agree, so the probe
# below reads both versions off the built image and fails the build when they
# differ. Bump the two ARGs together.
ARG CLAUDE_CODE_VERSION=2.1.258
ARG CODEX_VERSION=0.151.0
ARG AGENT_SDK_VERSION=0.3.258

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

COPY images/worker/entrypoint.mjs /usr/local/lib/chuggy/worker.mjs
COPY images/worker/agent.mjs /usr/local/lib/chuggy/agent.mjs
COPY images/worker/checks.mjs /usr/local/lib/chuggy/checks.mjs
COPY images/worker/chuggyApi.mjs /usr/local/lib/chuggy/chuggyApi.mjs
COPY images/worker/chuggyTools.mjs /usr/local/lib/chuggy/chuggyTools.mjs
COPY images/worker/claude.mjs /usr/local/lib/chuggy/claude.mjs
COPY images/worker/codex.mjs /usr/local/lib/chuggy/codex.mjs
COPY images/worker/leadDecision.mjs /usr/local/lib/chuggy/leadDecision.mjs
COPY images/worker/lease.mjs /usr/local/lib/chuggy/lease.mjs
COPY images/worker/postgres.mjs /usr/local/lib/chuggy/postgres.mjs
COPY images/worker/repository.mjs /usr/local/lib/chuggy/repository.mjs
COPY images/worker/result.mjs /usr/local/lib/chuggy/result.mjs
COPY images/worker/runEvidence.mjs /usr/local/lib/chuggy/runEvidence.mjs
COPY images/worker/session.mjs /usr/local/lib/chuggy/session.mjs
COPY images/worker/sessionMailbox.mjs /usr/local/lib/chuggy/sessionMailbox.mjs
COPY images/worker/sessionStore.mjs /usr/local/lib/chuggy/sessionStore.mjs
COPY images/worker/sessionTransport.mjs /usr/local/lib/chuggy/sessionTransport.mjs
COPY images/worker/snapshot.mjs /usr/local/lib/chuggy/snapshot.mjs
COPY images/worker/source.mjs /usr/local/lib/chuggy/source.mjs
COPY images/worker/toolProbe.mjs /usr/local/lib/chuggy/toolProbe.mjs
COPY images/worker/transport.mjs /usr/local/lib/chuggy/transport.mjs
COPY --chmod=0555 images/worker/git-askpass.sh /usr/local/lib/chuggy/git-askpass.sh

# What the session mode needs, read off the image rather than off this file. The
# import runs from the directory the scripts live in, because that is what
# decides whether it resolves: `NODE_PATH` above is honoured by `require` and
# ignored by `import`, and what actually finds the SDK is the node_modules walk
# up from `/usr/local/lib/chuggy/`. The second half holds the two Claude Codes
# to the same version.
#
# `zod` IS PROBED BESIDE THE SDK BECAUSE IT IS A PEER DEPENDENCY OF IT, not one
# of its dependencies: the chuggy tool shapes are zod raw shapes, and a peer npm
# did not hoist here is a session that starts and then fails every turn.
#
# `toolProbe.mjs` THEN LISTS THE WHOLE CHUGGY SERVER over the runtime's own
# transport, because a shape the runtime cannot render to JSON schema makes the
# entire listing throw while the server still reports itself connected — every
# tool silently absent, and the lead told they do not exist. Its own header
# argues it; it is removed after it has run, because it is a build's verdict and
# not something a pod needs.
RUN cd /usr/local/lib/chuggy \
  && echo "const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk'); const { z } = await import('zod'); for (const [name, held] of Object.entries({ query, tool, createSdkMcpServer, z })) if (typeof held !== 'function' && typeof held !== 'object') throw new Error('the session mode cannot resolve ' + name);" > sdk-probe.mjs \
  && node sdk-probe.mjs \
  && rm sdk-probe.mjs \
  && node toolProbe.mjs \
  && rm toolProbe.mjs \
  && bundled="$(node -e "console.log(require('/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json').version)")" \
  && global="$(claude --version)" \
  && if [ "${global% (Claude Code)}" != "$bundled" ]; then \
       echo "the SDK spawns Claude Code $bundled while the image installs $global"; \
       exit 1; \
     fi

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/lib/chuggy/worker.mjs"]
