/**
 * Every method and path an app serves, read off its own router rather than the
 * source that registers them, for the suites that hold a roster of routes
 * against what is actually served. A line this cannot read fails the suite, so
 * a change to the router's print is never a route silently dropped.
 */

import assert from "node:assert/strict";

import type { FastifyInstance } from "fastify";

/** The served routes as `METHOD /path`, sorted, each `HEAD` the framework adds beside a `GET` included. */
export function routerServed(app: FastifyInstance): readonly string[] {
  const served: string[] = [];
  const segments: string[] = [];
  for (const line of app.printRoutes().split("\n")) {
    if (line.trim() === "") continue;
    const node = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/u.exec(
      line,
    );
    assert.ok(node !== null, `a router line this suite cannot read: ${line}`);
    segments.length = (node[1] ?? "").length / 4;
    segments.push(node[2] ?? "");
    for (const method of node[3]?.split(", ") ?? [])
      served.push(`${method} ${segments.join("")}`);
  }
  return served.sort();
}
