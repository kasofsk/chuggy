/**
 * A Google Cloud connector's adaptor: a token a workload identity pool's
 * provider exchanges, delivered as the external-account configuration file
 * Google's client libraries and CLI read.
 */

import type { Connector } from "../contract/connectors.ts";
import {
  heldCredentialFilePlaceholder,
  type WorkerHeldCredentialBundle,
} from "../contract/workerPlane.ts";
import {
  connectorCredentialBundle,
  connectorTokenFile,
} from "./connectorCredentialBundle.ts";
import type { JobIdentityTarget } from "./jobIdentityToken.ts";

export type GcpConnector = Extract<Connector, { readonly kind: "Gcp" }>;

/** Google's documented limit on a workload identity pool's mapped subject. */
export const gcpSubjectBytesMax = 127;

/** The bundle's file that holds the external-account configuration. */
export const gcpConfigurationFile = "config.json";

/** The pool provider's resource name, which the configuration's audience is. */
export function gcpWorkloadProvider(
  settings: GcpConnector["settings"],
): string {
  return `//iam.googleapis.com/projects/${settings.projectNumber}/locations/global/workloadIdentityPools/${settings.pool}/providers/${settings.provider}`;
}

/** The token's audience: the provider's resource name as an `https` URL. */
export function gcpTokenTarget(connector: GcpConnector): JobIdentityTarget {
  return {
    audience: `https:${gcpWorkloadProvider(connector.settings)}`,
    subjectBytesMax: gcpSubjectBytesMax,
    claims: {},
  };
}

/** The external-account configuration, serialised from an object so that no setting leaves its field. */
export function gcpConfiguration(connector: GcpConnector): string {
  const { settings } = connector;
  return JSON.stringify({
    type: "external_account",
    audience: gcpWorkloadProvider(settings),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    credential_source: {
      file: heldCredentialFilePlaceholder(connectorTokenFile),
      format: { type: "text" },
    },
    ...(settings.serviceAccount === undefined
      ? {}
      : {
          service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${settings.serviceAccount}:generateAccessToken`,
        }),
  });
}

export function gcpCredentialBundle(
  connector: GcpConnector,
  token: string,
  expiresAtMs: number,
): WorkerHeldCredentialBundle {
  return connectorCredentialBundle(connector, token, expiresAtMs, {
    files: [
      {
        file: gcpConfigurationFile,
        content: { kind: "Text", text: gcpConfiguration(connector) },
      },
    ],
    variables: [
      {
        kind: "Value",
        variable: "GOOGLE_APPLICATION_CREDENTIALS",
        value: heldCredentialFilePlaceholder(gcpConfigurationFile),
      },
    ],
  });
}
