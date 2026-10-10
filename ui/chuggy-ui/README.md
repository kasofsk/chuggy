# chuggy-ui

The console born against the project event stream. It builds: React and
TypeScript through Vite, with TanStack Query holding the cache a live frame is
written into and TanStack Router carrying the partition in the path. Hand CSS,
dark, dense; Radix's headless primitives behind the controls a browser does
not supply — a menu, a tooltip, a disclosure — and no styled component
library; Tailwind generates the utilities over those same tokens and nothing
else, with no preflight and no default theme.

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
  its bar, its chat pane and its live/degraded banner, the compositions a
  screen is built from, and the route tree.
- `ui/chuggy-ui/app/browser/ui/` — the primitives: a component and its
  stylesheet beside it, drawing values it is handed and reaching nothing else
  in `browser/`, which is the rule `chuggy-ui-primitives-reach-no-effect`
  states and is why each mounts in a suite with no provider around it.
- `ui/chuggy-ui/app/browser/conversation/` — the one conversation surface,
  shared by the shell's chat pane, a run's transcript and the lead's
  dispatches.
  `chuggy-ui-conversation-owns-assistant-ui` makes it the only module that
  names `@assistant-ui`; `chuggy-ui-conversation-reaches-only-primitives`
  bounds it to itself, `browser/ui/`, the decision layer and the contract, so
  it too mounts in a suite with no provider.
- `ui/chuggy-ui/app/styles/` — `tokens.css`, the one file that states a colour
  or a size, `base.css`, the element defaults, and `utilities.css`, which maps
  Tailwind's namespaces onto those tokens by reference. Both themes are
  defined in the same line through `light-dark()`, and the shell's control
  chooses between them by putting `data-theme` on the document element.
- `ui/chuggy-ui/app/browser/ticket/` — the ticket page's own compositions and
  its one `@layer page` sheet: the head, the situation column, the ledger, the
  usage panel and the main body. `ticketPageFacts.ts` derives what the page
  draws from the reads it already holds, so each part is handed facts rather
  than a query.
- `ui/chuggy-ui/app/styles.css` — what the pages that have not moved to the
  design system still draw with; it shrinks as they move.
- `ui/chuggy-ui/terminal/` — the setup program's entry and its Node adapters:
  files, a lock, a listener, child processes, the machine's own paths and
  requests, filling the ports `ui/chuggy-ui/app/core/setupPorts.ts` declares.
  Its decisions are in `app/core/` with the console's own.
  `ui/chuggy-ui/terminal/built.ts` is not part of the program: it is the
  build's last step, which starts what was built.
- `ui/chuggy-ui/test/` — the suites, run by the console's own runner.
- `ui/chuggy-ui/config.example.json` — the shape of the runtime configuration.

Those splits are rules in `.dependency-cruiser.cjs` rather than conventions: the
served source reaches nothing else in this directory, the decision layer
reaches only itself, `src/contract/` and the parser that contract is written in,
and `chuggy-ui-terminal-reaches-a-closed-roster` names every Node builtin the
terminal program may reach beyond those.

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

`.chug/tasks/check-console-sheets.sh` reads the sheets beside those runs: its
header is the rule that a sheet states its values once — nothing outside
`app/styles/tokens.css` states a raw colour or a raw length — and states its
rules inside its own `@layer`. The order those layers end up in is asserted
over the stylesheet the build emits, by `scripts/console-policy.ts` through the
`build` script above, because the minifier drops the statement that would
otherwise carry it.

`lint` is this console's own `ui/chuggy-ui/eslint.config.js`: the root's is
scoped to a tree this directory is not in, and declines it. The root formatter
still owns these sources — there is one formatter in this tree — and only the
build output is in `.prettierignore`.

`build` writes the bundle, then the setup program beside it through
`ui/chuggy-ui/vite.terminal.config.ts`, and then runs
`scripts/check-console-policy.ts` over what it wrote, which holds the emitted
document to the policy the web image serves it under: no inline script, no
inline style, no other origin. What it decides is `scripts/console-policy.ts`,
and `test/scripts/consolePolicy.test.ts` holds that to every finding it names.
Last, `ui/chuggy-ui/terminal/built.ts` starts the setup program where the build
left it, under an empty home, and fails the build where the file is missing or
does not print and exit as a first run does.

## Runtime configuration

The console reads `/config.json` at start-up, so one artifact serves every
installation. Copy `ui/chuggy-ui/config.example.json`, fill in the
installation's issuer, client identity, audience and redirect, and mount it at
the document root. A configuration that cannot be read is a drawn state, not a
blank page.

`audience` is the API's own identity and not this console's host: without it the
access token comes back with an empty audience and every read is refused.

`inviteCookieDomain` is the one key a deployment may leave out. An invite link
is opened at `/invite`, and its token crosses the sign-in in a cookie,
`chuggy_invite`, which the deployment's sign-in hook reads to admit a person
with no account. Name the domain the console and the sign-in service share, so
that service is sent the cookie. Without the key the cookie is the console
host's own, which still carries a person who has an account.

## The image

`images/chuggy-ui/Dockerfile` installs and bundles this console inside the
build, so what it serves is a function of the commit rather than of whichever
Node the host had:

```sh
deploy/rig/images/build-and-import.sh chuggy-ui
```

`deploy/rig/images/README.md` is the procedure and says what the image answers.
`images/chuggy-ui/nginx.conf` sends `default-src 'none'` with
`script-src 'self'` and `style-src 'self'`, and the emitted document loads one
script and one stylesheet from this origin and nothing else.

## The setup program

A second program of this workspace, which a person's coding agent fetches from
the console's own origin and runs under Node:

```sh
curl -fsS https://<site>/chuggy-setup.mjs -o chuggy-setup.mjs
node chuggy-setup.mjs --site https://<site>
```

It is one file with nothing to install, and it runs on Linux and macOS: on any
other platform it says so and does nothing. Every line it prints is a word from
a closed set, a colon and its text; the last is `next:` and names the exact
command to run after it, or says to stop. It says to stop where running a
command again would mend nothing until something else has changed: where the
Node it was run under is too old, after a sign-in that was declined, left to
expire or refused, where the site or the sign-in server did not answer, where
the machine would not keep its files or another run held them, and where a
step of setup waits on her. A `rule:` line then names the command and what
must be so before it is run. How the last
sign-in ended is said once by whichever command meets it first; from then on
the bare command goes on saying it, and the next `sign-in` opens a page. It
exits 0 where the last line is to be followed, 1 where it failed and 2 where it
was asked wrongly or cannot run on this machine.

Run bare and signed in, it prints the checklist: a `step:` line for each step
of setup in order (workspace, project, github, repository, runner, ticket),
saying it is done, waiting on something named, to do or not read, and then the
one next thing. It sends the site nothing but reads and keeps nothing of what
they answered: the site is the record. The sign-in server is sent one renewal,
and where the site refuses the sign-in, one more and then the revocation of the
token, which is forgotten. Each read stands by itself, so one the site refused,
failed or sent only part of leaves its own step not read and is said as that.
Once a repository is added the github step is held to it: done only where both
apps on the account that owns it are granted that repository, which is read
from each of the two installations' own listings and from no other.
The runner's step is the one the program does. For any other step that is the
first not done, a `tell:` line says what mends it, a console page and what to
press there wherever a page is what does, and `next:` is `stop`. At the
runner's step it looks at the machine and changes nothing. Where a runner could
be put there, one `tell:` says what `runner` would put on the machine and the
`rule:` names that command for once she says yes; where one could not (a Mac,
user services that do not answer, no container engine that answers her without
a password) the `tell:` says that instead.

With one workspace and one project there is nothing to choose. Otherwise
`--workspace` and `--project` name them, and every command the program prints
carries them, so the conversation holds the choice and no file does. Where one
is still to be chosen an `ask:` line puts the question to the person, and the
`rule:` line names the flag her answer goes in. The list of projects is read to
its end, and no name is taken from a list that did not end; a project named
with both flags is read by its name. Run in a git checkout whose
`origin` is a repository added to exactly one of her projects, it proposes that
project and says so in a `found:` line. It asks `git` for that address and
prints only its host and path, never a credential the address carried.

`sign-in` opens the installation's sign-in in a browser and takes the answer on
`127.0.0.1`, as the public client `chuggy-setup`. It remembers the site and the
renewal token in the person's home directory and never prints the token. The
issuer hands a new token back for each one it is shown, so before one is shown
the program keeps room in that directory for the next: a home that will not
take it is said as that, with its path, and the sign-in is not spent.

`runner --workspace <w> --project <p>` sets a runner up for that project on the
Linux machine it is run on, and is done once the site sees the runner live;
`--wait-secs` bounds that wait. The machine is the record of the machine's
things and the site of the site's, and the program keeps neither: every act is
preceded by the probe that would show it done, so the command is run again
after any failure and picks up where things stand. In order it has the runner
package installed, by the console's own install command and under a prefix in
her home directory where npm's own is not hers to write; the package's
settings written, with its guide's values, where there are none; the machine
registered; the package's own check passed; its service installed; her
services set to outlive a logout; and the service enabled and started. For a
registration it mints a registration token, which is the one write it sends a
site, and hands it to the package's `register` as one word of its arguments
and nowhere else.
It takes no password: a child has no terminal to ask on, and what wants one is
told to her to do herself. It does not make the runner's Claude login, and
stops where there is none. Nothing a child prints is printed: a failure keeps
one short excerpt with the run's secrets struck out.

## The session

OIDC authorization code with PKCE against the issuer `/config.json` names, with
a public client that authenticates with nothing. The access token lives in
memory for the life of the tab; the refresh token is what reaches
`localStorage`, so a reload or a restart keeps the session without an access
token ever being written down. The renewal happens before expiry. Every tab of
a browser shares that one stored token and the issuer rotates it, so a tab
renews with the token the store holds at that moment, one tab at a time under a
Web Lock, and signing out in one tab signs the others out. A tab is one
sign-in's for as long as it is loaded: each sign-in stores a random mark beside
its token, which a renewal leaves, and a tab that finds another mark there ends
its own session, reads `Session changed` and offers a reload, sending and
revoking nothing more. A tab the issuer redirected back with a sign-in of its
own to complete takes no stored session until that sign-in has answered; the
callback address opened in a tab that began none takes the stored session at
once. A renewal the issuer refuses ends the session at once; one that got no
answer keeps it, a gateway's own status and a request given up at its bound
among those; one answered unusably is on a budget, so such an issuer ends the
session once rather than being asked forever. Signing out clears the store and
revokes the refresh token where the issuer publishes an endpoint for it.

## Connecting a forge account

A forge account is the tenant's, not any one project's, so the Accounts panel
is a workspace page of the settings: `/$tenant/$project/settings/workspace/accounts`
inside a project and `/tenants/$tenant/settings/accounts` outside one. The
Repositories page offers `Connect GitHub` itself while the tenant has no
account, and the worker App's install where a connected account lacks it.

`Connect GitHub` sends the person to authorize the portal App, with a state and
a PKCE challenge the console draws the way the sign-in's are drawn. The state,
the verifier and the press (its tenant, the page it began on, the Apps it has
gone on to install) are stored in `sessionStorage` under one key. The forge
returns to `/forge/github/callback`, which takes that transaction once and
posts the code only when the state it was sent matches; a callback reached
without a matching transaction says "Not expected", posts nothing and links
home. The page then drops the code and state from the address. The api claims
each account the authorization proves the person owns, with the worker App's
installation on it. A press goes on to an install the answer leaves, each App's
at most once: the portal App's where a whole answer reached no account they
own, the worker App's where one they own lacks it. Otherwise it returns to the
page it began on, and anything short of a plain connection comes back as one
word, held in `sessionStorage` and shown once on that page.

On the Accounts page `Connect GitHub` is the one action until an account is
connected or a press returns having reached none the person owns. Then
`Add account` installs the portal App, and an account without the worker App
offers that App's install on its own row. Every install stores a state of its
own and the press, naming its App, under a second key. The forge sends the
person back to `/forge/github/setup`, which takes that transaction once and,
when the state matches, goes on to the authorization with the press; an install
an owner has to approve returns with "Requested".

Both Apps' Setup URL must be that route on the console's own host, with
"Redirect on update" set so an App already installed comes back too, and the
portal App's callback URL the callback route; an operator sets each on the App
in the forge.

## The ticket page

A ledger, not a dashboard. The cycles are the machine's own: every `work-passed`
opens one with a new artifact, and each is judged by a fresh run of the program
against that artifact, so the page groups by cycle and the current one is railed
and open while the superseded ones are dimmed and closed. A stage the program
short-circuited is a row saying so, which is what tells "not reached" from "not
on this page".

Every row, cycle and ticket carries what it spent and how long it took, and
every dollar carries the basis the wire gave it, so a list price is never read
as a bill. The situation column holds exactly the notice — a phase, a wall or
a blocked dependency — the actions and a list of anchors; the brief, the
provenance and the configuration are in the main body under the ledger,
reached by those anchors rather than by tabs.

`core/figures.ts` formats every measured number, `core/tones.ts` maps the wire's
own words to the tones a pill draws, and `core/codeLabels.ts` turns a code into
the short label the page shows. The theme control belongs to the shell and never
to a page.
