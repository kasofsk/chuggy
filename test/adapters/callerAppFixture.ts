/**
 * The app serving only the trailing services a suite composes, behind a bearer
 * that names one caller.
 */

import { nativeHttpMediaType } from "../../src/contract/http.ts";
import {
  createNativeHttpApp,
  type UnrunDeletions,
} from "../../src/adapters/http/server.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import type { AgentAccountService } from "../../src/interpreter/agentAccount.ts";
import type { AppearanceService } from "../../src/interpreter/appearance.ts";
import type { MemberChat } from "../../src/interpreter/memberChat.ts";
import type { ProjectAppearanceService } from "../../src/interpreter/projectAppearance.ts";
import type { ProjectImageService } from "../../src/interpreter/projectImages.ts";
import type { PersonalRunnerService } from "../../src/interpreter/personalRunnerRegistration.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { ProjectOwnerFallbackAdministration } from "../../src/interpreter/projectOwnerFallback.ts";
import type { TicketActionReaches } from "../../src/interpreter/ticketActionReach.ts";
import type { TicketLandingReads } from "../../src/interpreter/ticketLandings.ts";
import type { LandingQueueReads } from "../../src/interpreter/landingQueues.ts";
import type { TicketTakes } from "../../src/interpreter/ticketTake.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

/** The services one app serves, each absent where its suite composes none. */
export interface CallerAppServices {
  readonly actionReach?: TicketActionReaches;
  readonly landings?: TicketLandingReads;
  readonly personalRunners?: PersonalRunnerService;
  readonly ownerFallback?: ProjectOwnerFallbackAdministration;
  readonly chat?: MemberChat;
  readonly agentAccounts?: AgentAccountService;
  readonly landingQueues?: LandingQueueReads;
  readonly deletions?: UnrunDeletions;
  readonly takes?: TicketTakes;
  readonly appearance?: AppearanceService;
  readonly projectAppearance?: ProjectAppearanceService;
  readonly projectImages?: ProjectImageService;
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
    undefined,
    services.chat,
    undefined,
    services.agentAccounts,
    undefined,
    services.landingQueues,
    services.deletions,
    services.takes,
    services.appearance,
    {
      themes: services.projectAppearance,
      images: services.projectImages,
    },
  );
}

/** The code of the error an answer carries. */
export function callerAppCodeOf(answer: { json<T>(): T }): string {
  return answer.json<{ error: { code: string } }>().error.code;
}

/** A write to `url` as the app's caller, carrying `body` as the versioned media type where there is one. */
export function callerAppSent(
  app: ReturnType<typeof callerApp>,
  method: "PUT" | "DELETE",
  url: string,
  body?: unknown,
) {
  const bearer = { authorization: "Bearer valid" };
  return app.inject({
    method,
    url,
    headers:
      body === undefined
        ? bearer
        : { ...bearer, "content-type": nativeHttpMediaType },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}
