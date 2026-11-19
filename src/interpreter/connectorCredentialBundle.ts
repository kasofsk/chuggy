/**
 * What every connector's bundle shares: the connector's credential name, the
 * token's expiry, and the token itself as the one secret file `token`. An
 * adaptor adds its provider's files and variables beside them.
 */

import type { Connector } from "../contract/connectors.ts";
import { connectorCredentialOf } from "../contract/workerEnvironment.ts";
import type {
  HeldCredentialBundleVariable,
  WorkerHeldCredentialBundle,
} from "../contract/workerPlane.ts";

/** The bundle's file that holds the token. */
export const connectorTokenFile = "token";

type ConnectorBundleFile = WorkerHeldCredentialBundle["files"][number];

/** The provider's own part of a bundle. */
export interface ConnectorCredentialDelivery {
  readonly files: readonly ConnectorBundleFile[];
  readonly variables: readonly HeldCredentialBundleVariable[];
}

/** The bundle that hands `token`, good until `expiresAtMs`, to a job by the connector's credential name. */
export function connectorCredentialBundle(
  connector: Connector,
  token: string,
  expiresAtMs: number,
  delivery: ConnectorCredentialDelivery,
): WorkerHeldCredentialBundle {
  if (token === "")
    throw new RangeError("connector bundle: the token is empty");
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0)
    throw new RangeError("connector bundle: the expiry is no instant");
  return {
    credential: connectorCredentialOf(connector.name),
    files: [
      {
        file: connectorTokenFile,
        content: { kind: "Secret", secret: token },
      },
      ...delivery.files,
    ],
    variables: [...delivery.variables],
    expiresAtMs,
  };
}
