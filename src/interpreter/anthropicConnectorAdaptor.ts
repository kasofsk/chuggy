/**
 * An Anthropic connector's adaptor: a token Anthropic's workload identity
 * federation exchanges, delivered as the variables its SDKs read.
 */

import type { Connector } from "../contract/connectors.ts";
import type {
  HeldCredentialBundleVariable,
  WorkerHeldCredentialBundle,
} from "../contract/workerPlane.ts";
import {
  connectorCredentialBundle,
  connectorTokenFile,
} from "./connectorCredentialBundle.ts";
import type { JobIdentityTarget } from "./jobIdentityToken.ts";

export type AnthropicConnector = Extract<
  Connector,
  { readonly kind: "Anthropic" }
>;

/** The audience Anthropic requires of a federated token. */
export const anthropicTokenAudience = "https://api.anthropic.com";

/** Anthropic documents no limit on a subject, so this is AWS's. */
export const anthropicSubjectBytesMax = 255;

export function anthropicTokenTarget(): JobIdentityTarget {
  return {
    audience: anthropicTokenAudience,
    subjectBytesMax: anthropicSubjectBytesMax,
    claims: {},
  };
}

export function anthropicCredentialBundle(
  connector: AnthropicConnector,
  token: string,
  expiresAtMs: number,
): WorkerHeldCredentialBundle {
  const { settings } = connector;
  const variables: HeldCredentialBundleVariable[] = [
    {
      kind: "Path",
      variable: "ANTHROPIC_IDENTITY_TOKEN_FILE",
      file: connectorTokenFile,
    },
    {
      kind: "Value",
      variable: "ANTHROPIC_ORGANIZATION_ID",
      value: settings.organizationId,
    },
    {
      kind: "Value",
      variable: "ANTHROPIC_FEDERATION_RULE_ID",
      value: settings.federationRuleId,
    },
  ];
  if (settings.serviceAccountId !== undefined)
    variables.push({
      kind: "Value",
      variable: "ANTHROPIC_SERVICE_ACCOUNT_ID",
      value: settings.serviceAccountId,
    });
  if (settings.workspaceId !== undefined)
    variables.push({
      kind: "Value",
      variable: "ANTHROPIC_WORKSPACE_ID",
      value: settings.workspaceId,
    });
  return connectorCredentialBundle(connector, token, expiresAtMs, {
    files: [],
    variables,
  });
}
