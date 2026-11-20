/**
 * A connector's credential: an identity token chuggy signs for the job, shaped
 * and delivered by the connector's adaptor, minted for each ask.
 *
 * NO PROVIDER IS NAMED HERE. The token's shape and its bundle are the
 * adaptor's; this issuer only joins the connector, its adaptor, the claims and
 * the signer.
 *
 * EVERY ASK IS A FRESH MINT, so a job is never handed a token near its expiry.
 * A refusal is answered as one, never with a token of another shape.
 */

import { connectorNameOf } from "../contract/workerEnvironment.ts";
import type { Connector } from "../contract/connectors.ts";
import { connectorAdaptor, type ConnectorAdaptor } from "./connectorAdaptor.ts";
import type {
  CredentialIssued,
  CredentialIssuer,
  CredentialRequester,
} from "./credentialIssuers.ts";
import type { JobIdentityIssuing } from "./jobIdentityIssuerSettings.ts";
import {
  jobIdentityClaims,
  type JobIdentitySigner,
  type JobIdentitySubject,
} from "./jobIdentityToken.ts";
import type {
  ProjectConnectorRead,
  ProjectConnectorStanding,
} from "./projectConnectors.ts";

const millisecondsPerSecond = 1_000;

/** What the issuer reads, shapes, signs and dates a token with. */
export interface ConnectorCredentialOptions {
  readonly connectors: ProjectConnectorRead;
  readonly signer: JobIdentitySigner;
  readonly issuerBaseUrl: string;
  readonly nowMs: () => number;
  readonly adaptor?: (connector: Connector) => ConnectorAdaptor;
}

/** Who the requester's token is for, absent where its job runs no workload. */
function connectorCredentialSubject(
  requester: CredentialRequester,
): JobIdentitySubject | undefined {
  if (requester.workload === undefined) return undefined;
  return {
    tenant: requester.partition.tenant,
    project: requester.partition.project,
    workload: requester.workload,
    task:
      requester.taskKind === "Work"
        ? { taskKind: "Work" }
        : { taskKind: "Evaluation", evaluator: requester.evaluator },
    ticket: requester.ticket,
    ...(requester.repository === undefined
      ? {}
      : { repository: requester.repository }),
  };
}

/** A token for `subject` under `connector`'s adaptor, answered as its bundle, a refusal or an outage. */
async function connectorCredentialMinted(
  options: ConnectorCredentialOptions,
  connector: Connector,
  subject: JobIdentitySubject,
): Promise<CredentialIssued> {
  const adaptor = (options.adaptor ?? connectorAdaptor)(connector);
  const target = adaptor.tokenTarget(subject);
  if (target.result === "Refused")
    return { issued: "Absent", reason: "IssuerRefused" };
  const claims = jobIdentityClaims(
    subject,
    options.issuerBaseUrl,
    target.target,
    options.nowMs(),
  );
  if (claims.result === "Refused")
    return { issued: "Absent", reason: "IssuerRefused" };
  const expiresAtSecs = claims.claims["exp"];
  if (typeof expiresAtSecs !== "number" || !Number.isSafeInteger(expiresAtSecs))
    throw new RangeError("connector credential: a token's exp is no instant");
  let token: string;
  try {
    token = await options.signer.sign(claims.claims);
  } catch {
    return { issued: "Unavailable" };
  }
  return {
    issued: "Bundle",
    bundle: adaptor.credentialBundle(
      token,
      expiresAtSecs * millisecondsPerSecond,
    ),
  };
}

/** Issues each connector credential for the requester's own project's connector of that name, and serves no other name. */
export function connectorCredentialIssuer(
  options: ConnectorCredentialOptions,
): CredentialIssuer {
  return {
    issue: async (requester, credential) => {
      const name = connectorNameOf(credential);
      if (name === undefined) return { issued: "NotServed" };
      let standing: ProjectConnectorStanding | undefined;
      try {
        standing = await options.connectors.connector(
          requester.partition,
          name,
        );
      } catch {
        return { issued: "Unavailable" };
      }
      if (standing === undefined)
        return { issued: "Absent", reason: "NotEnabled" };
      const subject = connectorCredentialSubject(requester);
      if (subject === undefined)
        return { issued: "Absent", reason: "IssuerRefused" };
      return connectorCredentialMinted(options, standing.connector, subject);
    },
  };
}

/** The connector credential's issuer under `identity`, and none where the plane holds no identity issuer. */
export function connectorCredentialIssuers(
  identity: JobIdentityIssuing | undefined,
  options: Omit<ConnectorCredentialOptions, "signer" | "issuerBaseUrl">,
): readonly CredentialIssuer[] {
  return identity === undefined
    ? []
    : [connectorCredentialIssuer({ ...options, ...identity })];
}
