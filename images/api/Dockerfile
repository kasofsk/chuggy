# The native HTTP API, run the way `package.json`'s `start:native-web` runs it:
# Node strips the types as it loads them. There is no compiled artifact for an
# image to ship instead — `tsconfig.json` sets `noEmit` and `erasableSyntaxOnly`,
# so the sources are the deliverable and a build stage here would be a second
# way to produce something the tree never produces.
#
# THE BASE IS NODE 26 because `package.json` types this tree against
# `@types/node` ^26. A runtime on an older line admits every call the
# typechecker has already accepted, and finds out at request time. The digest is
# the multi-architecture index's, read on 2026-08-22 with
#   docker buildx imagetools inspect node:26.7.0-trixie-slim
#
# THE CONTEXT IS THE REPOSITORY ROOT:
#   docker build -f images/api/Dockerfile -t chuggy.invalid/api:<tag> .
# `deploy/rig/images/build-and-import.sh` is that command plus the tag and the
# import, and `deploy/rig/images/README.md` is the procedure.

FROM node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS dependencies
WORKDIR /srv/chuggy
COPY package.json package-lock.json ./
# Production dependencies only, and none of their install scripts: this tree's
# runtime dependencies are all pure JavaScript, so a script running here would
# be one nothing needs.
RUN npm ci --omit=dev --ignore-scripts

FROM node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503

# The source binds 127.0.0.1, which is right on a developer's machine and
# unreachable by a kubelet: a container's loopback is its own namespace's. The
# default stays as it is in the source and the image states the deployment
# shape, which a deployment may override again.
ENV NODE_ENV=production \
	CHUG_API_HOST=0.0.0.0

# THE FINALIZER SHELLS OUT TO GIT and this base ships none, so its
# `git-available` precondition is unmet and the command exits reporting a gap no
# operator can close from outside the image. `src/compose.ts` builds the git port
# on demand for exactly that reason: the precondition is what names the absence,
# and `scratchOpen`'s own refusal would arrive too late to. The other four
# commands this image serves never call git; one image serving five is what puts
# it in all of them, and splitting the image for one is the larger change.
#
# CA-CERTIFICATES IS NAMED BECAUSE --no-install-recommends DROPS IT. Debian's
# git only recommends it, and this base carries no bundle of its own, so git
# installed without it resolves every HTTPS remote to a certificate error. That
# failure is invisible where it matters: `gitAvailablePrecondition` asks only
# for `git --version`, so it would pass, and `scratchObserveHead` reports the
# error as `Unreachable` — a finalizer that starts clean and calls every
# repository down, which is worse than the one that could not start at all.
#
# NOT PINNED, because what this depends on is a floor rather than a version:
# `gitVersionMin` in `src/adapters/git/gitRun.ts` is the oldest git whose
# `merge-tree` writes trees, and `gitAvailablePrecondition` reads
# `git --version` and refuses below it. The pinned base's candidate clears it
# today —
#   docker run --rm \
#     node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 \
#     sh -c 'apt-get -qq update && apt-cache policy git'
# — and the day it does not, the finalizer says so by name instead of promoting
# against a git that cannot write the tree.
#
# THE COST IS THE ARGUMENT FOR SPLITTING THIS IMAGE LATER, and it is the layer
# rather than the certificates: git and its dependencies are most of it, the CA
# bundle a rounding error beside them.
#   docker image inspect --format '{{.Size}}' chuggy.invalid/api:<tag>
# against a build of this file with the RUN removed is the comparison. What
# lands on the API pod with it is a Perl interpreter and a network-capable
# libcurl; `perl`, `git-man` and `libcurl3t64-gnutls` are hard dependencies
# rather than recommendations, so no install line is leaner and the lever is the
# split, not this RUN.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /srv/chuggy
COPY --from=dependencies /srv/chuggy/node_modules ./node_modules
# `type: module` is here, and Node reads it to decide that a `.ts` file is ESM.
COPY package.json ./
COPY src ./src

# Numeric, because `runAsNonRoot` refuses a user the image names only by word —
# it cannot tell that `node` is not root. 1000 is this image's `node` user.
USER 1000:1000
EXPOSE 3000

# Exec form, so node is PID 1 and is handed SIGTERM itself. `src/roots/nativeHttp.ts`
# drains on that signal; a shell in between would swallow it.
CMD ["node", "--experimental-strip-types", "src/roots/nativeHttp.ts"]
