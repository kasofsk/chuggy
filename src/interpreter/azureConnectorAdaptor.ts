/**
 * An Azure connector's adaptor: a token Microsoft Entra ID exchanges as a
 * federated credential, delivered as the variables its SDKs read.
 */

import type { Connector } from "../contract/connectors.ts";
import type { WorkerHeldCredentialBundle } from "../contract/workerPlane.ts";
import {
  connectorCredentialBundle,
  connectorTokenFile,
} from "./connectorCredentialBundle.ts";
import type { JobIdentityTarget } from "./jobIdentityToken.ts";

export type AzureConnector = Extract<Connector, { readonly kind: "Azure" }>;

/** The audience Entra ID requires of a federated credential's token. */
export const azureTokenAudience = "api://AzureADTokenExchange";

/** Entra ID's documented limit on a federated credential's subject. */
export const azureSubjectBytesMax = 600;

/** The Entra ID authority of Azure's public cloud. */
export const azureAuthorityHost = "https://login.microsoftonline.com/";

export function azureTokenTarget(): JobIdentityTarget {
  return {
    audience: azureTokenAudience,
    subjectBytesMax: azureSubjectBytesMax,
    claims: {},
  };
}

export function azureCredentialBundle(
  connector: AzureConnector,
  token: string,
  expiresAtMs: number,
): WorkerHeldCredentialBundle {
  return connectorCredentialBundle(connector, token, expiresAtMs, {
    files: [],
    variables: [
      {
        kind: "Path",
        variable: "AZURE_FEDERATED_TOKEN_FILE",
        file: connectorTokenFile,
      },
      {
        kind: "Value",
        variable: "AZURE_CLIENT_ID",
        value: connector.settings.clientId,
      },
      {
        kind: "Value",
        variable: "AZURE_TENANT_ID",
        value: connector.settings.tenantId,
      },
      {
        kind: "Value",
        variable: "AZURE_AUTHORITY_HOST",
        value: azureAuthorityHost,
      },
    ],
  });
}
