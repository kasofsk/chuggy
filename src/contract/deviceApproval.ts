/**
 * A device sign-in approved by a person signed in to the console: the code the
 * device shows, entered on the console's page with the challenge the issuer
 * sent that page, and where the browser goes next.
 *
 * The route takes a person's bearer and no project permission, and no session
 * bearer. Each answer but the success is named by its envelope code, which is
 * what a caller reads: a code the issuer did not accept, a link it no longer
 * knows, the person's own bound on refused codes spent, and anything else.
 */

import { z } from "zod";

/**
 * The longest challenge the route takes. The issuer's challenge is a sealed,
 * compressed flow of no fixed length, which reached the page in its address,
 * and the console's proxy refuses a request line past this.
 */
export const deviceChallengeCharsMax = 8_192;

/** The longest code the route takes as typed, separators included. */
export const deviceUserCodeCharsMax = 64;

export const deviceApprovalRequestSchema = z.strictObject({
  challenge: z.string().min(1).max(deviceChallengeCharsMax),
  userCode: z.string().min(1).max(deviceUserCodeCharsMax),
});
export type DeviceApprovalRequest = z.infer<typeof deviceApprovalRequestSchema>;

/** Where the browser that approved goes next, at the top level: the issuer's own address. */
export const deviceApprovalResponseSchema = z.strictObject({
  redirectTo: z.string().min(1),
});
export type DeviceApprovalResponse = z.infer<
  typeof deviceApprovalResponseSchema
>;

/** The envelope code of each answer that is not the success. */
export const deviceApprovalCodes = {
  CodeRefused: "DeviceCodeNotAccepted",
  LinkExpired: "DeviceLinkExpired",
  TriesSpent: "DeviceTriesSpent",
  Unavailable: "DeviceApprovalUnavailable",
} as const;

/**
 * A code as the issuer compares it, upper-cased and without spaces or hyphens,
 * every other character left for the issuer to refuse. It relies on the issuer
 * drawing its codes from upper-case letters alone.
 */
export function deviceUserCodeNormalized(typed: string): string {
  return typed.toUpperCase().replace(/[ -]/gu, "");
}
