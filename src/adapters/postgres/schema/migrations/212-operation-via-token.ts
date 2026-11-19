/**
 * The access token an operation came through, recorded beside the maker it
 * acted as.
 *
 * `operation` GAINS `via_token` AND `via_token_name`, null together and never
 * beside `via_session`, the identity checked as the mint draws it and the name
 * bounded as a token's is. Neither points at `access_token`: a deleted token's
 * operations keep both, and the name is what a person reads.
 *
 * `accept_operation` AND `accept_dispatch_operation` ARE 181'S AND 015'S WITH
 * TWO PARAMETERS MORE, each defaulting to null, and the second passes both on
 * to the first. A parameter list cannot be replaced in place, so each is
 * dropped and created again and given its owner and grant again. The defaults
 * are what keep every caller of the earlier parameter list working: the
 * boundary's own resume and following doors, and an API pod mid-roll, call the
 * new function unchanged, and a PL/pgSQL body names no dependency that would
 * have refused the drop.
 */

import { apiRole, boundaryOwnerRole, type Migration } from "../shared.ts";
import { migration015 } from "./015-ticket-commands.ts";
import { migration181 } from "./181-finalizer-approval-retired.ts";

/** The longest a token's name may be, as `accessTokenNameCharsMax` stood here. */
export const accessTokenNameCharsMaxAt212 = 64;

const parametersBefore = "in_hard_limit bigint, in_via_session text)";
const parametersAfter =
  "in_hard_limit bigint, in_via_session text, in_via_token text DEFAULT NULL, in_via_token_name text DEFAULT NULL)";

const acceptParameters =
  "in_tenant text, in_project text, in_operation text, in_authority_kind text, in_authority_subject text, in_key_version text, in_key_digest text, in_payload_digest text, in_retained_key_digests text[], in_retained_payload_digests text[], in_command text, in_ordinary_soft_limit bigint, in_hard_limit bigint, in_via_session text";

/** Each door as it was, by the signature a drop names. */
const acceptBefore = `public.accept_operation(${acceptParameters})`;
const dispatchBefore = `public.accept_dispatch_operation(${acceptParameters})`;

/** Each door as it is, by the signature a grant names. */
const acceptParametersAfter = `${acceptParameters}, in_via_token text, in_via_token_name text`;
const acceptAfter = `public.accept_operation(${acceptParametersAfter})`;
const dispatchAfter = `public.accept_dispatch_operation(${acceptParametersAfter})`;

/** `migration`'s statement beginning `prefix`, with each of `replacements` made exactly once. */
function migration212Rewritten(
  migration: Migration,
  prefix: string,
  replacements: readonly (readonly [string, string])[],
): string {
  const stood = migration.statements.find((statement) =>
    statement.startsWith(prefix),
  );
  if (stood === undefined)
    throw new Error(
      `migration 212: ${String(migration.version)} no longer installs the function this extends`,
    );
  return replacements.reduce((body, [before, after]) => {
    if (body.split(before).length !== 2)
      throw new Error(
        `migration 212: ${String(migration.version)}'s function does not name ${before} exactly once`,
      );
    return body.replace(before, after);
  }, stood);
}

const created: readonly [string, string] = [
  "CREATE OR REPLACE FUNCTION",
  "CREATE FUNCTION",
];

const accepting = migration212Rewritten(
  migration181,
  "CREATE OR REPLACE FUNCTION public.accept_operation(",
  [
    created,
    [parametersBefore, parametersAfter],
    [
      "command, command_tag, via_session)",
      "command, command_tag, via_session, via_token, via_token_name)",
    ],
    ["in_via_session);", "in_via_session, in_via_token, in_via_token_name);"],
  ],
);

const dispatching = migration212Rewritten(
  migration015,
  "CREATE OR REPLACE FUNCTION public.accept_dispatch_operation(",
  [
    created,
    [parametersBefore, parametersAfter],
    [
      "in_hard_limit,in_via_session);",
      "in_hard_limit,in_via_session,in_via_token,in_via_token_name);",
    ],
  ],
);

export const migration212: Migration = {
  version: 212,
  name: "the access token an operation came through",
  statements: [
    `ALTER TABLE public.operation
       ADD COLUMN via_token text
         CONSTRAINT operation_via_token_is_drawn
         CHECK (via_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
       ADD COLUMN via_token_name text
         CONSTRAINT operation_via_token_name_is_bounded
         CHECK (char_length(via_token_name) BETWEEN 1 AND ${String(accessTokenNameCharsMaxAt212)}),
       ADD CONSTRAINT operation_via_token_is_named
         CHECK ((via_token IS NULL) = (via_token_name IS NULL)),
       ADD CONSTRAINT operation_via_one_bearer
         CHECK (via_token IS NULL OR via_session IS NULL)`,
    `DROP FUNCTION ${dispatchBefore}`,
    `DROP FUNCTION ${acceptBefore}`,
    accepting,
    `ALTER FUNCTION ${acceptAfter} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${acceptAfter} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${acceptAfter} TO ${apiRole}`,
    dispatching,
    `ALTER FUNCTION ${dispatchAfter} OWNER TO ${boundaryOwnerRole}`,
    `REVOKE ALL ON FUNCTION ${dispatchAfter} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${dispatchAfter} TO ${apiRole}`,
  ],
};
