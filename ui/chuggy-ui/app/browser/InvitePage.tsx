/**
 * The page an invite link is opened at, drawn the same with a session and
 * without one: a card, one line, and at most one action. Without one, the
 * card is what the plane's summary of the link says it gives and from whom,
 * read as the card is drawn and again at a retry.
 *
 * It reads no router, because the tree's root draws it for a browser that
 * holds no session and has no router, and the route draws it for a reader.
 * What it draws and what it does to the cookie are decided in
 * `ui/chuggy-ui/app/core/invitePage.ts`; what must outlive a mount, the token
 * and the one send made for it, is the holder's, handed down from the process
 * root.
 *
 * NOTHING HERE LEAVES THE PAGE WITHOUT A PRESS but a redemption the plane
 * took. A person the sign-in service refused is drawn a card and not sent
 * round again.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { AccessInviteLinkSummary } from "../../../../src/contract/accessPlane.ts";

import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  apiInviteLinkSummary,
  apiRedeemInviteLink,
} from "../core/accessRoutes.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { ConsoleWriteRefused, consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy, CopyOrData, CopyText } from "../core/copy.ts";
import type { InviteHolder } from "../core/inviteHolder.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import {
  inviteElsewherePath,
  invitePageWords,
  inviteSummaryCard,
} from "../core/invitePage.ts";
import type { InviteRedemption } from "../core/invitePage.ts";
import { accessFailureLabel } from "../core/tenantPeople.ts";
import { useApiPorts } from "./api.ts";
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
  readonly title?: Copy;
  readonly line: CopyOrData;
  readonly action?: Copy;
  readonly onAction?: () => void;
  readonly media?: ReactNode;
}): ReactNode {
  const { action, onAction } = props;
  const text = useCopyText();
  return (
    <SessionCard
      title={text(props.title ?? invitePageWords.brand)}
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
 * unanswered or once the reader is leaving for what it granted. */
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

/** The plane's summary of `token`, undefined while the latest read of it is
 * unanswered, and the retry that reads it again. */
function useInviteSummary(token: string): {
  readonly summary: ApiResult<AccessInviteLinkSummary> | undefined;
  readonly retry: () => void;
} {
  const ports = useApiPorts();
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<{
    readonly token: string;
    readonly attempt: number;
    readonly result: ApiResult<AccessInviteLinkSummary>;
  }>();
  useEffect(() => {
    let current = true;
    void apiInviteLinkSummary(ports, token).then((result) => {
      if (current) setAnswered({ token, attempt, result });
    });
    return () => {
      current = false;
    };
  }, [ports, token, attempt]);
  return {
    summary:
      answered?.token === token && answered.attempt === attempt
        ? answered.result
        : undefined,
    retry: () => {
      setAttempt((last) => last + 1);
    },
  };
}

/** A link opened with no session: what it gives and from whom, and the
 * sign-in that carries its token across in the cookie. */
function InviteInvited(props: {
  readonly token: string;
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const session = useSessionHolder();
  const { token, domain } = props;
  const { summary, retry } = useInviteSummary(token);
  const drawn = inviteSummaryCard(summary);
  switch (drawn.card) {
    case "Reading":
      return (
        <InviteCard
          title={drawn.title}
          line={drawn.line}
          media={<Locomotive />}
        />
      );
    case "Open":
      return (
        <InviteCard
          title={drawn.title}
          line={drawn.line}
          action={invitePageWords.signInGithub}
          onAction={() => {
            invite.leave(token, domain);
            void session.signIn(inviteRoutePath);
          }}
        />
      );
    case "Ended":
      return <InviteCard title={drawn.title} line={drawn.line} />;
    case "Failed":
      return (
        <InviteCard
          title={drawn.title}
          line={drawn.line}
          action={invitePageWords.retry}
          onAction={retry}
        />
      );
  }
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
      return <InviteInvited token={opened.token} domain={domain} />;
    case "Redeeming":
      return <InviteRedeeming token={opened.token} domain={domain} />;
  }
}
