/**
 * `AgreementStandings` over the agreement plane's second listener: one `GET`
 * of a person's standing, read under a byte bound by the contract's schema.
 *
 * THE LISTENER TAKES NO BEARER, so this sends none, and reach is its whole
 * control.
 *
 * EVERY OUTCOME BUT A 200 THE SCHEMA READS IS A FAULT, as
 * `../keto/request.ts` argues for the project authority: a person the plane
 * has never seen is a 200 naming no agreement, so nothing else this side
 * could be handed means "not agreed".
 */

import {
  agreementPlanePersonStandingPath,
  agreementStandingSchema,
  type AgreementStanding,
} from "../../contract/agreementPlane.ts";
import {
  AgreementStandingUnavailable,
  type AgreementStandings,
} from "../../interpreter/agreementStanding.ts";
import {
  boundedJsonRequest,
  BoundedJsonUnanswered,
  type BoundedJsonAnswer,
} from "../../interpreter/boundedJsonRequest.ts";
import type { Principal } from "../../interpreter/principal.ts";

/** Where the plane's second listener is and how long one ask may take. */
export interface AgreementStandingSettings {
  readonly url: string;
  readonly requestTimeoutMs: number;
}

/** The most one answer may weigh, which a standing of the most policies fits with every text at its widest and escaped, each instant as the plane writes one. */
export const agreementStandingBytesMax = 256 * 1024;

/** The most reads one answer may take, so a trickle of empty chunks cannot hold an ask open. */
export const agreementStandingReadsMax = 1_024;

/** The address one person's standing is asked at, under any path the deployment's address carries. */
function agreementStandingUrl(
  settings: AgreementStandingSettings,
  principal: Principal,
): URL {
  const base = settings.url.endsWith("/") ? settings.url : `${settings.url}/`;
  return new URL(agreementPlanePersonStandingPath(principal).slice(1), base);
}

async function agreementStandingAsked(
  settings: AgreementStandingSettings,
  fetcher: typeof fetch,
  principal: Principal,
): Promise<BoundedJsonAnswer> {
  try {
    return await boundedJsonRequest({
      fetcher,
      url: agreementStandingUrl(settings, principal),
      method: "GET",
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
      bytesMax: agreementStandingBytesMax,
      readsMax: agreementStandingReadsMax,
    });
  } catch (failure) {
    if (failure instanceof BoundedJsonUnanswered)
      throw new AgreementStandingUnavailable(failure.message);
    throw failure;
  }
}

async function agreementStandingRead(
  settings: AgreementStandingSettings,
  fetcher: typeof fetch,
  principal: Principal,
): Promise<AgreementStanding> {
  const answer = await agreementStandingAsked(settings, fetcher, principal);
  if (answer.status !== 200)
    throw new AgreementStandingUnavailable(
      `the plane answered ${String(answer.status)}`,
    );
  const read = agreementStandingSchema.safeParse(answer.json);
  if (!read.success)
    throw new AgreementStandingUnavailable(
      "the plane answered a body that is not a standing",
    );
  return read.data;
}

export function agreementPlaneStandings(
  settings: AgreementStandingSettings,
  fetcher: typeof fetch = fetch,
): AgreementStandings {
  return {
    standing: (principal) =>
      agreementStandingRead(settings, fetcher, principal),
  };
}
