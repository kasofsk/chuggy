/**
 * The status, headers and body of any public response, classified into a
 * closed set of outcomes.
 *
 * Absent and inaccessible are one outcome because the server makes them one,
 * and a caller must never render a third. Every rejection the server explains
 * explains itself in the error envelope's code, so the code is what a caller
 * reads rather than the status.
 */

import { z } from "zod";

/**
 * A rejection body carries its code beside whatever else the status needs, so
 * the reader names the code alone and tolerates the rest.
 */
const envelopeCodeSchema = z.object({
  error: z.object({ code: z.string().min(1) }),
});

export const retryAfterSecondsMax = 300;
export const retryAfterSecondsFallback = 5;

export type ApiOutcome =
  | { readonly outcome: "Ok"; readonly body: unknown }
  | {
      readonly outcome: "Accepted";
      readonly body: unknown;
      readonly location: string | undefined;
    }
  | { readonly outcome: "Unauthenticated" }
  | { readonly outcome: "Absent" }
  | {
      readonly outcome: "Conflict";
      readonly code: string;
      readonly body: unknown;
    }
  | {
      readonly outcome: "Retryable";
      readonly code: string;
      readonly retryAfterSeconds: number;
    }
  | {
      readonly outcome: "Rejected";
      readonly code: string;
      readonly status: number;
      readonly body: unknown;
    }
  | {
      readonly outcome: "Fault";
      readonly code: string;
      readonly status: number;
    };

export type ResponseHeader = (name: string) => string | null | undefined;

function envelopeCode(body: unknown, fallback: string): string {
  const parsed = envelopeCodeSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : fallback;
}

/** A hostile or absent `retry-after` becomes a delay the caller can still bound. */
export function retryAfterSeconds(header: string | null | undefined): number {
  if (header === undefined || header === null) return retryAfterSecondsFallback;
  const parsed = Number(header.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return retryAfterSecondsFallback;
  return Math.min(Math.ceil(parsed), retryAfterSecondsMax);
}

const successStatusMin = 200;
const successStatusMax = 300;
const clientFaultStatusMin = 400;
const clientFaultStatusMax = 500;

function classifyFault(status: number, body: unknown): ApiOutcome {
  if (status === 401) return { outcome: "Unauthenticated" };
  if (status === 404) return { outcome: "Absent" };
  if (status === 409)
    return { outcome: "Conflict", code: envelopeCode(body, "Conflict"), body };
  if (status >= clientFaultStatusMin && status < clientFaultStatusMax)
    return {
      outcome: "Rejected",
      code: envelopeCode(body, "InvalidRequest"),
      status,
      body,
    };
  return {
    outcome: "Fault",
    code: envelopeCode(body, "InternalError"),
    status,
  };
}

export function classify(
  status: number,
  header: ResponseHeader,
  body: unknown,
): ApiOutcome {
  if (status === 202)
    return {
      outcome: "Accepted",
      body,
      location: header("location") ?? undefined,
    };
  if (status >= successStatusMin && status < successStatusMax)
    return { outcome: "Ok", body };
  if (status === 429 || status === 503)
    return {
      outcome: "Retryable",
      code: envelopeCode(body, "Retryable"),
      retryAfterSeconds: retryAfterSeconds(header("retry-after")),
    };
  return classifyFault(status, body);
}
