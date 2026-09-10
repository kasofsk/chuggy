/**
 * The console's build, its dev server and its suite runner.
 *
 * The dev server is the setting with a reason outside this file: `src/contract/`
 * is imported from outside this root, so the root above has to be readable or
 * the console will not start. The rest is the shape of the console — React, a
 * suite runner with a document, and suites that live in one directory. What the
 * production build emits is held to the policy the web image serves it under by
 * `scripts/check-console-policy.ts`, which the `build` script runs.
 *
 * `execArgv` is the other setting with a reason outside this file. Node now
 * defines `localStorage` on its own global, as a getter that yields undefined
 * unless a storage file was named, and the suite runner only copies a document
 * property onto the global when the global lacks it.
 * A suite would then read Node's undefined where it expects the document's
 * storage. Leaving Node's web storage off is what keeps the runner on the
 * document's, on every Node line the suites run under.
 *
 * `CHUG_UI_UPSTREAM` is what turns this dev server into a console of a running
 * installation, and it names one: the origin serving that installation's
 * `/api/v1`. Unset, none of it is installed and `vite` serves the console as it
 * always did. `ui/chuggy-ui/dev/README.md` is the procedure and holds the
 * installation's values; what is here is only the mechanism.
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

const upstream = process.env["CHUG_UI_UPSTREAM"];
const issuer = process.env["CHUG_UI_ISSUER"] ?? "";
const audience = process.env["CHUG_UI_AUDIENCE"] ?? "";
const clientId = process.env["CHUG_UI_CLIENT_ID"] ?? "";

const issuerPrefix = "/issuer";
const discoveryPath = "/.well-known/openid-configuration";

type Middleware = Connect.NextHandleFunction;

/** The browser's own address, so a console reached on any port configures. */
function requestOrigin(request: Parameters<Middleware>[0]): string {
  return `http://${request.headers.host ?? "localhost"}`;
}

function sendJson(
  response: Parameters<Middleware>[1],
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

/**
 * The installation's configuration and its issuer, answered from this origin.
 *
 * A localhost origin is not on the issuer's CORS list and discovery carries no
 * client id for a registration to widen, so the endpoints a browser fetches
 * are moved here and the authorization endpoint, a navigation, is left the
 * issuer's own.
 */
function localInstallation(): Plugin {
  return {
    name: "chuggy-local-installation",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/config.json", (request, response) => {
        sendJson(response, 200, {
          issuer: `${requestOrigin(request)}${issuerPrefix}`,
          clientId,
          audience,
          redirectUri: `${requestOrigin(request)}/auth/callback`,
          scopes: ["openid", "offline_access"],
        });
      });
      server.middlewares.use(
        `${issuerPrefix}${discoveryPath}`,
        (request, response) => {
          void (async () => {
            const origin = requestOrigin(request);
            try {
              const discovered = await fetch(`${issuer}${discoveryPath}`);
              const document: unknown = await discovered.json();
              sendJson(response, 200, {
                ...(document as Record<string, unknown>),
                issuer: `${origin}${issuerPrefix}`,
                token_endpoint: `${origin}${issuerPrefix}/oauth2/token`,
                revocation_endpoint: `${origin}${issuerPrefix}/oauth2/revoke`,
              });
            } catch (reason) {
              sendJson(response, 502, {
                error: `the issuer ${issuer} answered nothing: ${String(reason)}`,
              });
            }
          })();
        },
      );
    },
  };
}

/** Only `/oauth2` is proxied, so the rewritten discovery is never shadowed. */
function proxy(): Record<string, ProxyOptions> {
  return {
    "/api/v1": { target: upstream ?? "", changeOrigin: true },
    [`${issuerPrefix}/oauth2`]: {
      target: issuer,
      changeOrigin: true,
      rewrite: (path: string) => path.slice(issuerPrefix.length),
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(upstream === undefined ? [] : [localInstallation()]),
  ],
  server: {
    fs: { allow: ["../.."] },
    ...(upstream === undefined ? {} : { proxy: proxy() }),
  },
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
