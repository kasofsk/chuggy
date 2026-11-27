/**
 * The agreement plane's wire: the deployment's current policies, a caller's
 * standing against them, a caller agreeing, and one person's standing asked
 * by another process of the deployment.
 *
 * IT IS NOT THE PUBLIC API'S CONTRACT. The plane is a process of its own, so
 * none of this is in `nativeHttpRoutes` or the contract document. Its routes
 * share that API's media type and error envelope, because the console reads
 * both with the same code.
 *
 * A POLICY IS ITS SLUG ACROSS VERSIONS. The deployment names each one's
 * current version, the https address that version's text is published at and
 * the digest of that text as it was pinned. Someone has agreed to a current
 * policy only where they agreed to that version under that digest, so a
 * digest re-pinned asks again.
 *
 * AN AGREEMENT NAMES WHAT ITS PAGE SHOWED. One naming any policy at another
 * version or digest than the current one is refused whole with the current
 * policies, so a page left open across a new version records nothing.
 */

import { z } from "zod";

import {
  errorEnvelopeSchema,
  instantSchema,
  principalCharsMax,
} from "./http.ts";

export const agreementPlaneBasePath = "/agreements/v1";

/** One route as the plane registers it, its segments named as `:name`. */
export interface AgreementPlaneRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
}

export const agreementPlaneRoutes = {
  policies: { method: "GET", path: `${agreementPlaneBasePath}/policies` },
  standing: { method: "GET", path: `${agreementPlaneBasePath}/standing` },
  agreements: { method: "POST", path: `${agreementPlaneBasePath}/agreements` },
  personStanding: {
    method: "GET",
    path: `${agreementPlaneBasePath}/people/:principal/standing`,
  },
} as const satisfies Readonly<Record<string, AgreementPlaneRoute>>;

/** The path one person's standing is asked at, the principal encoded whole so it stays one segment. */
export function agreementPlanePersonStandingPath(principal: string): string {
  return agreementPlaneRoutes.personStanding.path.replace(
    ":principal",
    encodeURIComponent(principal),
  );
}

/** The most policies a deployment names, which bounds every list here. */
export const agreementPoliciesMax = 16;

/** The longest slug a policy is named by. */
export const agreementPolicyCharsMax = 64;

/** The longest title a page calls a policy. */
export const agreementTitleCharsMax = 256;

/** The longest version label. */
export const agreementVersionCharsMax = 128;

/** The longest address a version's text is published at. */
export const agreementUrlCharsMax = 2_048;

/** The longest user agent a row keeps, a longer one being kept cut to it. */
export const agreementUserAgentCharsMax = 1_024;

/** The widest one character is once a path encodes it, as UTF-8 of the most bytes, each a `%XX`. */
const agreementEncodedCharCharsMax = encodeURIComponent("\u{10FFFF}").length;

/** The most characters a principal takes once a path encodes it whole. */
export const agreementPrincipalSegmentCharsMax =
  principalCharsMax * agreementEncodedCharCharsMax;

export const agreementPolicySchema = z
  .string()
  .max(agreementPolicyCharsMax)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const agreementVersionSchema = z
  .string()
  .min(1)
  .max(agreementVersionCharsMax);

/** How long a digest is: its algorithm's prefix and a SHA-256 in hex. */
export const agreementDigestChars = "sha256:".length + 64;

export const agreementDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const agreementUrlSchema = z
  .url({ protocol: /^https$/u })
  .max(agreementUrlCharsMax)
  .regex(/^https:\/\//u);

/** One policy at its current version. */
export const agreementPolicyEntrySchema = z.strictObject({
  policy: agreementPolicySchema,
  title: z.string().min(1).max(agreementTitleCharsMax),
  version: agreementVersionSchema,
  url: agreementUrlSchema,
  digest: agreementDigestSchema,
});
export type AgreementPolicyEntry = z.infer<typeof agreementPolicyEntrySchema>;

/** Whether no two entries name one policy. */
function agreementNamedOnce(entries: readonly { policy: string }[]): boolean {
  return new Set(entries.map((entry) => entry.policy)).size === entries.length;
}

/** The deployment's policies as it configures them: one entry a policy, in the order a page shows them. */
export const agreementPlanePoliciesSchema = z
  .array(agreementPolicyEntrySchema)
  .max(agreementPoliciesMax)
  .refine(agreementNamedOnce, { message: "each policy is named once" });

/** What `GET policies` answers. */
export const agreementPoliciesSchema = z.strictObject({
  policies: agreementPlanePoliciesSchema,
});
export type AgreementPolicies = z.infer<typeof agreementPoliciesSchema>;

/** One current policy and when the person agreed to it, absent where they have not. */
export const agreementStandingEntrySchema = agreementPolicyEntrySchema.extend({
  agreedAt: instantSchema.exactOptional(),
});
export type AgreementStandingEntry = z.infer<
  typeof agreementStandingEntrySchema
>;

/** Every current policy and one person's agreement to each. */
export const agreementStandingSchema = z.strictObject({
  policies: z.array(agreementStandingEntrySchema).max(agreementPoliciesMax),
});
export type AgreementStanding = z.infer<typeof agreementStandingSchema>;

/** One policy agreed to, at the version and digest the page showed. */
export const agreementSchema = z.strictObject({
  policy: agreementPolicySchema,
  version: agreementVersionSchema,
  digest: agreementDigestSchema,
});
export type Agreement = z.infer<typeof agreementSchema>;

/** A caller agreeing to at least one policy, each once. */
export const agreementRequestSchema = z.strictObject({
  agreements: z
    .array(agreementSchema)
    .min(1)
    .max(agreementPoliciesMax)
    .refine(agreementNamedOnce, { message: "each policy is named once" }),
});
export type AgreementRequest = z.infer<typeof agreementRequestSchema>;

/** Answered where an agreement names a policy not current at its version and digest. */
export const agreementPoliciesChangedCode = "PoliciesChanged";

/** The refusal of an agreement to what is no longer current: the policies that are. */
export const agreementPoliciesChangedResponseSchema =
  errorEnvelopeSchema.extend({
    policies: agreementPlanePoliciesSchema,
  });
export type AgreementPoliciesChangedResponse = z.infer<
  typeof agreementPoliciesChangedResponseSchema
>;

/** A principal as the person standing path names it. */
export const agreementPrincipalSchema = z
  .string()
  .min(1)
  .max(principalCharsMax);
