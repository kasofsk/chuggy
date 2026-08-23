# A static file server for the operations UI, and nothing else: it terminates no
# TLS, proxies nothing, and holds nothing between requests.
#
# THE CONTRACT WITH WHOEVER WRITES THE UI. `site` is a repository-relative
# directory and its contents become the document root. There is no default:
# this image serves what it is pointed at, and guessing would ship whatever
# happened to be at the guess. Given that directory, the whole of what this
# image answers is:
#
#   /              `index.html` at the top of the document root.
#   anything with no file behind it
#                  that same `index.html`, because the routes belong to the
#                  client. The authorization-code redirect sign-in returns to
#                  is not a file, and a 404 there ends the flow.
#   /healthz       the image's own, ahead of anything the site carries.
#   /config.json   the deployment's file, mounted at /etc/chuggy/web/config.json
#                  and answered `no-store`. It is served from outside the
#                  document root, so a copy of it inside the site is
#                  unreachable rather than merely overridden, and no
#                  configuration is baked in. Unmounted, it is a 404 rather
#                  than the index, so a UI cannot mistake markup for its
#                  configuration.
#
# So the site may claim neither `/healthz` nor `/config.json`. `/api/v1/` is
# NOT here: the API is reached same-origin through the Ingress, which routes
# the two prefixes on one host, and nothing in this image proxies.
#
# The digest is the multi-architecture index's, read on 2026-08-22 with
#   docker buildx imagetools inspect nginx:1.31.4-alpine3.24
#
# THE CONTEXT IS THE REPOSITORY ROOT:
#   docker build -f images/web/Dockerfile --build-arg site=<dir> \
#     -t chuggy.invalid/web:<tag> .

FROM nginx:1.31.4-alpine3.24@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913

# Unset, `COPY ${site}/` would resolve to the whole context and ship the
# repository as a website. It is refused while the image is still empty.
ARG site
RUN [ -n "$site" ] || { echo "the site build argument names the document root and has no default"; exit 1; }

# The whole configuration, rather than a fragment dropped beside the shipped
# one: everything writable is moved under /tmp so the container can run with a
# read-only root filesystem. `deploy/rig/images/README.md` says what to mount.
COPY images/web/nginx.conf /etc/nginx/nginx.conf
COPY ${site}/ /usr/share/nginx/html/

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
