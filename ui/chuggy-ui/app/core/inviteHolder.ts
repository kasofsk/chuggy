/**
 * What the invite page holds for the life of the page and not of a component:
 * the token this tab was opened with, and the one send made for it without a
 * name.
 *
 * A component mounts twice under React's strict mode and again whenever what
 * is above it redraws it, and a mount is not a press: no person asked for the
 * send a second mount would make. So the send without a name is held here, by
 * token, and every mount is handed the same answer. What an answer decides —
 * the cookie cleared, the reader sent on — is performed here too, once, when
 * it arrives.
 *
 * A link that makes a workspace answers that send by asking for the
 * workspace's name. The send that carries one is no part of what is held: a
 * press makes it, each press makes one, and the held answer stays as it was,
 * so the page goes on knowing the link asked.
 *
 * A token is kept from wherever it was first read, the cookie as much as the
 * fragment, because the page that clears the cookie still has that token's
 * answer to draw.
 *
 * The token leaves the address as the holder is made, so a holder made before
 * the first render leaves no frame drawn with it in the address bar. A link
 * opened in a tab that is already at the page changes the fragment and loads
 * nothing, so the holder listens for that and loads the document again: the
 * link then arrives as any other does, and nothing this page held for the
 * last one is carried.
 */

import type { AccessInviteLinkRedeemed } from "../../../../src/contract/accessPlane.ts";

import type { ApiResult } from "./apiRequest.ts";
import { inviteRoutePath } from "./inviteLinks.ts";
import {
  inviteCookieCleared,
  inviteCookieWritten,
  inviteElsewherePath,
  inviteFlowCarried,
  inviteNaming,
  invitePageDecided,
  inviteRedemption,
  inviteTokenRead,
} from "./invitePage.ts";
import type {
  InviteNaming,
  InvitePage,
  InviteRedemption,
} from "./invitePage.ts";
import type { SessionLocation } from "./sessionHolder.ts";

/** The address bar and the cookies, as the page reaches them. */
export interface InvitePorts {
  readonly location: () => SessionLocation;
  readonly anchor: () => string;
  /** Tells `heard` each time the fragment changes under this document. */
  readonly anchorHeard: (heard: () => void) => void;
  readonly replacePath: (path: string) => void;
  /** Leaves this document for another address, in this entry's place. */
  readonly replaceLocation: (path: string) => void;
  readonly cookies: () => string;
  readonly cookieWrite: (line: string) => void;
  /** Loads this document again at the address it is at. */
  readonly reload: () => void;
}

type InviteAnswer = Promise<ApiResult<AccessInviteLinkRedeemed>>;

export interface InviteHolder {
  readonly opened: (signedIn: boolean) => InvitePage;
  readonly cookieClear: (domain: string | undefined) => void;
  /** Writes the cookie the token crosses a sign-in in, which is all that outlives this page. */
  readonly leave: (token: string, domain: string | undefined) => void;
  readonly elsewhere: () => void;
  /** The one send of a token without a name, made by the first call that names it. */
  readonly redeem: (
    token: string,
    domain: string | undefined,
    send: (token: string) => InviteAnswer,
  ) => Promise<InviteRedemption>;
  /** Forgets a send without a name that failed, so the next call makes one again. */
  readonly retry: () => void;
  /** One send of a token with the name of the workspace it makes, made by every call and so asked for by nothing but a press. */
  readonly named: (
    token: string,
    domain: string | undefined,
    workspace: string,
    send: (token: string, workspace: string) => InviteAnswer,
  ) => Promise<InviteNaming>;
}

interface InviteRedemptionHeld {
  readonly token: string;
  readonly answered: Promise<InviteRedemption>;
}

/** The token in the address this tab was opened at, taken out of it, where the address is the invite page's. */
function inviteArrived(ports: InvitePorts): string | undefined {
  const { pathname, search } = ports.location();
  if (pathname !== inviteRoutePath) return undefined;
  const fragment = ports.anchor();
  if (fragment === "") return undefined;
  ports.replacePath(`${pathname}${search}`);
  return inviteTokenRead(fragment);
}

/** A fragment that changed under a document already drawn, which is a link opened at the page where it names one. */
function inviteRearrived(ports: InvitePorts): void {
  if (ports.location().pathname !== inviteRoutePath) return;
  if (ports.anchor() !== "") ports.reload();
}

export function createInviteHolder(ports: InvitePorts): InviteHolder {
  let tokenKept = inviteArrived(ports);
  let redemption: InviteRedemptionHeld | undefined;
  ports.anchorHeard(() => {
    inviteRearrived(ports);
  });
  const cookieClear = (domain: string | undefined): void => {
    ports.cookieWrite(inviteCookieCleared(domain));
  };
  const performed = <Came extends InviteRedemption | InviteNaming>(
    came: Came,
    domain: string | undefined,
  ): Came => {
    if (came.cookieCleared) cookieClear(domain);
    if (came.outcome === "Redeemed") ports.replaceLocation(came.path);
    return came;
  };
  return {
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
          answered: send(token).then((result) =>
            performed(inviteRedemption(result), domain),
          ),
        };
      return redemption.answered;
    },
    retry: () => {
      redemption = undefined;
    },
    named: (token, domain, workspace, send) =>
      send(token, workspace).then((result) =>
        performed(inviteNaming(result), domain),
      ),
  };
}
