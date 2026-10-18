/**
 * The app serving only the trailing services a suite composes, behind a bearer
 * that names one caller.
 */

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import type { PersonalRunnerService } from "../../src/interpreter/personalRunnerRegistration.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { ProjectOwnerFallbackAdministration } from "../../src/interpreter/projectOwnerFallback.ts";
import type { RepositoryTreeReads } from "../../src/interpreter/repositoryTree.ts";
import type { TicketActionReaches } from "../../src/interpreter/ticketActionReach.ts";
import type { TicketLandingReads } from "../../src/interpreter/ticketLandings.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

/** The services one app serves, each absent where its suite composes none. */
export interface CallerAppServices {
  readonly actionReach?: TicketActionReaches;
  readonly landings?: TicketLandingReads;
  readonly personalRunners?: PersonalRunnerService;
  readonly ownerFallback?: ProjectOwnerFallbackAdministration;
  readonly repositoryTree?: RepositoryTreeReads;
}

/** The app serving `services`, where `Bearer valid` authenticates `caller` and any other bearer nobody. */
export function callerApp(caller: Principal, services: CallerAppServices) {
  return createNativeHttpApp(
    unservedNativeWeb,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: caller },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    services.actionReach,
    services.landings,
    services.personalRunners,
    services.ownerFallback,
    services.repositoryTree,
  );
}
