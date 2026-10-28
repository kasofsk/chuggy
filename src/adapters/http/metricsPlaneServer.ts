/**
 * The metrics plane's routes: `GET /metrics`, the page a scraper reads, beside
 * the plane's health probes. It serves no caller in particular, so it resolves
 * nobody, and it reads no body.
 *
 * A SCRAPE THAT CANNOT BE ANSWERED WHOLE IS 503, never a partial page: a read
 * past its bound, a page past the series it may carry, or a read that failed.
 * Each is said on stderr with its reason, which the body does not carry, since
 * a scraper records only that the target was down.
 */

import type { FastifyInstance } from "fastify";

import type { MetricsPlaneScrape } from "../../interpreter/metricsPlane.ts";
import {
  metricsExposition,
  metricsExpositionContentType,
} from "./metricsExposition.ts";
import { planeApp, planeHealthRoutes } from "./planeRoutes.ts";

export interface MetricsPlaneAppOptions {
  readonly scrape: () => Promise<MetricsPlaneScrape>;
  readonly ready: () => Promise<boolean>;
}

/** Why a scrape was refused, or the page it is answered with. */
async function metricsPlanePage(
  scrape: () => Promise<MetricsPlaneScrape>,
): Promise<{ readonly page: string } | { readonly refused: string }> {
  try {
    const scraped = await scrape();
    return scraped.scraped === "Refused"
      ? { refused: scraped.why }
      : { page: metricsExposition(scraped.families) };
  } catch (failure) {
    return {
      refused: `the read failed: ${failure instanceof Error ? failure.message : "unknown failure"}`,
    };
  }
}

export function createMetricsPlaneApp(
  options: MetricsPlaneAppOptions,
): FastifyInstance {
  const app = planeApp();
  planeHealthRoutes(app, options.ready);
  app.get("/metrics", async (_request, reply) => {
    const answered = await metricsPlanePage(options.scrape);
    if ("refused" in answered) {
      process.stderr.write(
        `metrics plane: scrape refused: ${answered.refused}\n`,
      );
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send("the scrape could not be answered whole\n");
    }
    return reply.type(metricsExpositionContentType).send(answered.page);
  });
  return app;
}
