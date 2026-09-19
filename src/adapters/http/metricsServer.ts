import fastify, { type FastifyInstance } from "fastify";

import {
  executionMetricsDocument,
  type ExecutionMetricSample,
} from "../../interpreter/executionMetrics.ts";

/**
 * The scrape surface, which is a listener of its own and not a route on the
 * member API.
 *
 * A SCRAPE IS NOT A MEMBERSHIP. These samples are labelled by tenant and
 * project across the whole installation, so serving them under a member's
 * bearer would either answer one member what every tenant is doing or ask a
 * scrape to hold a membership. It is its own listener instead, bound where the
 * operator says and reachable by whatever the operator lets reach it.
 *
 * A SCRAPE THAT CANNOT READ REPORTS FAILURE. A database that will not answer is
 * a 503 and never an empty document: an exposition of nothing is
 * indistinguishable from an installation doing nothing, and a gate that cannot
 * run never reports success.
 */
export interface MetricsServerService {
  samples(silenceSecs: number): Promise<readonly ExecutionMetricSample[]>;
  readonly silenceSecs: number;
}

export const metricsExpositionMediaType =
  "text/plain; version=0.0.4; charset=utf-8";

export function createMetricsApp(
  service: MetricsServerService,
): FastifyInstance {
  const app = fastify({ logger: false });
  app.get("/health/live", () => ({ status: "live" }));
  app.get("/metrics", async (_request, reply) => {
    let samples: readonly ExecutionMetricSample[];
    try {
      samples = await service.samples(service.silenceSecs);
    } catch {
      return reply
        .code(503)
        .header("retry-after", "5")
        .send("metrics are unavailable\n");
    }
    return reply
      .code(200)
      .header("content-type", metricsExpositionMediaType)
      .header("cache-control", "no-store")
      .send(executionMetricsDocument(samples));
  });
  return app;
}
