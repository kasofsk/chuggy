/**
 * The agreement plane's routes, each read from the contract's own method and
 * path, so a route the plane moves moves here too.
 */

import {
  agreementPlaneRoutes,
  agreementPoliciesSchema,
  agreementStandingSchema,
  type AgreementPolicies,
  type AgreementRequest,
  type AgreementStanding,
} from "../../../../src/contract/agreementPlane.ts";

import { apiRead } from "./apiRequest.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";

/** The deployment's current policies, which the plane answers with no session. */
export function apiAgreementPolicies(
  ports: ApiPorts,
): Promise<ApiResult<AgreementPolicies>> {
  return apiRead(ports, agreementPlaneRoutes.policies, (value) =>
    agreementPoliciesSchema.parse(value),
  );
}

/** Every current policy and whether the caller has agreed to it. */
export function apiAgreementStanding(
  ports: ApiPorts,
): Promise<ApiResult<AgreementStanding>> {
  return apiRead(ports, agreementPlaneRoutes.standing, (value) =>
    agreementStandingSchema.parse(value),
  );
}

/** The caller agreeing, answered with their standing once it is recorded. */
export function apiAgree(
  ports: ApiPorts,
  request: AgreementRequest,
): Promise<ApiResult<AgreementStanding>> {
  return apiRead(
    ports,
    { ...agreementPlaneRoutes.agreements, body: request },
    (value) => agreementStandingSchema.parse(value),
  );
}
