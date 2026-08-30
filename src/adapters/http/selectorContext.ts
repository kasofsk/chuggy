import { z } from "zod";

import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { SelectorOperationalContextRead } from "../../interpreter/selectorOperationalContext.ts";
import { nativeHttpMediaType } from "../../contract/http.ts";
import type { AccessTokenRead } from "./clientCredentials.ts";
import { boundedResponseBytes } from "./boundedResponse.ts";

const counter = z.number().int().safe().nonnegative();
const authoritySchema = z.strictObject({
  kind: z.string().transform(asAuthorityKind),
  subject: z.string().transform(asAuthoritySubject),
});
const reviewFeedbackSchema = z
  .strictObject({
    ordinal: counter,
    selectorDecision: z.string(),
    outcome: z.enum(["Approved", "Rejected"]),
    reviewer: authoritySchema,
    feedback: z.string().optional(),
    reviewedAt: z.iso.datetime(),
  })
  .transform(({ feedback, ...value }) =>
    feedback === undefined ? value : { ...value, feedback },
  );
export const selectorOperationalContextV2Schema = z.strictObject({
  version: z.literal(2),
  observedAt: z.iso.datetime(),
  observedAtEpochMs: counter,
  reviewFeedback: z.array(reviewFeedbackSchema),
  activeWork: z.strictObject({
    queued: counter,
    admitted: counter,
    launching: counter,
    running: counter,
  }),
  capacity: z.strictObject({
    account: z.string().min(1),
    accountMaximum: counter,
    accountActive: counter,
    accountReservationDeficit: counter,
    clusterSlotsMax: counter,
    clusterActive: counter,
  }),
  backlog: z.strictObject({
    project: z.strictObject({ queued: counter, ceiling: counter.positive() }),
    installation: z.strictObject({
      queued: counter,
      ceiling: counter.positive(),
    }),
  }),
});

export interface SelectorContextHttpConfig {
  readonly baseUrl: string;
  readonly accessToken: AccessTokenRead;
  readonly requestTimeoutMs: number;
  readonly responseBytesMax: number;
  readonly responseReadsMax: number;
}

function checkedToken(value: string): string {
  if (value.length === 0 || /[\r\n]/u.test(value))
    throw new RangeError("selector context access token is empty or malformed");
  return value;
}

function checkedPositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function contextUrl(baseUrl: string, partition: Partition): URL {
  return new URL(
    [
      "api/v1/tenants",
      encodeURIComponent(partition.tenant),
      "projects",
      encodeURIComponent(partition.project),
      "selector-context",
    ].join("/"),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
}

/** Reads one strictly parsed selector context through the authenticated native API. */
export function selectorContextHttp(
  config: SelectorContextHttpConfig,
  transport: typeof fetch = fetch,
): SelectorOperationalContextRead {
  const timeoutMs = checkedPositive(config.requestTimeoutMs, "request timeout");
  const responseBytesMax = checkedPositive(
    config.responseBytesMax,
    "response byte bound",
  );
  const responseReadsMax = checkedPositive(
    config.responseReadsMax,
    "response read bound",
  );
  return {
    context: async (partition) => {
      const signal = AbortSignal.timeout(timeoutMs);
      const token = checkedToken(await config.accessToken(signal));
      const response = await transport(contextUrl(config.baseUrl, partition), {
        headers: {
          accept: nativeHttpMediaType,
          authorization: `Bearer ${token}`,
        },
        signal,
      });
      if (!response.ok)
        throw new Error(
          `selector context source returned ${String(response.status)}`,
        );
      const bytes = await boundedResponseBytes(
        response,
        responseBytesMax,
        responseReadsMax,
      );
      return selectorOperationalContextV2Schema.parse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
    },
  };
}
