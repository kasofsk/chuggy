/**
 * A plane's stopping, wired to an app that holds one request and, for a plane
 * that has one, a pool that records being ended, and signalled while that
 * request is in flight.
 *
 * THE CALLER KEEPS ITS CONNECTION, as a worker does, and never closes it: a
 * plane that waited for its callers to hang up would not exit, and the program
 * gives up with a code of its own so that case fails rather than hangs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { signalledCommandRun } from "./harness.ts";

/** What the program's exit code is when the plane never ended. */
const neverEnded = 3;

/** How long the request is held, which is how long after the signal it is still in flight. */
const heldMs = 300;
const giveUpMs = 10_000;

/** The program, its plane holding a pool that records being ended only where `pooled` says so. */
const program = (pooled: boolean): string => `
  const { planeStopping } = await import('./src/roots/planeStopping.ts');
  const { default: fastify } = await import('fastify');
  const http = await import('node:http');
  const seen = [];
  const app = fastify();
  app.get('/held', async () => {
    process.stdout.write('held\\n');
    await new Promise((resolve) => setTimeout(resolve, ${String(heldMs)}));
    seen.push('answered');
    return {};
  });
  planeStopping(
    app,
    'a plane',
    ${pooled ? "{ end: () => { seen.push('pool ended'); return Promise.resolve(); } }" : "undefined"},
  );
  process.on('exit', () => {
    process.stdout.write(JSON.stringify(seen));
  });
  setTimeout(() => process.exit(${String(neverEnded)}), ${String(giveUpMs)}).unref();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const kept = new http.Agent({ keepAlive: true });
  http
    .get({ host: '127.0.0.1', port: app.server.address().port, path: '/held', agent: kept }, (heard) => {
      seen.push('heard ' + String(heard.statusCode));
      heard.resume();
    })
    .on('error', () => seen.push('heard nothing'));
`;

/** What a plane run as `program(pooled)` saw once signalled, after asserting it exited cleanly. */
async function stopped(pooled: boolean): Promise<string[]> {
  const { code, stdout } = await signalledCommandRun(program(pooled), (out) =>
    out.includes("held\n"),
  );
  assert.equal(code, 0, stdout);
  return JSON.parse(stdout.slice("held\n".length)) as string[];
}

test("a signalled plane answers the request it holds, ends its pool once it has, and exits though its caller kept the connection", async () => {
  const seen = await stopped(true);
  assert.deepEqual(
    seen.filter((each) => !each.startsWith("heard")),
    ["answered", "pool ended"],
  );
  assert.deepEqual(
    seen.filter((each) => each.startsWith("heard")),
    ["heard 200"],
  );
});

test("a signalled plane with no pool answers the request it holds and exits", async () => {
  assert.deepEqual(await stopped(false), ["answered", "heard 200"]);
});
