/**
 * The setup program's two ways of asking over HTTP, against real servers.
 *
 * Neither follows a redirect, so a token meant for one address is never
 * carried to another, and each ends at its bound: the JSON one at the bound
 * it was built with, the API one when its caller's signal says so.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import {
  apiFetch,
  fetchJsonWithin,
} from "../../ui/chuggy-ui/terminal/ports.ts";
import { making } from "./program.ts";

const servers: Server[] = [];
const made = making();

after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

interface Served {
  readonly at: string;
  /** Each request as its method, path and authorization header. */
  readonly asked: string[];
}

/** A server answering every request with `status` and `location`, or never where there is no status. */
function served(status?: number, location?: string): Promise<Served> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(
      `${request.method ?? ""} ${request.url ?? ""} ${request.headers.authorization ?? ""}`,
    );
    if (status === undefined) return;
    response.writeHead(status, {
      "content-type": "application/json",
      ...(location === undefined ? {} : { location }),
    });
    response.end("{}");
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ at: `http://127.0.0.1:${String(port)}`, asked });
    });
  });
}

const json = { headers: { accept: "application/json" } };

const init = {
  method: "GET",
  headers: { authorization: "Bearer held" },
  signal: new AbortController().signal,
};

test("a request reaches the address it names with the headers it was given", async () => {
  const there = await served(200);
  assert.equal(
    (await apiFetch(`${there.at}/access/v1/workspaces`, init)).status,
    200,
  );
  const answered = await fetchJsonWithin(5_000)(
    `${there.at}/config.json`,
    json,
  );
  assert.equal(answered.status, 200);
  assert.deepEqual(there.asked, [
    "GET /access/v1/workspaces Bearer held",
    "GET /config.json ",
  ]);
});

test("neither way of asking follows a redirect, so nothing held is carried to another address", async () => {
  const elsewhere = await served(200);
  for (const status of [301, 302, 303, 307, 308]) {
    const there = await served(status, `${elsewhere.at}/taken`);
    await assert.rejects(apiFetch(`${there.at}/access/v1/workspaces`, init));
    await assert.rejects(
      fetchJsonWithin(5_000)(`${there.at}/config.json`, json),
    );
    await assert.rejects(
      fetchJsonWithin(5_000)(`${there.at}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "refresh_token=held",
      }),
    );
    assert.equal(there.asked.length, 3);
  }
  assert.deepEqual(elsewhere.asked, []);
});

test("the stand-in issuer refuses a token request that is not sent as a form, and reads one that is", async () => {
  const installation = await made.installation();
  const asked = (type: string) =>
    fetchJsonWithin(5_000)(`${installation.issuer}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": type },
      body: "grant_type=authorization_code&client_id=chuggy-setup&code=none",
    });
  const unread = await asked("text/plain;charset=UTF-8");
  assert.equal(unread.status, 400);
  assert.deepEqual(JSON.parse(await unread.text()), {
    error: "invalid_request",
  });
  const read = await asked("application/x-www-form-urlencoded");
  assert.deepEqual(JSON.parse(await read.text()), { error: "invalid_grant" });
  assert.deepEqual(installation.grants, [
    "not a form refused",
    "authorization_code refused",
  ]);
});

test("a JSON request to a server that never answers is abandoned at its bound", async () => {
  const silent = await served();
  const began = Date.now();
  await assert.rejects(fetchJsonWithin(300)(`${silent.at}/config.json`, json), {
    name: "TimeoutError",
  });
  assert.ok(Date.now() - began < 5_000);
  assert.equal(silent.asked.length, 1);
});

test("an API request to a server that never answers ends when its caller's signal says so", async () => {
  const silent = await served();
  const caller = new AbortController();
  const asking = apiFetch(`${silent.at}/access/v1/workspaces`, {
    ...init,
    signal: caller.signal,
  });
  setTimeout(() => {
    caller.abort();
  }, 300);
  await assert.rejects(asking, { name: "AbortError" });
});

test("a site that answers its configuration with a redirect is not a site, and where it pointed is never asked", async () => {
  const elsewhere = await served(200);
  const there = await served(302, `${elsewhere.at}/config.json`);
  const machine = made.machine();
  const done = await machine.run(["--site", there.at]);
  assert.equal(done.code, 1);
  assert.deepEqual(done.lines, [
    `site: ${there.at}, no answer`,
    `next: node ${done.lines.at(-1)?.split(" ")[2] ?? ""} --site ${there.at}`,
  ]);
  assert.deepEqual(elsewhere.asked, []);
  assert.equal(machine.file("session.json"), undefined);
});
