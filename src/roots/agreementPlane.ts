/**
 * The process that records who agreed to which version of the deployment's
 * policies, composed against its own PostgreSQL role.
 *
 * IT REACHES POSTGRESQL AND ITS ISSUER'S DISCOVERY AND NOTHING ELSE. Its
 * database holds the agreements and nothing else, so `.dependency-cruiser.cjs`
 * holds it to its own store and what opening a pool reaches. It is ready only
 * when it connected as `agreementPlaneRole`, which can append to the record
 * and never alter or remove it.
 *
 * ONE PERSON'S STANDING IS SERVED ON A SECOND LISTENER, to a caller holding
 * no bearer, and only where `CHUG_AGREEMENT_PLANE_SERVICE_PORT` names its
 * port, on the first listener's host.
 *
 * EVERY VARIABLE IS READ BEFORE THE ISSUER IS DISCOVERED, so a start missing
 * one is refused naming it rather than after a network round trip that could
 * have failed for its own reasons. The composition is exported taking the
 * authentication, which is what lets a suite start it without an issuer.
 */
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import {
  createAgreementPlaneApp,
  createAgreementPlaneServiceApp,
} from "../adapters/http/agreementPlaneServer.ts";
import {
  oidcAuthentication,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import type { PrincipalAuthentication } from "../adapters/http/server.ts";
import {
  postgresPolicyAgreements,
  postgresPolicyAgreementsReady,
} from "../adapters/postgres/policyAgreements.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { agreementPlaneRole } from "../adapters/postgres/schema/shared.ts";
import type { AgreementPolicyEntry } from "../contract/agreementPlane.ts";
import {
  agreementPlane,
  agreementPlanePoliciesRead,
} from "../interpreter/agreementPlane.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { planeStopping } from "./planeStopping.ts";

/** Everything the plane is composed from, read before anything is reached. */
export interface AgreementPlaneEnvironment {
  readonly oidc: OidcAuthenticationConfig;
  readonly databaseUrl: string;
  readonly policies: readonly AgreementPolicyEntry[];
  readonly host: string;
  readonly port: number;
  readonly servicePort: number | undefined;
  readonly clientAddressHeader: string | undefined;
}

/** The plane's two listeners as composed, the second absent where no port names it. */
export interface AgreementPlaneComposition {
  readonly callers: FastifyInstance;
  readonly service: FastifyInstance | undefined;
}

const policiesVariable = "CHUG_AGREEMENT_PLANE_POLICIES";
const servicePortVariable = "CHUG_AGREEMENT_PLANE_SERVICE_PORT";
const clientAddressHeaderVariable =
  "CHUG_AGREEMENT_PLANE_CLIENT_ADDRESS_HEADER";

/** The deployment's policies, a malformed value refusing the start by the variable's name. */
function agreementPlanePolicies(): readonly AgreementPolicyEntry[] {
  try {
    return agreementPlanePoliciesRead(process.env[policiesVariable]);
  } catch (failure) {
    throw new Error(
      `${policiesVariable} ${failure instanceof Error ? failure.message : "is malformed"}`,
      { cause: failure },
    );
  }
}

/** The highest port a listener may be named. */
const agreementPlanePortMax = 65_535;

/** The service listener's port, or none where the deployment names none, a malformed one refusing the start. */
function agreementPlaneServicePort(): number | undefined {
  const port = process.env[servicePortVariable];
  if (port === undefined || port.length === 0) return undefined;
  const parsed = Number(port);
  if (!/^[1-9][0-9]*$/u.test(port) || parsed > agreementPlanePortMax)
    throw new Error(`${servicePortVariable} must be a port number`);
  return parsed;
}

/** The one header the client address is taken from, lower-cased, or none where the deployment names none. */
function agreementPlaneClientAddressHeader(): string | undefined {
  const header = process.env[clientAddressHeaderVariable];
  if (header === undefined || header.length === 0) return undefined;
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(header))
    throw new Error(`${clientAddressHeaderVariable} must be a header name`);
  return header.toLowerCase();
}

export function agreementPlaneEnvironment(): AgreementPlaneEnvironment {
  return {
    oidc: {
      issuer: planeEnvironmentRequired("CHUG_AGREEMENT_PLANE_OIDC_ISSUER"),
      audience: planeEnvironmentRequired("CHUG_AGREEMENT_PLANE_OIDC_AUDIENCE"),
      algorithms: planeEnvironmentRequired(
        "CHUG_AGREEMENT_PLANE_OIDC_ALGORITHMS",
      )
        .split(",")
        .map((algorithm) => algorithm.trim()),
      discoveryTimeoutMs: planeEnvironmentPositive(
        "CHUG_AGREEMENT_PLANE_OIDC_DISCOVERY_TIMEOUT_MS",
        5_000,
      ),
      jwksTimeoutMs: planeEnvironmentPositive(
        "CHUG_AGREEMENT_PLANE_OIDC_JWKS_TIMEOUT_MS",
        5_000,
      ),
    },
    databaseUrl: planeEnvironmentRequired("CHUG_AGREEMENT_PLANE_DATABASE_URL"),
    policies: agreementPlanePolicies(),
    host: process.env["CHUG_AGREEMENT_PLANE_HOST"] ?? "127.0.0.1",
    port: planeEnvironmentPositive("CHUG_AGREEMENT_PLANE_PORT", 3_006),
    servicePort: agreementPlaneServicePort(),
    clientAddressHeader: agreementPlaneClientAddressHeader(),
  };
}

/** The plane over the database `environment` names, verifying bearers with `authentication`. */
export function agreementPlaneComposed(
  environment: AgreementPlaneEnvironment,
  authentication: PrincipalAuthentication,
): AgreementPlaneComposition {
  const pool = postgresPool(environment.databaseUrl);
  const plane = agreementPlane(postgresPolicyAgreements(pool), {
    issuer: environment.oidc.issuer,
    policies: environment.policies,
  });
  const callers = createAgreementPlaneApp({
    authentication,
    plane,
    clientAddressHeader: environment.clientAddressHeader,
    ready: () => postgresPolicyAgreementsReady(pool, agreementPlaneRole),
  });
  const service =
    environment.servicePort === undefined
      ? undefined
      : createAgreementPlaneServiceApp(plane);
  let open = service === undefined ? 1 : 2;
  const closed = async () => {
    open -= 1;
    if (open === 0) await pool.end();
  };
  callers.addHook("onClose", closed);
  service?.addHook("onClose", closed);
  return { callers, service };
}

async function main(): Promise<void> {
  const environment = agreementPlaneEnvironment();
  const { callers, service } = agreementPlaneComposed(
    environment,
    await oidcAuthentication(environment.oidc),
  );
  planeStopping(callers, "agreement plane");
  await callers.listen({ host: environment.host, port: environment.port });
  if (service === undefined || environment.servicePort === undefined) return;
  planeStopping(service, "agreement plane service");
  await service.listen({
    host: environment.host,
    port: environment.servicePort,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `agreement plane: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
