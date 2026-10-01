/**
 * The console's side of the reserved tenant names: every page it serves outside
 * a partition, and the address the sign-in returns to, begin with a name no new
 * tenant may take.
 */

import { expect, test } from "vitest";

import { tenantNameReserved } from "../../../src/contract/requests.ts";
import { consoleRouter } from "../app/browser/routes.tsx";
import { parseConsoleConfiguration } from "../app/core/configuration.ts";
import configurationExample from "../config.example.json?raw";

/** A path's first segment, or nothing for the landing and for a tenant's own routes. */
function firstSegment(path: string): readonly string[] {
  const first = path.split("/")[1] ?? "";
  return first === "" || first.startsWith("$") ? [] : [first];
}

test("every console page outside a partition begins with a name no new tenant may take", () => {
  const segments = Object.keys(consoleRouter.routesByPath).flatMap(
    firstSegment,
  );
  expect(segments).not.toEqual([]);
  for (const segment of segments)
    expect(tenantNameReserved(segment), segment).toBe(true);
});

test("the sign-in returns under a name no new tenant may take", () => {
  const { redirectUri } = parseConsoleConfiguration(
    JSON.parse(configurationExample),
  );
  const segments = firstSegment(new URL(redirectUri).pathname);
  expect(segments).not.toEqual([]);
  for (const segment of segments)
    expect(tenantNameReserved(segment), segment).toBe(true);
});
