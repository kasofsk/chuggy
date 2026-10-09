/**
 * What the invite page holds for the life of the page and not of a component:
 * the token this tab was opened with, and the one redemption sent for it.
 *
 * A component mounts twice under React's strict mode and again whenever what
 * is above it redraws it, and a redemption sent twice is answered absent the
 * second time although the first granted everything. So the send is held
 * here, by token, and every mount is handed the same answer. What the answer
 * decides — the cookie cleared, the reader sent on — is performed here too,
 * once, when it arrives.
 *
 * A token is kept from wherever it was first read, the cookie as much as the
 * fragment, because the page that clears the cookie still has that token's
 * answer to draw.
 */

import type { AccessInviteLinkRedeemed } from "../../../../src/contract/accessPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import {
  inviteCookieCleared,
  inviteCookieWritten,
  inviteElsewherePath,
  inviteFlowCarried,
  invitePageDecided,
  inviteRedemption,
  inviteTokenRead,
} from "./invitePage.ts";
import type { InvitePage, InviteRedemption } from "./invitePage.ts";
import type { SessionLocation } from "./sessionHolder.ts";

/** The address bar and the cookies, as the page reaches them. */
export interface InvitePorts {
  readonly location: () => SessionLocation;
  readonly anchor: () => string;
  readonly replacePath: (path: string) => void;
  /** Leaves this document for another address, in this entry's place. */
  readonly replaceLocation: (path: string) => void;
  readonly cookies: () => string;
  readonly cookieWrite: (line: string) => void;
}

export interface InviteHolder {
  /** Takes the token out of the address this tab was opened at, where it is the invite page's. */
  readonly arrive: () => void;
  readonly opened: (signedIn: boolean) => InvitePage;
  readonly cookieClear: (domain: string | undefined) => void;
  /** Writes the cookie the token crosses a sign-in in, which is all that outlives this page. */
  readonly leave: (token: string, domain: string | undefined) => void;
  readonly elsewhere: () => void;
  /** The one redemption of a token, sent by the first call that names it. */
  readonly redeem: (
    token: string,
    domain: string | undefined,
    send: (token: string) => Promise<ApiResult<AccessInviteLinkRedeemed>>,
  ) => Promise<InviteRedemption>;
  /** Forgets a redemption that failed, so the next call sends one again. */
  readonly retry: () => void;
}

interface InviteRedemptionHeld {
  readonly token: string;
  readonly answered: Promise<InviteRedemption>;
}

export function createInviteHolder(ports: InvitePorts): InviteHolder {
  let tokenKept: string | undefined;
  let redemption: InviteRedemptionHeld | undefined;
  const cookieClear = (domain: string | undefined): void => {
    ports.cookieWrite(inviteCookieCleared(domain));
  };
  return {
    arrive: () => {
      const { pathname, search } = ports.location();
      if (pathname !== inviteRoutePath) return;
      const fragment = ports.anchor();
      if (fragment === "") return;
      tokenKept = inviteTokenRead(fragment);
      ports.replacePath(`${pathname}${search}`);
    },
    opened: (signedIn) => {
      const page = invitePageDecided({
        flow: inviteFlowCarried(ports.location().search),
        signedIn,
        tokenKept,
        cookies: ports.cookies(),
      });
      if (page.page === "Invited" || page.page === "Redeeming")
        tokenKept = page.token;
      return page;
    },
    cookieClear,
    leave: (token, domain) => {
      ports.cookieWrite(inviteCookieWritten(token, domain));
    },
    elsewhere: () => {
      ports.replaceLocation(inviteElsewherePath);
    },
    redeem: (token, domain, send) => {
      if (redemption?.token !== token)
        redemption = {
          token,
          answered: send(token).then((result) => {
            const came = inviteRedemption(result);
            if (came.cookieCleared) cookieClear(domain);
            if (came.outcome === "Redeemed") ports.replaceLocation(came.path);
            return came;
          }),
        };
      return redemption.answered;
    },
    retry: () => {
      redemption = undefined;
    },
  };
}
