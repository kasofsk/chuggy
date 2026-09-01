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

ARG CLAUDE_CODE_VERSION=2.1.251
ARG CODEX_VERSION=0.151.0

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
    "@openai/codex@${CODEX_VERSION}" \
  && claude --version \
  && codex --version \
  && psql --version \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV DISABLE_AUTOUPDATER=1 \
    CHUG_WORKER_WORKSPACE=/workspace \
    TMPDIR=/tmp

COPY images/worker/entrypoint.mjs /usr/local/lib/chuggy/worker.mjs
COPY images/worker/agent.mjs /usr/local/lib/chuggy/agent.mjs
COPY images/worker/claude.mjs /usr/local/lib/chuggy/claude.mjs
COPY images/worker/codex.mjs /usr/local/lib/chuggy/codex.mjs
COPY images/worker/lease.mjs /usr/local/lib/chuggy/lease.mjs
COPY images/worker/postgres.mjs /usr/local/lib/chuggy/postgres.mjs
COPY images/worker/repository.mjs /usr/local/lib/chuggy/repository.mjs
COPY images/worker/result.mjs /usr/local/lib/chuggy/result.mjs
COPY images/worker/runEvidence.mjs /usr/local/lib/chuggy/runEvidence.mjs
COPY images/worker/snapshot.mjs /usr/local/lib/chuggy/snapshot.mjs
COPY images/worker/source.mjs /usr/local/lib/chuggy/source.mjs
COPY images/worker/transport.mjs /usr/local/lib/chuggy/transport.mjs
COPY --chmod=0555 images/worker/git-askpass.sh /usr/local/lib/chuggy/git-askpass.sh

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/lib/chuggy/worker.mjs"]
