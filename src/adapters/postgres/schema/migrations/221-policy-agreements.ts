/**
 * Who agreed to which version of a deployment's policies, and the role of the
 * agreement plane that keeps the record.
 *
 * `policy_agreement` IS APPEND-ONLY. One row is one person's agreement to one
 * version of one policy as its text was pinned, keyed by all four, so agreeing
 * again is refused by the key and the first row stands with its time and its
 * evidence. A row copies the url and the digest it was agreed under rather
 * than naming an entry of the configuration, which moves on without it.
 *
 * THE TIME IS THE DATABASE'S. `agreed_at` is filled by its default, and the
 * plane's role is granted INSERT on every other column, so no row carries a
 * time the process chose.
 *
 * THE ROLE CANNOT ALTER OR REMOVE WHAT IT WROTE: it holds no UPDATE, DELETE or
 * TRUNCATE on its own table, reads it, and reaches nothing else.
 *
 * THE BOUNDS ARE THE CONTRACT'S AT 221, kept here as literals because a landed
 * migration does not move with the module that names them.
 */

import {
  agreementPlaneRole,
  roleStatement,
  type Migration,
} from "../shared.ts";

/** The longest principal, which is `principalCharsMax` at 221. */
const principalCharsMaxAt221 = 256;

/** The longest policy slug, which is `agreementPolicyCharsMax` at 221. */
const policyCharsMaxAt221 = 64;

/** The longest version label, which is `agreementVersionCharsMax` at 221. */
const versionCharsMaxAt221 = 128;

/** The longest url, which is `agreementUrlCharsMax` at 221. */
const urlCharsMaxAt221 = 2_048;

/** The longest user agent kept, which is `agreementUserAgentCharsMax` at 221. */
const userAgentCharsMaxAt221 = 1_024;

/** Every column of the table but the time, which is what the plane may insert. */
const agreementInsertColumns =
  "principal,policy,version,url,digest,client_address,user_agent";

export const migration221: Migration = {
  version: 221,
  name: "an agreement plane records who agreed to which policies",
  statements: [
    roleStatement(agreementPlaneRole),
    `GRANT USAGE ON SCHEMA public TO ${agreementPlaneRole}`,
    `GRANT SELECT ON TABLE public.schema_migration TO ${agreementPlaneRole}`,
    `CREATE TABLE public.policy_agreement (
       principal text NOT NULL
         CHECK(length(principal) BETWEEN 1 AND ${String(principalCharsMaxAt221)}),
       policy text NOT NULL
         CHECK(length(policy) <= ${String(policyCharsMaxAt221)}
               AND policy ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
       version text NOT NULL
         CHECK(length(version) BETWEEN 1 AND ${String(versionCharsMaxAt221)}),
       url text NOT NULL
         CHECK(length(url) <= ${String(urlCharsMaxAt221)} AND url ~ '^https://'),
       digest text NOT NULL CHECK(digest ~ '^sha256:[0-9a-f]{64}$'),
       agreed_at timestamptz NOT NULL DEFAULT now(),
       client_address inet,
       user_agent text
         CHECK(user_agent IS NULL OR length(user_agent) <= ${String(userAgentCharsMaxAt221)}),
       PRIMARY KEY(principal, policy, version, digest))`,
    `GRANT SELECT ON TABLE public.policy_agreement TO ${agreementPlaneRole}`,
    `GRANT INSERT(${agreementInsertColumns}) ON TABLE public.policy_agreement TO ${agreementPlaneRole}`,
  ],
};
