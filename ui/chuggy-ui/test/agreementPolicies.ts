/**
 * Two policies as a deployment names them, for the suites of the agreement
 * gate and of the invite card's lines.
 */

import type { AgreementPolicyEntry } from "../../../src/contract/agreementPlane.ts";

export const agreementTerms: AgreementPolicyEntry = {
  policy: "terms",
  title: "Terms of Service",
  version: "2026-12-01",
  url: "https://policies.example/terms/2026-12-01",
  digest: `sha256:${"a".repeat(64)}`,
};

export const agreementPrivacy: AgreementPolicyEntry = {
  policy: "privacy",
  title: "Privacy Policy",
  version: "2026-11-01",
  url: "https://policies.example/privacy/2026-11-01",
  digest: `sha256:${"b".repeat(64)}`,
};
