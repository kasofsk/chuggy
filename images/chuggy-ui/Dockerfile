# The console, bundled inside the build and served by an nginx that does
# nothing else. The install and the bundle are the image's rather than the
# host's, so what is served is a function of the commit and not of whichever
# Node and `node_modules` the build host had. `images/chuggy-ui/nginx.conf` is
# the whole of what the image answers, and says what a deployment must mount.
#
# THE CONTEXT IS THE REPOSITORY ROOT: the console reaches `src/contract/`, and
# the policy scripts the build runs are the tree's, so the build stage copies
# them in rather than vendoring a second copy.
#
#   docker build -f images/chuggy-ui/Dockerfile -t chuggy.invalid/chuggy-ui:<tag> .

FROM node:26.7.0-trixie-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY ui/chuggy-ui/package.json ui/chuggy-ui/package.json
RUN npm ci --ignore-scripts

COPY scripts/check-console-policy.ts scripts/console-policy.ts scripts/
COPY src/contract src/contract
COPY ui/chuggy-ui ui/chuggy-ui
RUN npm run build --workspace=chuggy-ui

FROM nginx:1.31.4-alpine3.24@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913

# The whole configuration, rather than a fragment dropped beside the shipped
# one: everything writable is moved under /tmp so the container can run with a
# read-only root filesystem.
COPY images/chuggy-ui/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/ui/chuggy-ui/dist/ /usr/share/nginx/html/

# The mount point for the deployment's `/config.json`, and empty: a file
# mounted by subPath needs its directory to be there already, and a directory
# mounted whole needs nothing of the image's underneath it.
RUN mkdir -p /etc/chuggy/web

# Numeric for the same reason as `images/api/Dockerfile`. 101 is this image's
# `nginx` user.
USER 101:101
EXPOSE 8080

# The shipped entrypoint rewrites configuration under /etc/nginx from templates
# and its own environment. This image has one configuration, it is the one
# above, and a read-only root filesystem refuses the rewrite anyway.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
