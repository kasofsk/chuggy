# The operations console

A browser console over the public HTTP contract in `src/adapters/http/`. It is
plain HTML, CSS and ES modules: no build step, no bundler, no client
dependency, so what is in this directory is what a browser runs. That is this
console's shape rather than every console's — a sibling that builds is served
its bundle instead.

`ui/` holds one directory per console, and this is the operations one. What
separates them is that each is a whole artifact — its own document root, its
own `config.json`, its own image — so nothing here is shared with a sibling.

## What is here

- `ui/console/index.html` and `ui/console/styles.css` — the page and its one
  stylesheet.
- `ui/console/app/` — the console's decisions: the wire, the DTO parsers, PKCE
  and the authorization requests, the polling and paging bounds, the operation
  machine, panel state, the outcome-to-state mapping and the view models.
  Nothing here touches a document, a clock or the network, which is why
  `tsconfig.json` typechecks it and `test/ui/` covers it.
- `ui/console/dom/` — the effects: the fetch, session storage, the timer and
  the document writes. It holds no decision, and so no test.
- `ui/console/config.example.json` — the shape of the runtime configuration
  below.

Those splits are rules in `.dependency-cruiser.cjs` rather than conventions: no
console reaches this tree's source, this console reaches no package either, its
`app/` reaches nothing in its own `dom/`, and no console reaches another.

## Runtime configuration

The console reads `/config.json` at startup, so one artifact serves every
environment. Copy `ui/console/config.example.json`, fill in the installation's
issuer, client identity, audience and redirect, and mount it at the document
root. A missing or unreadable file is a drawn state, not a blank page.

`audience` is not optional: the authorization request sends it, and without it
the access token comes back with an empty audience and every API read is
refused.

## What a server must do to host it

- Serve the contents of this directory at `/`. `ui/console/index.html` is the
  document root's index.
- Serve `/config.json` from the deployment's own copy, not from this directory.
- Answer any path that does not resolve to a file with `ui/console/index.html`.
  The OAuth redirect lands on a path that is not a file, and that fallback is
  what serves the console there.
- Proxy `/api/v1/` to the API on the same origin. The contract declares
  same-origin and the server implements no cross-origin preflight, so a console
  served from another origin cannot read the API at all.
- Send no-store for `/config.json`. The rest is content-addressed by nothing
  and is safe to cache only for as long as a deployment lasts.

The console needs nothing else from its host: no cookies, no server-side
session, no secrets in the image.

## The identity provider

The console talks to the issuer directly for discovery and for the token
exchange, so that origin must allow those two cross-origin reads from the
console's origin. The token is held in memory for the life of the tab. Only the
in-flight authorization state and its verifier reach session storage, and they
are removed as soon as the redirect comes back.
