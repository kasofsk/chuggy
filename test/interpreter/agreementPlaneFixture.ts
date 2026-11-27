/**
 * An agreement store held in memory, keyed as the table is, so a suite of the
 * plane or of its server sees the rows it wrote and the evidence each kept.
 */

import type { AgreementPolicyEntry } from "../../src/contract/agreementPlane.ts";
import type {
  AgreementEvidence,
  AgreementRecorded,
  AgreementStore,
} from "../../src/interpreter/agreementPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";

export const agreementFixtureIssuer = "https://issuer.example";

/** The principal `subject` is under the fixture's issuer. */
export function agreementFixturePrincipal(subject: string) {
  return oidcPrincipal(agreementFixtureIssuer, subject);
}

/** One policy at one version, its digest drawn from `mark`. */
export function agreementFixtureEntry(
  policy: string,
  version: string,
  mark = "a",
): AgreementPolicyEntry {
  return {
    policy,
    title: `The ${policy}`,
    version,
    url: `https://site.example/${policy}/${version}`,
    digest: `sha256:${mark.repeat(64)}`,
  };
}

export interface AgreementMemoryRow extends AgreementRecorded {
  readonly principal: string;
  readonly url: string;
  readonly evidence: AgreementEvidence;
}

export interface AgreementMemory {
  readonly store: AgreementStore;
  readonly rows: AgreementMemoryRow[];
}

/** A store whose clock is `now`, a row its person already holds left as it stands. */
export function agreementMemory(now: () => number = Date.now): AgreementMemory {
  const rows: AgreementMemoryRow[] = [];
  const same = (
    row: AgreementMemoryRow,
    principal: string,
    entry: { policy: string; version: string; digest: string },
  ) =>
    row.principal === principal &&
    row.policy === entry.policy &&
    row.version === entry.version &&
    row.digest === entry.digest;
  return {
    rows,
    store: {
      agreed: (principal, policies) =>
        Promise.resolve(
          rows.filter((row) =>
            policies.some((entry) => same(row, principal, entry)),
          ),
        ),
      record: (principal, policies, evidence) => {
        for (const entry of policies)
          if (!rows.some((row) => same(row, principal, entry)))
            rows.push({
              principal,
              policy: entry.policy,
              version: entry.version,
              url: entry.url,
              digest: entry.digest,
              agreedAt: new Date(now()).toISOString(),
              evidence,
            });
        return Promise.resolve();
      },
    },
  };
}
