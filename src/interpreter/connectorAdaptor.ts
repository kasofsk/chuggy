/**
 * The adaptor for a connector: the shape its token takes and the bundle that
 * hands the signed token to a job. Each kind's rules are in its own module;
 * this one only chooses, so a kind without an adaptor does not compile.
 */

import type { Connector } from "../contract/connectors.ts";
import type { WorkerHeldCredentialBundle } from "../contract/workerPlane.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  anthropicCredentialBundle,
  anthropicTokenTarget,
} from "./anthropicConnectorAdaptor.ts";
import {
  awsCredentialBundle,
  awsTokenTarget,
  type AwsTokenTargetRefusal,
} from "./awsConnectorAdaptor.ts";
import {
  azureCredentialBundle,
  azureTokenTarget,
} from "./azureConnectorAdaptor.ts";
import { gcpCredentialBundle, gcpTokenTarget } from "./gcpConnectorAdaptor.ts";
import type {
  JobIdentitySubject,
  JobIdentityTarget,
} from "./jobIdentityToken.ts";

/** Why no token's shape could be built, which only AWS's session tags can refuse. */
export type ConnectorTokenTargetRefusal = AwsTokenTargetRefusal;

export type ConnectorTokenTargetBuilt =
  | { readonly result: "Target"; readonly target: JobIdentityTarget }
  | {
      readonly result: "Refused";
      readonly refusal: ConnectorTokenTargetRefusal;
    };

export interface ConnectorAdaptor {
  /** The shape of the token for `subject`, or why there can be none. */
  tokenTarget(subject: JobIdentitySubject): ConnectorTokenTargetBuilt;
  /** The bundle that hands `token`, good until `expiresAtMs`, to a job. */
  credentialBundle(
    token: string,
    expiresAtMs: number,
  ): WorkerHeldCredentialBundle;
}

function connectorAdaptorTarget(
  target: JobIdentityTarget,
): ConnectorTokenTargetBuilt {
  return { result: "Target", target };
}

export function connectorAdaptor(connector: Connector): ConnectorAdaptor {
  switch (connector.kind) {
    case "Aws":
      return {
        tokenTarget: (subject) => awsTokenTarget(connector, subject),
        credentialBundle: (token, expiresAtMs) =>
          awsCredentialBundle(connector, token, expiresAtMs),
      };
    case "Gcp":
      return {
        tokenTarget: () => connectorAdaptorTarget(gcpTokenTarget(connector)),
        credentialBundle: (token, expiresAtMs) =>
          gcpCredentialBundle(connector, token, expiresAtMs),
      };
    case "Azure":
      return {
        tokenTarget: () => connectorAdaptorTarget(azureTokenTarget()),
        credentialBundle: (token, expiresAtMs) =>
          azureCredentialBundle(connector, token, expiresAtMs),
      };
    case "Anthropic":
      return {
        tokenTarget: () => connectorAdaptorTarget(anthropicTokenTarget()),
        credentialBundle: (token, expiresAtMs) =>
          anthropicCredentialBundle(connector, token, expiresAtMs),
      };
    default:
      return assertNever(connector);
  }
}
