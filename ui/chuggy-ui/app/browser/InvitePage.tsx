/**
 * The page an invite link is opened at, drawn the same with a session and
 * without one: a card, one line, and at most one action.
 *
 * It reads no router, because the tree's root draws it for a browser that
 * holds no session and has no router, and the route draws it for a reader.
 * What it draws and what it does to the cookie are decided in
 * `ui/chuggy-ui/app/core/invitePage.ts`; what must outlive a mount, the token
 * and the one redemption sent for it, is the holder's, handed down from the
 * process root.
 *
 * NOTHING HERE LEAVES THE PAGE WITHOUT A PRESS but a redemption the plane
 * took. A person the sign-in service refused is drawn a card and not sent
 * round again.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { apiRedeemInviteLink } from "../core/accessRoutes.ts";
import type { InviteHolder } from "../core/inviteHolder.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import { inviteElsewherePath, invitePageWords } from "../core/invitePage.ts";
import type { InviteRedemption } from "../core/invitePage.ts";
import { useApiPorts } from "./api.ts";
import { SessionCard, SignedOutCard } from "./SessionCard.tsx";
import { useSessionHolder, useSessionSnapshot } from "./session.tsx";
import { Button } from "./ui/Button.tsx";
import { Locomotive } from "./ui/Locomotive.tsx";

const InviteContext = createContext<InviteHolder | undefined>(undefined);

export function InviteProvider(props: {
  readonly holder: InviteHolder;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <InviteContext.Provider value={props.holder}>
      {props.children}
    </InviteContext.Provider>
  );
}

function useInviteHolder(): InviteHolder {
  const holder = useContext(InviteContext);
  if (holder === undefined)
    throw new Error("an invite was read outside the provider that holds it");
  return holder;
}

function InviteCard(props: {
  readonly line: string;
  readonly action?: string;
  readonly onAction?: () => void;
  readonly media?: ReactNode;
}): ReactNode {
  const { action, onAction } = props;
  return (
    <SessionCard
      title="chuggy"
      detail={props.line}
      media={props.media}
      action={
        action === undefined || onAction === undefined ? undefined : (
          <Button variant="primary" onClick={onAction}>
            {action}
          </Button>
        )
      }
    />
  );
}

/** A person the sign-in service would not register, whose cookie is gone before they can sign in again. */
function InviteNeeded(props: {
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const session = useSessionHolder();
  const { domain } = props;
  useEffect(() => {
    invite.cookieClear(domain);
  }, [invite, domain]);
  return (
    <InviteCard
      line={invitePageWords.needed}
      action={invitePageWords.signIn}
      onAction={() => {
        void session.signIn(inviteElsewherePath);
      }}
    />
  );
}

function InviteElsewhere(): ReactNode {
  const invite = useInviteHolder();
  useEffect(() => {
    invite.elsewhere();
  }, [invite]);
  return null;
}

/** The answer one attempt at a redemption came to, none while it is unanswered. */
function useInviteRedemption(
  token: string,
  domain: string | undefined,
): {
  readonly redemption: InviteRedemption | undefined;
  readonly retry: () => void;
} {
  const invite = useInviteHolder();
  const ports = useApiPorts();
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<{
    readonly attempt: number;
    readonly redemption: InviteRedemption;
  }>();
  useEffect(() => {
    let mounted = true;
    void invite
      .redeem(token, domain, (sent) => apiRedeemInviteLink(ports, sent))
      .then((redemption) => {
        if (mounted) setAnswered({ attempt, redemption });
      });
    return () => {
      mounted = false;
    };
  }, [invite, ports, token, domain, attempt]);
  return {
    redemption: answered?.attempt === attempt ? answered.redemption : undefined,
    retry: () => {
      invite.retry();
      setAttempt(attempt + 1);
    },
  };
}

function InviteRedeeming(props: {
  readonly token: string;
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const { redemption, retry } = useInviteRedemption(props.token, props.domain);
  if (redemption === undefined || redemption.outcome === "Redeemed")
    return (
      <InviteCard line={invitePageWords.redeeming} media={<Locomotive />} />
    );
  if (redemption.outcome === "NotValid")
    return (
      <InviteCard
        line={invitePageWords.notValid}
        action={invitePageWords.open}
        onAction={invite.elsewhere}
      />
    );
  return (
    <InviteCard
      line={redemption.line}
      action={invitePageWords.retry}
      onAction={retry}
    />
  );
}

export function InvitePage(): ReactNode {
  const invite = useInviteHolder();
  const session = useSessionHolder();
  const snapshot = useSessionSnapshot();
  const domain = snapshot.configuration?.inviteCookieDomain;
  const opened = invite.opened(snapshot.phase === "SignedIn");
  switch (opened.page) {
    case "Needed":
      return <InviteNeeded domain={domain} />;
    case "Elsewhere":
      return <InviteElsewhere />;
    case "SignedOut":
      return <SignedOutCard />;
    case "Invited":
      return (
        <InviteCard
          line={invitePageWords.invited}
          action={invitePageWords.signIn}
          onAction={() => {
            invite.leave(opened.token, domain);
            void session.signIn(inviteRoutePath);
          }}
        />
      );
    case "Redeeming":
      return <InviteRedeeming token={opened.token} domain={domain} />;
  }
}
