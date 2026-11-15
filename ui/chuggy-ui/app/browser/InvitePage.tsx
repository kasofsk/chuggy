/**
 * The page an invite link is opened at, drawn the same with a session and
 * without one: a card, one line, and at most one action.
 *
 * It reads no router, because the tree's root draws it for a browser that
 * holds no session and has no router, and the route draws it for a reader.
 * What it draws and what it does to the cookie are decided in
 * `ui/chuggy-ui/app/core/invitePage.ts`; what must outlive a mount, the token
 * and the one send made for it, is the holder's, handed down from the process
 * root.
 *
 * NOTHING HERE LEAVES THE PAGE WITHOUT A PRESS but a redemption the plane
 * took, a link that makes a workspace among them. A person the sign-in
 * service refused is drawn a card and not sent round again.
 */

import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import { apiRedeemInviteLink } from "../core/accessRoutes.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { ConsoleWriteRefused, consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy, CopyOrData, CopyText } from "../core/copy.ts";
import type { InviteHolder } from "../core/inviteHolder.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import { inviteElsewherePath, invitePageWords } from "../core/invitePage.ts";
import type { InviteRedemption } from "../core/invitePage.ts";
import { accessFailureLabel } from "../core/tenantPeople.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
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
  readonly line: CopyOrData;
  readonly action?: Copy;
  readonly onAction?: () => void;
  readonly media?: ReactNode;
}): ReactNode {
  const { action, onAction } = props;
  const text = useCopyText();
  return (
    <SessionCard
      title={text(invitePageWords.brand)}
      detail={copyOrDataText(text, props.line)}
      media={props.media}
      action={
        action === undefined || onAction === undefined ? undefined : (
          <Button variant="primary" onClick={onAction}>
            {text(action)}
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

/** How a send of the token that leaves the reader here is drawn: a link no
 * retry mends, or a failure the reader may retry. */
type InviteRefusal = "NotValid" | "Failed";

/** A send of the token the plane answered without letting the reader on, in
 * the line the page draws for it. */
class InviteRefused extends ConsoleWriteRefused {
  readonly refusal: InviteRefusal;

  constructor(refusal: InviteRefusal, sentence: string) {
    super(sentence);
    this.refusal = refusal;
  }
}

/** Anything that is not an `InviteRefused` failed, and its retry may mend it. */
function inviteRefusalOf(refused: ConsoleWriteRefused): InviteRefusal {
  return refused instanceof InviteRefused ? refused.refusal : "Failed";
}

/** A send's answer as a write's: one that lets the reader on answered, and
 * any other thrown as the refusal it is drawn as. */
function inviteAnswered(
  came: InviteRedemption,
  text: CopyText,
): ApiResult<InviteRedemption> {
  switch (came.outcome) {
    case "Redeemed":
      return { outcome: "Ok", value: came };
    case "NotValid":
      throw new InviteRefused("NotValid", text(invitePageWords.notValid));
    case "Failed":
      throw new InviteRefused("Failed", text(came.line));
  }
}

/** The send of a token, which the holder makes once however many writes ask
 * for it. */
function inviteRedemptionWrite(
  invite: InviteHolder,
  token: string,
  domain: string | undefined,
  text: CopyText,
): ConsoleWrite<undefined, InviteRedemption> {
  return {
    mutationKey: consoleWriteKey("invite-redemption"),
    write: async (ports) =>
      inviteAnswered(
        await invite.redeem(token, domain, (sent) =>
          apiRedeemInviteLink(ports, sent),
        ),
        text,
      ),
    refusal: (failure) => text(accessFailureLabel(failure)),
  };
}

/** What the latest attempt at the send was refused with, none while it is
 * unanswered or once it lets the reader on. */
function useInviteRedemption(
  token: string,
  domain: string | undefined,
): {
  readonly refused: ConsoleWriteRefused | null;
  readonly retry: () => void;
} {
  const invite = useInviteHolder();
  const text = useCopyText();
  const redeeming = useConsoleWrite(
    inviteRedemptionWrite(invite, token, domain, text),
    { drawn: true },
  );
  const { mutate } = redeeming;
  useEffect(() => {
    mutate(undefined);
  }, [mutate, token, domain]);
  return {
    refused: redeeming.error,
    retry: () => {
      invite.retry();
      mutate(undefined);
    },
  };
}

function InviteRedeeming(props: {
  readonly token: string;
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const { refused, retry } = useInviteRedemption(props.token, props.domain);
  if (refused !== null)
    return inviteRefusalOf(refused) === "NotValid" ? (
      <InviteCard
        line={invitePageWords.notValid}
        action={invitePageWords.open}
        onAction={invite.elsewhere}
      />
    ) : (
      <InviteCard
        line={refused.message}
        action={invitePageWords.retry}
        onAction={retry}
      />
    );
  return <InviteCard line={invitePageWords.redeeming} media={<Locomotive />} />;
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
