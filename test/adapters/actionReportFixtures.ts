/**
 * The app with the report route and nothing else served, for the suites that
 * ask the route what it makes of a request.
 */

import type { FastifyInstance } from "fastify";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import type { ActionReports } from "../../src/interpreter/actionReport.ts";

/** A port no case here reaches, failing whatever is asked of it and saying so. */
function unserved(calls: string[], port: string): never {
  return new Proxy(
    {},
    {
      get: (_target, method) => () => {
        calls.push(`${port}.${String(method)}`);
        return Promise.reject(new Error(`${port} is not served here`));
      },
    },
  ) as never;
}

/** The app with the report route over the service given, every other port reached recorded. */
export function actionReportsApp(
  calls: string[],
  reports: ActionReports,
): FastifyInstance {
  return createNativeHttpApp(
    unserved(calls, "web"),
    {
      authenticateBearer: (token) => {
        calls.push(`authentication:${token}`);
        return Promise.resolve({ authenticated: "InvalidToken" as const });
      },
    },
    unserved(calls, "readiness"),
    unserved(calls, "installation"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unserved(calls, "workerPools"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    reports,
  );
}
