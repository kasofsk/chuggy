/**
 * The pool plane's second listener, which serves its runners' reports as a
 * scrape page through the metrics plane's routes, on a port of its own so a
 * scraper may be admitted to it alone.
 *
 * IT IS THERE ONLY WHERE A PORT IS NAMED. A plane naming none opens no listener
 * and is otherwise unchanged, so a deployment that has not named one yet starts
 * as it did before.
 */

import type { FastifyInstance } from "fastify";

import type { WorkerPoolReports } from "../../interpreter/workerPoolReports.ts";
import { createMetricsPlaneApp } from "./metricsPlaneServer.ts";

/** Where the listener is opened, or that there is none. */
export type PoolPlaneMetricsAddress =
  | { readonly read: "None" }
  | { readonly read: "Address"; readonly host: string; readonly port: number }
  | { readonly read: "Refused"; readonly why: string };

const poolPlaneMetricsPortMax = 65_535;

/** The address a host and a port setting name, an absent or empty port naming none and a host naming none being the loopback. */
export function poolPlaneMetricsAddressRead(
  host: string | undefined,
  port: string | undefined,
): PoolPlaneMetricsAddress {
  if (port === undefined || port.length === 0) return { read: "None" };
  const parsed = Number(port);
  if (!/^[1-9][0-9]*$/u.test(port) || parsed > poolPlaneMetricsPortMax)
    return { read: "Refused", why: "must be a port number" };
  return {
    read: "Address",
    host: host === undefined || host.length === 0 ? "127.0.0.1" : host,
    port: parsed,
  };
}

/** The listener `address` names, serving what `reports` holds, opened; or nothing where it names none. */
export async function poolPlaneMetricsListening(
  reports: WorkerPoolReports,
  address: Exclude<PoolPlaneMetricsAddress, { read: "Refused" }>,
): Promise<FastifyInstance | undefined> {
  if (address.read === "None") return undefined;
  const app = createMetricsPlaneApp({
    scrape: () =>
      Promise.resolve({ scraped: "Page", families: reports.families() }),
    ready: () => Promise.resolve(true),
  });
  await app.listen({ host: address.host, port: address.port });
  return app;
}
