/**
 * The device approval page's decisions: what the issuer put on its address,
 * the one call Continue makes, and what each answer to it draws.
 *
 * The call is sent once whatever it is answered. A spent bound is the person's
 * to wait out and a fault theirs to retry, so neither is retried behind
 * them, and a press is busy for one call at most.
 */

import {
  deviceApprovalCodes,
  deviceApprovalResponseSchema,
  type DeviceApprovalResponse,
} from "../../../../src/contract/deviceApproval.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";

import { apiRead } from "./apiRequest.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";

export const deviceRoutePath = "/device";
export const deviceDoneRoutePath = "/device/done";

/** What the issuer sent the page with, by the names it redirects with. */
export interface DeviceQuery {
  readonly challenge: string | undefined;
  readonly userCode: string | undefined;
}

/** A query value as text, which the router may have read a code of digits alone as a number. */
function deviceQueryText(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function deviceQueryOf(
  search: Readonly<Record<string, unknown>>,
): DeviceQuery {
  return {
    challenge: deviceQueryText(search["device_challenge"]),
    userCode: deviceQueryText(search["user_code"]),
  };
}

/** The code handed to the issuer with the challenge, sent once whatever it is answered. */
export function apiDeviceApproval(
  ports: ApiPorts,
  challenge: string,
  userCode: string,
): Promise<ApiResult<DeviceApprovalResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: nativeHttpRoutes.deviceApprovals,
      body: { challenge, userCode },
      attemptsMax: 1,
    },
    (value) => deviceApprovalResponseSchema.parse(value),
  );
}

/** What an answer leaves the page doing: sending the browser on, or drawing the line of a refusal. */
export type DeviceApprovalSent =
  | { readonly sent: "Approved"; readonly redirectTo: string }
  | { readonly sent: "Refused"; readonly line: Copy };

const deviceSecondsPerMinute = 60;

export function deviceApprovalSent(
  result: ApiResult<DeviceApprovalResponse>,
): DeviceApprovalSent {
  if (result.outcome === "Ok")
    return { sent: "Approved", redirectTo: result.value.redirectTo };
  if (result.outcome === "Rejected") {
    if (result.code === deviceApprovalCodes.CodeRefused)
      return { sent: "Refused", line: { id: "device-refused" } };
    if (result.code === deviceApprovalCodes.LinkExpired)
      return { sent: "Refused", line: { id: "device-expired" } };
  }
  if (
    result.outcome === "Retryable" &&
    result.code === deviceApprovalCodes.TriesSpent
  ) {
    const minutes = Math.ceil(
      result.retryAfterSeconds / deviceSecondsPerMinute,
    );
    return {
      sent: "Refused",
      line: {
        id: "device-spent",
        args: { minutes: String(Math.max(1, minutes)) },
      },
    };
  }
  return { sent: "Refused", line: { id: "device-failed" } };
}
