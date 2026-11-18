/**
 * `DeviceUserCodes` over Ory Hydra's admin API: the code a person typed
 * accepted for the device challenge the issuer's page carried, which is the
 * one call of a device sign-in only this side can make.
 *
 * Each answer is read by its status alone. Success names where the browser
 * goes next, and is believed only where that address is on the issuer's own
 * origin, since the console sends the person's browser there at the top level.
 * A bad request is a code not accepted, which the issuer answers alike for a
 * wrong, used or expired code, an empty one and a fault in its own storage.
 * Unauthorized and not found are a challenge it no longer knows or cannot
 * read. Every other status, a body past its bound or unread, and a call that
 * did not complete within its timeout are `Unavailable`, never a refusal.
 */

import { z } from "zod";

import type {
  DeviceUserCodeAnswer,
  DeviceUserCodes,
} from "../../interpreter/deviceApproval.ts";
import { checkedHydraAdminUrl, hydraBoundedText } from "./oauthClients.ts";

/** The admin API's acceptance of a device's code, addressed by the challenge in its query. */
const hydraDeviceAcceptPath = "admin/oauth2/auth/requests/device/accept";

const hydraDeviceAcceptedSchema = z.object({ redirect_to: z.string().min(1) });

export interface HydraDeviceSettings {
  readonly adminUrl: string;
  /** The issuer's public address, whose origin alone a browser is sent on to. */
  readonly issuer: string;
  readonly requestTimeoutMs: number;
}

/** Where the issuer said the browser goes next, where it is on the issuer's origin. */
function hydraDeviceRedirect(
  text: string,
  issuerOrigin: string,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const accepted = hydraDeviceAcceptedSchema.safeParse(parsed);
  if (!accepted.success || !URL.canParse(accepted.data.redirect_to))
    return undefined;
  return new URL(accepted.data.redirect_to).origin === issuerOrigin
    ? accepted.data.redirect_to
    : undefined;
}

async function hydraDeviceAccepted(
  url: URL,
  userCode: string,
  settings: HydraDeviceSettings,
  fetcher: typeof fetch,
  issuerOrigin: string,
): Promise<DeviceUserCodeAnswer> {
  const answered = await fetcher(url, {
    method: "PUT",
    signal: AbortSignal.timeout(settings.requestTimeoutMs),
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ user_code: userCode }),
  });
  const text = await hydraBoundedText(answered);
  if (text === undefined) return { answer: "Unavailable" };
  switch (answered.status) {
    case 200: {
      const redirectTo = hydraDeviceRedirect(text, issuerOrigin);
      return redirectTo === undefined
        ? { answer: "Unavailable" }
        : { answer: "Accepted", redirectTo };
    }
    case 400:
      return { answer: "CodeRefused" };
    case 401:
    case 404:
      return { answer: "LinkExpired" };
    default:
      return { answer: "Unavailable" };
  }
}

export function hydraDeviceUserCodes(
  input: HydraDeviceSettings,
  fetcher: typeof fetch = fetch,
): DeviceUserCodes {
  const adminUrl = checkedHydraAdminUrl(input.adminUrl, input.requestTimeoutMs);
  const issuerOrigin = new URL(input.issuer).origin;
  if (issuerOrigin === "null")
    throw new RangeError("the issuer must be an address with an origin");
  const settings = { ...input, adminUrl };
  return {
    accept: async (challenge, userCode) => {
      const url = new URL(hydraDeviceAcceptPath, adminUrl);
      url.searchParams.set("device_challenge", challenge);
      try {
        return await hydraDeviceAccepted(
          url,
          userCode,
          settings,
          fetcher,
          issuerOrigin,
        );
      } catch {
        return { answer: "Unavailable" };
      }
    },
  };
}
