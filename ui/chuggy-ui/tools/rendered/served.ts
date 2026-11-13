/**
 * The built console served on a loopback port as the image serves it: every
 * file of the document root with the headers `servedHeaders.ts` reads from
 * `images/chuggy-ui/nginx.conf`, and the index for any path with no file
 * behind it.
 *
 * WHAT THE IMAGE LEAVES TO AN INSTALLATION IS ANSWERED HERE, ON THE SAME
 * ORIGIN: the deployment's `/config.json`, an issuer under `/issuer`, and the
 * API the Ingress routes. `stubApi.ts` is that API. The issuer answers
 * discovery and a refresh-token grant with an opaque access token, and refuses
 * anything else: the console's own session code runs, and a case signs in by
 * the refresh token it stores, which is the narrowest seam the flow has.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

import { servedHeadersAt, servedHeadersRead } from "./servedHeaders.ts";
import type { ServedHeaderList, ServedHeaders } from "./servedHeaders.ts";
import { stubApiAnswer } from "./stubApi.ts";
import type { StubApiRead } from "./stubApi.ts";

const servedIssuerPrefix = "/issuer";
const servedClientId = "chuggy-ui";
const servedAudience = "https://chuggy.test/api";

/** The types a build's files are sent as; `nosniff` makes them binding. */
const servedTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

export interface Served {
  readonly origin: string;
  /** Every read the stub API had no route for, in the order it was asked. */
  readonly unanswered: readonly string[];
  readonly close: () => Promise<void>;
}

export interface ServedOptions {
  /** The document root, the build's `dist` for the console's own cases. */
  readonly root: string;
  /** Reads a case answers beyond the stub's own, checked ahead of them. */
  readonly reads?: readonly StubApiRead[];
  readonly headers?: ServedHeaders;
}

interface ServedSite {
  readonly root: string;
  readonly headers: ServedHeaders;
  readonly reads: readonly StubApiRead[];
  readonly unanswered: string[];
  origin: string;
}

function servedSend(
  response: ServerResponse,
  answer: {
    readonly headers: ServedHeaderList;
    readonly status: number;
    readonly type: string;
    readonly body: string | Buffer;
  },
): void {
  for (const [name, value] of answer.headers) response.setHeader(name, value);
  response.setHeader("content-type", answer.type);
  response.statusCode = answer.status;
  response.end(answer.body);
}

/** JSON as an installation answers it: the image's own headers on
 * `/config.json`, and none of them on what the Ingress routes elsewhere. */
function servedJson(
  response: ServerResponse,
  headers: ServedHeaderList,
  status: number,
  body: unknown,
): void {
  servedSend(response, {
    headers,
    status,
    type: "application/json",
    body: JSON.stringify(body),
  });
}

function servedConfiguration(site: ServedSite): unknown {
  return {
    issuer: `${site.origin}${servedIssuerPrefix}`,
    clientId: servedClientId,
    audience: servedAudience,
    redirectUri: `${site.origin}/auth/callback`,
    scopes: ["openid", "offline_access"],
  };
}

function servedIssuer(
  site: ServedSite,
  pathname: string,
  form: URLSearchParams,
): { readonly status: number; readonly body: unknown } {
  const issuer = `${site.origin}${servedIssuerPrefix}`;
  if (pathname === `${servedIssuerPrefix}/.well-known/openid-configuration`)
    return {
      status: 200,
      body: {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
      },
    };
  if (
    pathname === `${servedIssuerPrefix}/token` &&
    form.get("grant_type") === "refresh_token" &&
    (form.get("refresh_token") ?? "") !== ""
  )
    return {
      status: 200,
      body: {
        access_token: "stub-access-token",
        refresh_token: form.get("refresh_token"),
        expires_in: 3600,
      },
    };
  return { status: 400, body: { error: "invalid_request" } };
}

/** The file a path names inside the root, none where it names a directory,
 * nothing, or a place outside it. */
function servedFile(root: string, pathname: string): string | undefined {
  const path = normalize(join(root, decodeURIComponent(pathname)));
  if (!path.startsWith(root)) return undefined;
  return existsSync(path) && statSync(path).isFile() ? path : undefined;
}

function servedStatic(
  site: ServedSite,
  response: ServerResponse,
  pathname: string,
): void {
  const file = servedFile(site.root, pathname) ?? join(site.root, "index.html");
  const type = servedTypes[extname(file)] ?? "application/octet-stream";
  servedSend(response, {
    headers: servedHeadersAt(site.headers, pathname),
    status: 200,
    type,
    body: readFileSync(file),
  });
}

/** Opened with a comment, which is a byte the console's read deadline counts,
 * and left open until the site closes. */
function servedStream(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("cache-control", "no-store");
  response.write(": open\n\n");
}

async function servedBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function servedApi(
  site: ServedSite,
  response: ServerResponse,
  method: string,
  url: URL,
): void {
  const answer = stubApiAnswer(site.reads, method, url);
  if (answer === undefined) {
    site.unanswered.push(`${method} ${url.pathname}${url.search}`);
    servedJson(response, [], 404, { error: "NotFound" });
  } else if (answer.kind === "Stream") servedStream(response);
  else servedJson(response, [], answer.status, answer.body);
}

async function servedAnswer(
  site: ServedSite,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", site.origin);
  const pathname = url.pathname;
  if (pathname === "/config.json")
    servedJson(
      response,
      servedHeadersAt(site.headers, pathname),
      200,
      servedConfiguration(site),
    );
  else if (pathname.startsWith(`${servedIssuerPrefix}/`)) {
    const form = new URLSearchParams(await servedBody(request));
    const answer = servedIssuer(site, pathname, form);
    servedJson(response, [], answer.status, answer.body);
  } else if (pathname.startsWith("/api/") || pathname.startsWith("/access/"))
    servedApi(site, response, request.method ?? "GET", url);
  else servedStatic(site, response, pathname);
}

export async function servedOpen(options: ServedOptions): Promise<Served> {
  const site: ServedSite = {
    root: normalize(options.root),
    headers: options.headers ?? servedHeadersRead(),
    reads: options.reads ?? [],
    unanswered: [],
    origin: "",
  };
  if (!existsSync(join(site.root, "index.html")))
    throw new Error(`${site.root} holds no index.html to serve`);
  const server = createServer((request, response) => {
    servedAnswer(site, request, response).catch((failure: unknown) => {
      response.statusCode = 500;
      response.end(String(failure));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  site.origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    origin: site.origin,
    unanswered: site.unanswered,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((failure) => {
          if (failure === undefined) resolve();
          else reject(failure);
        });
      }),
  };
}
