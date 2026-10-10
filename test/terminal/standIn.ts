/**
 * A stand-in installation on this machine's own address: a site that serves
 * its configuration and the reads the setup program makes, and an issuer that
 * behaves as the real one was found to.
 *
 * What the site holds is the model the console's own suites describe a site
 * with, so a state of setup means the same here as there; a case sets it and
 * the site answers each read from it, to whoever holds a token the issuer
 * handed out. Every request either server was sent is kept with its method.
 *
 * The issuer registers the setup client with one redirect and accepts it on
 * any port of `127.0.0.1`, refuses `localhost`, and matches the path exactly.
 * It checks the proof key, hands a code out once, hands out a new renewal
 * token for each one it is shown, and ends the whole sign-in when shown a
 * spent one. A token request that is not sent as a form is refused unread,
 * and costs the sign-in nothing. It publishes where a token is revoked, and a
 * renewal token revoked there ends the sign-in as a spent one does. Every
 * value it hands out is kept, so a suite can search everything the program
 * wrote for any of them.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  setupSiteAnswered,
  setupSiteAt,
} from "../../ui/chuggy-ui/test/setupSite.ts";
import type { SetupSite } from "../../ui/chuggy-ui/test/setupSite.ts";

export const standInAudience = "https://chuggy.invalid/api";
const client = "chuggy-setup";
const scope = "openid offline_access";
const formType = "application/x-www-form-urlencoded";

export interface StandIn {
  readonly site: string;
  readonly issuer: string;
  /** Every code, access token and renewal token handed out. */
  readonly issued: Set<string>;
  /** Every request line either server was sent, and every body. */
  readonly asked: string[];
  /** Each ask of the token endpoint, as its grant and whether it was granted. */
  readonly grants: string[];
  /** Each ask of the revocation endpoint, as the names of what it carried and whether what it named was the sign-in's renewal token. */
  readonly revocations: string[];
  /** Why the issuer refused to start a sign-in, each time it did. */
  readonly refusals: string[];
  /** Whether the person allows the sign-in, and whether allowing hands over a renewal token. */
  allows: boolean;
  renewable: boolean;
  /** Whether the site answers its reads, or says of each that it cannot. */
  serves: boolean;
  /** What the site holds, which is what its reads answer. */
  world: SetupSite;
  /** Whether the site takes the tokens the issuer hands out, or refuses whoever holds one. */
  admits: boolean;
  /** What happens once the issuer has granted a renewal, before its answer is sent back. */
  renewed: () => void;
  readonly renewal: () => string | undefined;
  readonly close: () => Promise<void>;
}

interface Granted {
  readonly challenge: string;
  readonly redirect: string;
}

interface Issuer {
  readonly codes: Map<string, Granted>;
  readonly access: Set<string>;
  renewal: string | undefined;
}

function minted(standIn: StandIn): string {
  const value = randomBytes(24).toString("base64url");
  standIn.issued.add(value);
  return value;
}

function sent(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Why a sign-in is not started, or nothing where it is. */
function authorizeFault(query: URLSearchParams): string | undefined {
  if (query.get("client_id") !== client) return "unknown client";
  if (query.get("response_type") !== "code") return "not a code flow";
  if (query.get("scope") !== scope) return "scope";
  if (query.get("audience") !== standInAudience) return "audience";
  if (query.get("code_challenge_method") !== "S256") return "no proof key";
  if ((query.get("code_challenge") ?? "") === "") return "no proof key";
  if ((query.get("state") ?? "") === "") return "no state";
  const redirect = new URL(query.get("redirect_uri") ?? "http://invalid");
  if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1")
    return `redirect host ${redirect.hostname}`;
  return redirect.pathname === "/callback" && redirect.search === ""
    ? undefined
    : `redirect path ${redirect.pathname}`;
}

function authorize(
  standIn: StandIn,
  issuer: Issuer,
  query: URLSearchParams,
  response: ServerResponse,
): void {
  const fault = authorizeFault(query);
  if (fault !== undefined) {
    standIn.refusals.push(fault);
    sent(response, 400, { error: "invalid_request" });
    return;
  }
  const redirect = query.get("redirect_uri") ?? "";
  const back = new URL(redirect);
  back.searchParams.set("state", query.get("state") ?? "");
  if (standIn.allows) {
    const code = minted(standIn);
    issuer.codes.set(code, {
      challenge: query.get("code_challenge") ?? "",
      redirect,
    });
    back.searchParams.set("code", code);
  } else back.searchParams.set("error", "access_denied");
  response.writeHead(302, { location: back.href });
  response.end();
}

function tokens(standIn: StandIn, issuer: Issuer, renewable: boolean): unknown {
  const access = minted(standIn);
  issuer.access.add(access);
  if (!renewable) return { access_token: access, expires_in: 600 };
  issuer.renewal = minted(standIn);
  return {
    access_token: access,
    refresh_token: issuer.renewal,
    expires_in: 600,
  };
}

function exchanged(issuer: Issuer, form: URLSearchParams): boolean {
  const code = form.get("code") ?? "";
  const granted = issuer.codes.get(code);
  issuer.codes.delete(code);
  if (granted === undefined) return false;
  const proved = createHash("sha256")
    .update(form.get("code_verifier") ?? "")
    .digest("base64url");
  return (
    proved === granted.challenge &&
    form.get("redirect_uri") === granted.redirect
  );
}

function token(
  standIn: StandIn,
  issuer: Issuer,
  form: URLSearchParams,
  response: ServerResponse,
): void {
  const grant = form.get("grant_type") ?? "";
  const granted =
    form.get("client_id") === client &&
    (grant === "authorization_code"
      ? exchanged(issuer, form)
      : issuer.renewal !== undefined &&
        form.get("refresh_token") === issuer.renewal);
  standIn.grants.push(`${grant} ${granted ? "granted" : "refused"}`);
  if (granted) {
    const renewable = grant === "refresh_token" || standIn.renewable;
    const answer = tokens(standIn, issuer, renewable);
    if (grant === "refresh_token") standIn.renewed();
    sent(response, 200, answer);
    return;
  }
  if (grant === "refresh_token") {
    issuer.renewal = undefined;
    issuer.access.clear();
  }
  sent(response, 400, { error: "invalid_grant" });
}

/** Ends the sign-in where the form names its renewal token, and answers the same either way, as an issuer does. */
function revoke(
  standIn: StandIn,
  issuer: Issuer,
  form: URLSearchParams,
  response: ServerResponse,
): void {
  const mine =
    issuer.renewal !== undefined && form.get("token") === issuer.renewal;
  const carried = [...form.keys()].toSorted().join(" ");
  standIn.revocations.push(`${carried}: ${mine ? "the renewal" : "unknown"}`);
  if (mine) {
    issuer.renewal = undefined;
    issuer.access.clear();
  }
  sent(response, 200, {});
}

/** A form posted to the issuer, kept as it was sent and handed on as its fields, or nothing where it was not sent as a form. */
async function formOf(
  standIn: StandIn,
  request: IncomingMessage,
): Promise<URLSearchParams | undefined> {
  const body = await bodyOf(request);
  standIn.asked.push(body);
  return request.headers["content-type"] === formType
    ? new URLSearchParams(body)
    : undefined;
}

function issuerHandler(standIn: StandIn, issuer: Issuer) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", standIn.issuer);
    standIn.asked.push(`${request.method ?? ""} ${url.href}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      sent(response, 200, {
        issuer: standIn.issuer,
        authorization_endpoint: `${standIn.issuer}/oauth2/auth`,
        token_endpoint: `${standIn.issuer}/oauth2/token`,
        revocation_endpoint: `${standIn.issuer}/oauth2/revoke`,
      });
    } else if (url.pathname === "/oauth2/auth") {
      authorize(standIn, issuer, url.searchParams, response);
    } else if (url.pathname === "/oauth2/token" && request.method === "POST") {
      const form = await formOf(standIn, request);
      if (form !== undefined) token(standIn, issuer, form, response);
      else {
        standIn.grants.push("not a form refused");
        sent(response, 400, { error: "invalid_request" });
      }
    } else if (url.pathname === "/oauth2/revoke" && request.method === "POST") {
      const form = await formOf(standIn, request);
      if (form !== undefined) revoke(standIn, issuer, form, response);
      else sent(response, 400, { error: "invalid_request" });
    } else sent(response, 404, {});
  };
}

function siteHandler(standIn: StandIn, issuer: Issuer) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? "/", standIn.site);
    standIn.asked.push(`${request.method ?? ""} ${url.href}`);
    if (url.pathname === "/config.json") {
      sent(response, 200, {
        issuer: standIn.issuer,
        clientId: "chuggy-web",
        audience: standInAudience,
        redirectUri: `${standIn.site}/auth/callback`,
        scopes: ["openid", "offline_access", "profile"],
      });
      return;
    }
    const answer =
      request.method === "GET"
        ? setupSiteAnswered(standIn.world, `${url.pathname}${url.search}`)
        : undefined;
    const bearer = (request.headers.authorization ?? "").slice(7);
    if (answer === undefined) sent(response, 404, {});
    else if (!standIn.serves) sent(response, 500, {});
    else if (standIn.admits && issuer.access.has(bearer))
      sent(response, answer.status, answer.body);
    else sent(response, 401, {});
  };
}

function listening(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

function closed(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });
}

export async function standIn(): Promise<StandIn> {
  const issuer: Issuer = {
    codes: new Map(),
    access: new Set(),
    renewal: undefined,
  };
  const servers: Server[] = [];
  const serve = (handler: Parameters<typeof createServer>[1]) => {
    const server = createServer(handler);
    servers.push(server);
    return listening(server);
  };
  const held = {
    issued: new Set<string>(),
    asked: [] as string[],
    grants: [] as string[],
    revocations: [] as string[],
    refusals: [] as string[],
    allows: true,
    renewable: true,
    serves: true,
    admits: true,
    renewed: () => undefined,
    world: setupSiteAt("Workspace"),
    renewal: () => issuer.renewal,
    close: async () => {
      for (const server of servers) await closed(server);
    },
    site: "",
    issuer: "",
  };
  held.site = await serve((request, response) => {
    siteHandler(held, issuer)(request, response);
  });
  held.issuer = await serve((request, response) => {
    void issuerHandler(held, issuer)(request, response);
  });
  return held;
}
