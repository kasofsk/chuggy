/**
 * The process where a tenant's people and their roles are managed, composed
 * from variables alone.
 *
 * IT NAMES NO DATABASE. Every role it answers is a tuple the authority holds,
 * so it has no PostgreSQL role, migration or pool, and `.dependency-cruiser.cjs`
 * holds it to reaching no PostgreSQL adapter at all.
 *
 * THE DIRECTORY IS OPTIONAL. A deployment that brings its own sign-in names
 * no directory address, and the plane then answers every invitation as not
 * configured and lists subjects alone.
 *
 * EVERY VARIABLE IS READ BEFORE THE ISSUER IS DISCOVERED, so a start missing
 * one is refused naming it rather than after a network round trip that could
 * have failed for its own reasons. The composition is exported taking the
 * authentication, which is what lets a suite start it without an issuer.
 */
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { createAccessPlaneApp } from "../adapters/http/accessPlaneServer.ts";
import {
  oidcAuthentication,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import type { PrincipalAuthentication } from "../adapters/http/server.ts";
import { githubUserLookup } from "../adapters/forge/githubUserLookup.ts";
import { ketoAccessTuples } from "../adapters/keto/accessTuples.ts";
import {
  ketoProjectAccess,
  ketoReadiness,
} from "../adapters/keto/projectAccess.ts";
import { ketoProjectGrants } from "../adapters/keto/projectGrants.ts";
import { kratosAccessDirectory } from "../adapters/kratos/identities.ts";
import {
  checkedAccessDirectorySettings,
  type AccessDirectorySettings,
} from "../interpreter/accessDirectory.ts";
import { accessAbilities } from "../interpreter/accessAbilities.ts";
import { accessAuthorities } from "../interpreter/accessAuthorities.ts";
import { accessInvitations } from "../interpreter/accessInvitation.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
} from "../interpreter/accessPlane.ts";
import {
  checkedProjectAccessSettings,
  projectAccessTimeoutMsDefault,
  type ProjectAccessSettings,
} from "../interpreter/projectAccess.ts";
import {
  checkedProjectGrantSettings,
  type ProjectGrantSettings,
} from "../interpreter/projectGrant.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { planeStopping } from "./planeStopping.ts";

/** Everything the plane is composed from, read before anything is reached. */
export interface AccessPlaneEnvironment {
  readonly oidc: OidcAuthenticationConfig;
  readonly read: ProjectAccessSettings;
  readonly write: ProjectGrantSettings;
  readonly directory: AccessDirectorySettings | undefined;
  readonly host: string;
  readonly port: number;
}

/** The directory's settings, or none where the deployment names no directory address. */
function accessPlaneDirectory(): AccessDirectorySettings | undefined {
  const adminUrl = process.env["CHUG_ACCESS_PLANE_KRATOS_ADMIN_URL"];
  if (adminUrl === undefined || adminUrl.length === 0) return undefined;
  return checkedAccessDirectorySettings({
    adminUrl,
    requestTimeoutMs: planeEnvironmentPositive(
      "CHUG_ACCESS_PLANE_KRATOS_TIMEOUT_MS",
      projectAccessTimeoutMsDefault,
    ),
  });
}

export function accessPlaneEnvironment(): AccessPlaneEnvironment {
  const requestTimeoutMs = planeEnvironmentPositive(
    "CHUG_ACCESS_PLANE_KETO_TIMEOUT_MS",
    projectAccessTimeoutMsDefault,
  );
  return {
    oidc: {
      issuer: planeEnvironmentRequired("CHUG_ACCESS_PLANE_OIDC_ISSUER"),
      audience: planeEnvironmentRequired("CHUG_ACCESS_PLANE_OIDC_AUDIENCE"),
      algorithms: planeEnvironmentRequired("CHUG_ACCESS_PLANE_OIDC_ALGORITHMS")
        .split(",")
        .map((algorithm) => algorithm.trim()),
      discoveryTimeoutMs: planeEnvironmentPositive(
        "CHUG_ACCESS_PLANE_OIDC_DISCOVERY_TIMEOUT_MS",
        5_000,
      ),
      jwksTimeoutMs: planeEnvironmentPositive(
        "CHUG_ACCESS_PLANE_OIDC_JWKS_TIMEOUT_MS",
        5_000,
      ),
    },
    read: checkedProjectAccessSettings({
      readUrl: planeEnvironmentRequired("CHUG_ACCESS_PLANE_KETO_READ_URL"),
      requestTimeoutMs,
    }),
    write: checkedProjectGrantSettings({
      writeUrl: planeEnvironmentRequired("CHUG_ACCESS_PLANE_KETO_WRITE_URL"),
      requestTimeoutMs,
    }),
    directory: accessPlaneDirectory(),
    host: process.env["CHUG_ACCESS_PLANE_HOST"] ?? "127.0.0.1",
    port: planeEnvironmentPositive("CHUG_ACCESS_PLANE_PORT", 3_003),
  };
}

/** The plane over the authority `environment` names, verifying bearers with `authentication`. */
export function accessPlaneComposed(
  environment: AccessPlaneEnvironment,
  authentication: PrincipalAuthentication,
): FastifyInstance {
  const readiness = ketoReadiness(environment.read);
  const ports = {
    access: ketoProjectAccess(environment.read),
    tuples: ketoAccessTuples(environment.read),
    grants: ketoProjectGrants(environment.write),
    directory:
      environment.directory === undefined
        ? undefined
        : kratosAccessDirectory(environment.directory),
  };
  const issuer = environment.oidc.issuer;
  return createAccessPlaneApp({
    authentication,
    plane: accessPlane(ports, { issuer, bounds: accessPlaneBoundsDefault }),
    invitations: accessInvitations(
      {
        ...ports,
        github:
          ports.directory === undefined
            ? undefined
            : githubUserLookup({ fetch }),
      },
      { issuer },
    ),
    abilities: accessAbilities(ports, { bounds: accessPlaneBoundsDefault }),
    authorities: accessAuthorities(ports, {
      issuer,
      bounds: accessPlaneBoundsDefault,
    }),
    ready: () => readiness.ready(),
  });
}

async function main(): Promise<void> {
  const environment = accessPlaneEnvironment();
  const app = accessPlaneComposed(
    environment,
    await oidcAuthentication(environment.oidc),
  );
  planeStopping(app, "access plane");
  await app.listen({ host: environment.host, port: environment.port });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `access plane: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
