# chuggy-ui

The console born against the project event stream. It builds: React and
TypeScript through Vite, with TanStack Query holding the cache a live frame is
written into and TanStack Router carrying the partition in the path. Hand CSS,
dark, dense; no component library.

It is an npm workspace of this repository, declared in the root `package.json`,
so `npm ci` at the root installs it and `ui/chuggy-ui/package.json` pins what it
builds with.

## What is here

- `ui/chuggy-ui/app/core/` — the decisions, and nothing that touches a browser:
  the typed client over `src/contract/`, the authorization flow, the session,
  the event-stream decoder and the stream client, the query-key scheme, what a
  change frame does to the cache, and how fresh a panel's data is. Every
  capability it needs arrives as a port, which is why `ui/chuggy-ui/test/` can
  drive all of it with no renderer.
- `ui/chuggy-ui/app/browser/` — the effects and the drawing: the platform
  adapters, the React providers for the session and the stream, the shell with
  its project switcher and its live/degraded banner, the panel component, and
  the route tree.
- `ui/chuggy-ui/app/styles.css` — the whole stylesheet, tokens first.
- `ui/chuggy-ui/test/` — the suites, run by the console's own runner.
- `ui/chuggy-ui/config.example.json` — the shape of the runtime configuration.

Those splits are rules in `.dependency-cruiser.cjs` rather than conventions: the
served source reaches nothing else in this directory, and the decision layer
reaches only itself, `src/contract/` and the parser that contract is written in.

## The contract is imported, never restated

Types, schemas, routes, outcome classification and the event shapes all come
from `src/contract/`, by relative path. Vite resolves it because the dev
server is allowed to read the repository root and because the production build
follows the import like any other; there is no alias, so `tsc` and
`.chug/tasks/check-boundaries.sh` see the same edges a bundler does.

## The commands the gate runs

`.chug/tasks/check-console.sh` runs these, in this order, from this directory:

```sh
npm run typecheck --prefix ui/chuggy-ui
npm run lint      --prefix ui/chuggy-ui
npm run test      --prefix ui/chuggy-ui
npm run build     --prefix ui/chuggy-ui
```

`lint` is this console's own `ui/chuggy-ui/eslint.config.js`: the root's is
scoped to a tree this directory is not in, and declines it. The root formatter
still owns these sources — there is one formatter in this tree — and only the
build output is in `.prettierignore`.

`build` writes the bundle and then runs `scripts/check-console-policy.ts` over
what it wrote, which holds the emitted document to the policy the web image
serves it under: no inline script, no inline style, no other origin.

## Runtime configuration

The console reads `/config.json` at start-up, so one artifact serves every
installation. Copy `ui/chuggy-ui/config.example.json`, fill in the
installation's issuer, client identity, audience and redirect, and mount it at
the document root. A configuration that cannot be read is a drawn state, not a
blank page.

`audience` is the API's own identity and not this console's host: without it the
access token comes back with an empty audience and every read is refused.

## The image

`images/web/Dockerfile` serves whatever directory it is pointed at, so this
console's build output is that directory:

```sh
npm run build --prefix ui/chuggy-ui
CHUG_WEB_SITE=<the dist directory this build wrote> \
  deploy/rig/images/build-and-import.sh web
```

`deploy/rig/images/README.md` is the procedure and says what the image answers.
Nothing about that image changes for this console: `images/web/nginx.conf`
already sends `default-src 'none'` with `script-src 'self'` and
`style-src 'self'`, and the emitted document loads one script and one stylesheet
from this origin and nothing else.

## The session

OIDC authorization code with PKCE against the issuer `/config.json` names, with
a public client that authenticates with nothing. The access token lives in
memory for the life of the tab; the refresh token is what reaches
`localStorage`, so a reload or a restart keeps the session without an access
token ever being written down. The renewal happens before expiry, on a budget:
an issuer that keeps declining ends the session once rather than being asked
forever. Signing out clears both and revokes the refresh token where the issuer
publishes an endpoint for it.
