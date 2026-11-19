/**
 * An AWS connector's adaptor: a token STS exchanges by
 * `AssumeRoleWithWebIdentity`, delivered as the variables its SDKs and CLI
 * read.
 *
 * STS READS NO CLAIM BUT `sub` AND `aud` UNLESS IT IS A SESSION TAG, so where
 * the connector turns them on the core's job claims are repeated as tags in
 * AWS's flattened format. A value IAM would not take refuses the token rather
 * than being dropped or altered, because a policy may depend on it.
 */

import type { Connector } from "../contract/connectors.ts";
import { textCodePointsCount } from "../contract/http.ts";
import type { WorkerHeldCredentialBundle } from "../contract/workerPlane.ts";
import {
  connectorCredentialBundle,
  connectorTokenFile,
} from "./connectorCredentialBundle.ts";
import type {
  JobIdentitySubject,
  JobIdentityTarget,
} from "./jobIdentityToken.ts";

export type AwsConnector = Extract<Connector, { readonly kind: "Aws" }>;

/** The audience STS requires of a web identity token. */
export const awsTokenAudience = "sts.amazonaws.com";

/** STS's documented limit on a web identity token's subject. */
export const awsSubjectBytesMax = 255;

/** What a session tag's key follows in its flattened claim's name. */
export const awsSessionTagClaimPrefix =
  "https://aws.amazon.com/tags/principal_tags/";

/** IAM's limit on a session tag's value. */
export const awsSessionTagValueCharsMax = 256;

/** The characters IAM's tagging rules take in a value: letters, digits, spaces and `_ . : / = + - @`. */
const awsSessionTagValuePattern = /^[\p{L}\p{N} _.:/=+\-@]*$/u;

/** The prefix IAM reserves to its own tag values. */
const awsSessionTagValuePrefixReserved = "aws:";

/** Why no AWS token's shape could be built. */
export type AwsTokenTargetRefusal = {
  readonly reason:
    | "SessionTagTooLong"
    | "SessionTagCharacterRefused"
    | "SessionTagPrefixReserved";
  readonly key: string;
};

export type AwsTokenTargetBuilt =
  | { readonly result: "Target"; readonly target: JobIdentityTarget }
  | { readonly result: "Refused"; readonly refusal: AwsTokenTargetRefusal };

/** The core's job claims as session tags, each value a string. */
export function awsSessionTags(
  subject: JobIdentitySubject,
): readonly (readonly [string, string])[] {
  const tags: [string, string][] = [
    ["tenant", subject.tenant],
    ["project", subject.project],
    ["workload", subject.workload],
    ["task_kind", subject.task.taskKind === "Work" ? "work" : "evaluation"],
  ];
  if (subject.task.taskKind === "Evaluation")
    tags.push(["evaluator", String(subject.task.evaluator)]);
  tags.push(["ticket", String(subject.ticket)]);
  if (subject.repository !== undefined)
    tags.push(["repository", subject.repository]);
  return tags;
}

function awsTokenTargetRefusal(
  key: string,
  value: string,
): AwsTokenTargetRefusal | undefined {
  if (textCodePointsCount(value) > awsSessionTagValueCharsMax)
    return { reason: "SessionTagTooLong", key };
  if (!awsSessionTagValuePattern.test(value))
    return { reason: "SessionTagCharacterRefused", key };
  if (value.toLowerCase().startsWith(awsSessionTagValuePrefixReserved))
    return { reason: "SessionTagPrefixReserved", key };
  return undefined;
}

export function awsTokenTarget(
  connector: AwsConnector,
  subject: JobIdentitySubject,
): AwsTokenTargetBuilt {
  const claims: Record<string, string> = {};
  if (connector.settings.sessionTags === true)
    for (const [key, value] of awsSessionTags(subject)) {
      const refusal = awsTokenTargetRefusal(key, value);
      if (refusal !== undefined) return { result: "Refused", refusal };
      claims[`${awsSessionTagClaimPrefix}${key}`] = value;
    }
  return {
    result: "Target",
    target: {
      audience: awsTokenAudience,
      subjectBytesMax: awsSubjectBytesMax,
      claims,
    },
  };
}

export function awsCredentialBundle(
  connector: AwsConnector,
  token: string,
  expiresAtMs: number,
): WorkerHeldCredentialBundle {
  return connectorCredentialBundle(connector, token, expiresAtMs, {
    files: [],
    variables: [
      {
        kind: "Path",
        variable: "AWS_WEB_IDENTITY_TOKEN_FILE",
        file: connectorTokenFile,
      },
      {
        kind: "Value",
        variable: "AWS_ROLE_ARN",
        value: connector.settings.roleArn,
      },
    ],
  });
}
