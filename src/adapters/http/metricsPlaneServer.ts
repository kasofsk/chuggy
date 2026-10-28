/**
 * The metrics plane's routes: `GET /metrics`, the page a scraper reads, beside
 * the plane's health probes. It serves no caller in particular, so it resolves
 * nobody, and it reads no body. The page is in whichever format the scraper's
 * `Accept` ranks highest, so it varies by that header.
 *
 * A SCRAPE THAT CANNOT BE ANSWERED WHOLE IS 503, never a partial page: a read
 * past its bound, a page past the series it may carry, a read that failed, or
 * families the format refuses to write.
 * Each is said on stderr with its reason, which the body does not carry, since
 * a scraper records only that the target was down.
 */

import type { FastifyInstance } from "fastify";

import type { MetricsPlaneScrape } from "../../interpreter/metricsPlane.ts";
import {
  metricsExpositionNegotiated,
  metricsExpositionPage,
  type MetricsExpositionFormat,
} from "./metricsExposition.ts";
import { planeApp, planeHealthRoutes } from "./planeRoutes.ts";

export interface MetricsPlaneAppOptions {
  readonly scrape: () => Promise<MetricsPlaneScrape>;
  readonly ready: () => Promise<boolean>;
}

function metricsPlaneFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : "unknown failure";
}

/** Why a scrape was refused, or the page it is answered with in `format`. */
async function metricsPlanePage(
  scrape: () => Promise<MetricsPlaneScrape>,
  format: MetricsExpositionFormat,
): Promise<
  | { readonly page: string; readonly contentType: string }
  | { readonly refused: string }
> {
  let scraped: MetricsPlaneScrape;
  try {
    scraped = await scrape();
  } catch (failure) {
    return { refused: `the read failed: ${metricsPlaneFailure(failure)}` };
  }
  if (scraped.scraped === "Refused") return { refused: scraped.why };
  try {
    return metricsExpositionPage(scraped.families, format);
  } catch (failure) {
    return {
      refused: `the page was not written: ${metricsPlaneFailure(failure)}`,
    };
  }
}

export function createMetricsPlaneApp(
  options: MetricsPlaneAppOptions,
): FastifyInstance {
  const app = planeApp();
  planeHealthRoutes(app, options.ready);
  app.get("/metrics", async (request, reply) => {
    void reply.header("vary", "Accept");
    const answered = await metricsPlanePage(
      options.scrape,
      metricsExpositionNegotiated(request.headers.accept),
    );
    if ("refused" in answered) {
      process.stderr.write(
        `metrics plane: scrape refused: ${answered.refused}\n`,
      );
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send("the scrape could not be answered whole\n");
    }
    return reply.type(answered.contentType).send(answered.page);
  });
  return app;
}
