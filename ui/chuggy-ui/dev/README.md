# The console, local, against a running installation

```sh
just ui-local
```

Then open the address it prints. The console is served from this checkout with
its sources watched, so an edit is a reload; everything behind `/api/v1` is the
installation `compose.yaml` names, which by default is the rig. **Every action
taken here is taken there.** A dispatch is a dispatch, a revoke is a revoke,
and there is no local database to reset.

## Why an installation and not a fixture

A fixture is an account of the wire written by whoever wrote it, and the states
this console is hard to get right are the ones a fixture is worst at: a panel
still loading, a stream arriving row by row, a degraded banner, a run that
costs what it costs. Those exist where the work does. A local API would answer
the same schemas over an empty database, so the data would have to be authored
anyway — in SQL rather than in JSON.

## What the installation had to register

One OAuth client, `chuggy-ui-local`: public, PKCE, the API's audience, and a
redirect on each of the ports `compose.yaml` publishes — `CHUG_UI_PORT` may be
5173, 5174, 5175 or 5176, and a port outside that set is refused by the issuer
rather than by anything here. Nothing else about the installation changes: the
deployed clients, the services and the manifests are untouched.

Undo, on the installation's issuer:

```sh
hydra delete oauth2-client chuggy-ui-local
```

## How sign-in reaches an issuer that has never heard of this origin

The issuer answers a browser only from the origins its own configuration lists,
and it consults that list for discovery — a request carrying no client id,
which no client registration can widen. So `vite.config.ts` serves the
discovery document itself, upstream's with the endpoints a browser *fetches*
rewritten onto this origin, and proxies those two under `/issuer/oauth2`. The
exchange and the revocation are then same-origin, the authorization request is
a navigation the issuer answers as it answers any other, and the installation's
CORS list stays what it was.

`/config.json` is served the same way, derived from the address the browser
asked on, so the redirect the console registers is the port it was reached on.

## Somewhere else

```sh
CHUG_UI_UPSTREAM=https://chuggy.vteng.io \
CHUG_UI_CLIENT_ID=<a client that installation registered for this port> \
  just ui-local
```

`CHUG_UI_ISSUER` and `CHUG_UI_AUDIENCE` are the other two, and every one of
them has the rig's value as its default.
