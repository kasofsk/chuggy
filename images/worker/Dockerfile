FROM node:26.7.0-bookworm-slim

ARG CLAUDE_CODE_VERSION=latest

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    build-essential ca-certificates curl fd-find git jq postgresql postgresql-client python3 ripgrep \
  && curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --location https://just.systems/install.sh \
    | bash -s -- --to /usr/local/bin \
  && npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && claude --version \
  && psql --version \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/lib/postgresql/*

ENV DISABLE_AUTOUPDATER=1 \
    CHUG_WORKER_WORKSPACE=/workspace \
    TMPDIR=/tmp

COPY images/worker/entrypoint.mjs /usr/local/lib/chuggy/worker.mjs
COPY images/worker/claude.mjs /usr/local/lib/chuggy/claude.mjs
COPY images/worker/lease.mjs /usr/local/lib/chuggy/lease.mjs
COPY images/worker/postgres.mjs /usr/local/lib/chuggy/postgres.mjs
COPY images/worker/repository.mjs /usr/local/lib/chuggy/repository.mjs
COPY images/worker/source.mjs /usr/local/lib/chuggy/source.mjs
COPY images/worker/transport.mjs /usr/local/lib/chuggy/transport.mjs
COPY --chmod=0555 images/worker/git-askpass.sh /usr/local/lib/chuggy/git-askpass.sh

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/lib/chuggy/worker.mjs"]
