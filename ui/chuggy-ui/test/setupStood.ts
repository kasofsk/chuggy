/**
 * Where a person stands on a site described by the shared model, read as the
 * setup program reads it: the reads go through ports that answer from the
 * model, so a case states a site and gets the standing the program would.
 */

import type { ApiPorts } from "../app/core/apiRequest.ts";
import { setupAnswersNone } from "../app/core/setupArguments.ts";
import type { SetupAnswers } from "../app/core/setupArguments.ts";
import { setupNext } from "../app/core/setupNext.ts";
import { readSetup } from "../app/core/setupReads.ts";
import type { SetupReads } from "../app/core/setupReads.ts";
import { setupRepositoryRead } from "../app/core/setupRemote.ts";
import type { SetupNext } from "../app/core/setupReport.ts";
import { setupStanding } from "../app/core/setupStanding.ts";
import type { SetupStanding } from "../app/core/setupStanding.ts";
import { setupSiteAnswered } from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

export const stoodSite = "https://chuggy.example";

export interface Asking {
  readonly answers?: Partial<SetupAnswers>;
  /** The address the folder's `origin` names, where the folder has one. */
  readonly remote?: string;
  /** Every request sent, as its method and its path with its query. */
  readonly sent?: string[];
  /** What stands between the run and the site's answers, where a case answers a read its own way. */
  readonly through?: (ports: ApiPorts) => ApiPorts;
}

/** Ports that answer from `site` by path, as the ports a session is opened with are asked, and fail whatever it has no answer for. */
export function sitePorts(site: SetupSite, sent: string[] = []): ApiPorts {
  return {
    fetch: (target, init) => {
      sent.push(`${init.method} ${target}`);
      const answer = setupSiteAnswered(site, target) ?? {
        status: 500,
        body: {},
      };
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), { status: answer.status }),
      );
    },
    bearer: () => Promise.resolve("access"),
    sleepMs: () => Promise.resolve(),
  };
}

export function siteRead(
  site: SetupSite,
  asking: Asking = {},
): Promise<SetupReads> {
  const ports = sitePorts(site, asking.sent);
  return readSetup(asking.through?.(ports) ?? ports, {
    site: stoodSite,
    answers: { ...setupAnswersNone, ...asking.answers },
    remote:
      asking.remote === undefined
        ? undefined
        : setupRepositoryRead(asking.remote),
    workspaces: {
      tenants: site.tenants,
      truncated: site.fates.get("workspaces") === "Cut",
    },
  });
}

export async function stood(
  site: SetupSite,
  asking: Asking = {},
): Promise<SetupStanding> {
  return setupStanding(await siteRead(site, asking));
}

/** The next thing for a site, as a run given `asking` would name it. */
export async function nextOf(
  site: SetupSite,
  asking: Asking = {},
): Promise<SetupNext> {
  return setupNext(await stood(site, asking), {
    ...setupAnswersNone,
    ...asking.answers,
  });
}
