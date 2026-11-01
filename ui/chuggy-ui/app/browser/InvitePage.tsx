/**
 * The page an invite link is opened at, drawn the same with a session and
 * without one: a card, one line, and at most one action, which for a link that
 * makes a workspace is the form that names it.
 *
 * It reads no router, because the tree's root draws it for a browser that
 * holds no session and has no router, and the route draws it for a reader.
 * What it draws and what it does to the cookie are decided in
 * `ui/chuggy-ui/app/core/invitePage.ts`; what must outlive a mount, the token
 * and the one send made for it without a name, is the holder's, handed down
 * from the process root.
 *
 * NOTHING HERE LEAVES THE PAGE WITHOUT A PRESS but a redemption the plane
 * took. A person the sign-in service refused is drawn a card and not sent
 * round again, and a workspace's name is sent by a press of `Create` and by
 * nothing else: no effect sends one, so no mount does.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { apiRedeemInviteLink } from "../core/accessRoutes.ts";
import type { ApiResult } from "../core/apiRequest.ts";
import { ConsoleWriteRefused, consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import type { InviteHolder } from "../core/inviteHolder.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import {
  inviteElsewherePath,
  invitePageWords,
  inviteWorkspaceSendable,
} from "../core/invitePage.ts";
import type { InviteNaming, InviteRedemption } from "../core/invitePage.ts";
import { siteWorkspaceNameFault } from "../core/siteWorkspaces.ts";
import { accessFailureLabel } from "../core/tenantPeople.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import { SessionCard, SignedOutCard } from "./SessionCard.tsx";
import { useSessionHolder, useSessionSnapshot } from "./session.tsx";
import { InvitationText } from "./settings/InvitationFields.tsx";
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

const inviteCardTitle = "chuggy";

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
      title={inviteCardTitle}
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

/** How a send of the token that leaves the reader here is drawn: a link no
 * retry mends, a failure the reader may retry, or a name the field refuses. */
type InviteRefusal = "NotValid" | "Failed" | "Refused";

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

/** A send's answer as a write's: one that lets the reader on or asks for a
 * name answered, and any other thrown as the refusal it is drawn as. */
function inviteAnswered<Came extends InviteRedemption | InviteNaming>(
  came: Came,
): ApiResult<Came> {
  switch (came.outcome) {
    case "Redeemed":
    case "NameWanted":
      return { outcome: "Ok", value: came };
    case "NotValid":
      throw new InviteRefused("NotValid", invitePageWords.notValid);
    case "Failed":
      throw new InviteRefused("Failed", came.line);
    case "Refused":
      throw new InviteRefused("Refused", came.fault);
  }
}

/** The send of a token without a name, which the holder makes once however
 * many writes ask for it. */
function inviteRedemptionWrite(
  invite: InviteHolder,
  token: string,
  domain: string | undefined,
): ConsoleWrite<undefined, InviteRedemption> {
  return {
    mutationKey: consoleWriteKey("invite-redemption"),
    write: async (ports) =>
      inviteAnswered(
        await invite.redeem(token, domain, (sent) =>
          apiRedeemInviteLink(ports, sent),
        ),
      ),
    refusal: accessFailureLabel,
  };
}

/** One send of a token with the name of the workspace it makes. */
function inviteNamingWrite(
  invite: InviteHolder,
  token: string,
  domain: string | undefined,
): ConsoleWrite<string, InviteNaming> {
  return {
    mutationKey: consoleWriteKey("invite-naming"),
    write: async (ports, name) =>
      inviteAnswered(
        await invite.named(token, domain, name, (sent, workspace) =>
          apiRedeemInviteLink(ports, sent, workspace),
        ),
      ),
    refusal: accessFailureLabel,
  };
}

/** The answer the latest attempt at the send without a name came to, none
 * while it is unanswered. */
function useInviteRedemption(
  token: string,
  domain: string | undefined,
): {
  readonly redemption: InviteRedemption | undefined;
  readonly refused: ConsoleWriteRefused | null;
  readonly retry: () => void;
} {
  const invite = useInviteHolder();
  const redeeming = useConsoleWrite(
    inviteRedemptionWrite(invite, token, domain),
  );
  const { mutate } = redeeming;
  useEffect(() => {
    mutate(undefined);
  }, [mutate, token, domain]);
  return {
    redemption: redeeming.isSuccess ? redeeming.data : undefined,
    refused: redeeming.error,
    retry: () => {
      invite.retry();
      mutate(undefined);
    },
  };
}

interface InviteNamed {
  readonly name: string;
  /** A press unanswered, or answered by a workspace the reader is leaving for. */
  readonly sending: boolean;
  /** What the last press was refused with, until the name is changed. */
  readonly refused: ConsoleWriteRefused | null;
  readonly change: (name: string) => void;
  /** The name as it stands sent with the token, which only a press asks for. */
  readonly create: () => void;
}

function useInviteNaming(
  token: string,
  domain: string | undefined,
): InviteNamed {
  const invite = useInviteHolder();
  const [name, setName] = useState("");
  const naming = useConsoleWrite(inviteNamingWrite(invite, token, domain));
  const sending = naming.isPending || naming.isSuccess;
  return {
    name,
    sending,
    refused: naming.error,
    change: (changed) => {
      setName(changed);
      naming.reset();
    },
    create: () => {
      if (sending || !inviteWorkspaceSendable(name)) return;
      naming.mutate(name);
    },
  };
}

/** The card as a form: the field, under it what a workspace is until a fault stands there, and `Create`, which Enter in the field presses. */
function InviteNamingForm(props: { readonly named: InviteNamed }): ReactNode {
  const { name, sending, refused, change, create } = props.named;
  return (
    <SessionCard
      title={inviteCardTitle}
      detail={sending ? invitePageWords.creating : invitePageWords.naming}
      action={
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <InvitationText
            label={invitePageWords.workspaceName}
            value={name}
            fault={
              siteWorkspaceNameFault(name) ??
              (refused !== null && inviteRefusalOf(refused) === "Refused"
                ? refused.message
                : undefined)
            }
            about={invitePageWords.workspaceAbout}
            disabled={sending}
            onChange={change}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={sending || !inviteWorkspaceSendable(name)}
            busy={sending}
          >
            {invitePageWords.create}
          </Button>
        </form>
      }
    />
  );
}

/** A link that makes a workspace, from the plane asking for its name to the answer one press of `Create` came to. */
function InviteNamingCard(props: {
  readonly token: string;
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const named = useInviteNaming(props.token, props.domain);
  const refused = named.refused;
  const refusal = refused === null ? undefined : inviteRefusalOf(refused);
  if (refusal === "NotValid")
    return (
      <InviteCard
        line={invitePageWords.notValid}
        action={invitePageWords.open}
        onAction={invite.elsewhere}
      />
    );
  if (refused !== null && refusal === "Failed")
    return (
      <InviteCard
        line={refused.message}
        action={invitePageWords.retry}
        onAction={named.create}
      />
    );
  return <InviteNamingForm named={named} />;
}

function InviteRedeeming(props: {
  readonly token: string;
  readonly domain: string | undefined;
}): ReactNode {
  const invite = useInviteHolder();
  const { redemption, refused, retry } = useInviteRedemption(
    props.token,
    props.domain,
  );
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
  if (redemption?.outcome === "NameWanted")
    return <InviteNamingCard token={props.token} domain={props.domain} />;
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
