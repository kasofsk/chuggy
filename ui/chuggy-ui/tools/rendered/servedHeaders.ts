/**
 * The response headers `images/chuggy-ui/nginx.conf` sends, read from that
 * file each run, so what a rendered suite is served under is what the image
 * serves and cannot drift from it.
 *
 * It reads the `add_header` directives of the one `server` block and of each
 * exact-match `location` inside it, with nginx's own inheritance: a location
 * that declares any header sends only its own, and one that declares none
 * sends the server's. Nothing else of the file is interpreted. A file with no
 * server-level `content-security-policy` is refused rather than served
 * without one.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const servedHeadersConfigurationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../images/chuggy-ui/nginx.conf",
);

export type ServedHeaderList = readonly (readonly [string, string])[];

export interface ServedHeaders {
  /** What every response is sent with that no location below overrides. */
  readonly server: ServedHeaderList;
  /** An exact-match location's own, keyed by its path. */
  readonly locations: ReadonlyMap<string, ServedHeaderList>;
}

const addHeader = /^add_header\s+(\S+)\s+"([^"]*)"(?:\s+always)?$/u;
const exactLocation = /^location\s+=\s+(\S+)$/u;

/** Statements and braces, in order, with every comment dropped. A quoted
 * value is read whole, so the `;` inside a policy ends no statement. */
function servedHeadersTokens(text: string): readonly string[] {
  const tokens: string[] = [];
  let statement = "";
  let quoted = false;
  let comment = false;
  for (const character of text) {
    if (comment) comment = character !== "\n";
    else if (quoted) {
      statement += character;
      quoted = character !== '"';
    } else if (character === "#") comment = true;
    else if (character === '"') {
      statement += character;
      quoted = true;
    } else if ("{};".includes(character)) {
      const said = statement.trim().replace(/\s+/gu, " ");
      if (said !== "") tokens.push(said);
      tokens.push(character);
      statement = "";
    } else statement += character;
  }
  return tokens;
}

export function servedHeadersParse(text: string): ServedHeaders {
  const server: (readonly [string, string])[] = [];
  const locations = new Map<string, (readonly [string, string])[]>();
  const opened: string[] = [];
  let pending = "";
  for (const token of servedHeadersTokens(text)) {
    if (token === "{") {
      opened.push(pending);
      pending = "";
    } else if (token === "}") {
      opened.pop();
    } else if (token === ";") {
      const header = addHeader.exec(pending);
      const block = opened.at(-1) ?? "";
      const location = exactLocation.exec(block)?.[1];
      if (header !== null && block === "server")
        server.push([header[1] ?? "", header[2] ?? ""]);
      else if (header !== null && location !== undefined)
        locations.set(location, [
          ...(locations.get(location) ?? []),
          [header[1] ?? "", header[2] ?? ""],
        ]);
      pending = "";
    } else pending = token;
  }
  if (!server.some(([name]) => name === "content-security-policy"))
    throw new Error(
      "the served configuration sends no content-security-policy",
    );
  return { server, locations };
}

export function servedHeadersRead(
  path: string = servedHeadersConfigurationPath,
): ServedHeaders {
  return servedHeadersParse(readFileSync(path, "utf8"));
}

/** The headers a response at `pathname` is sent with. */
export function servedHeadersAt(
  headers: ServedHeaders,
  pathname: string,
): ServedHeaderList {
  return headers.locations.get(pathname) ?? headers.server;
}
