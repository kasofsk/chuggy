/**
 * The page an invite link is opened at, drawn the same with a session and
 * without one: a title for the state the link is in, one line, what to do next
 * where a send was refused, and at most one action. Without one, the card is
 * what the plane's summary of the link says it gives and from whom, read as
 * the card is drawn and again at a retry, and, where the deployment asks for
 * agreement, the policies signing in asks for, read once beside it and drawn
 * only where that read lists any.
 *
 * It reads no router, because the tree's root draws it for a browser that
 * holds no session and has no router, and the route draws it for a reader.
 * What it draws and what it does to the cookie are decided in
 * `ui/chuggy-ui/app/core/invitePage.ts`; what must outlive a mount, the token
 * and the one send made for it, is the holder's, handed down from the process
 * root.
 *
 * NOTHING HERE LEAVES THE PAGE WITHOUT A PRESS but a redemption the plane
 * took. A person the sign-in service refused is drawn a page and not sent
 * round again.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { AccessInviteLinkSummary } from "../../../../src/contract/accessPlane.ts";
import {
  agreementPlaneRoutes,
  type AgreementPolicies,
  type AgreementPolicyEntry,
} from "../../../../src/contract/agreementPlane.ts";

import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  apiInviteLinkSummary,
  apiRedeemInviteLink,
} from "../core/accessRoutes.ts";
import { apiAgreementPolicies } from "../core/agreementRoutes.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { ConsoleWriteRefused, consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy, CopyOrData, CopyText } from "../core/copy.ts";
import type { InviteHolder } from "../core/inviteHolder.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import {
  inviteAgreementPolicies,
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
import { ExternalLink } from "./ui/ExternalLink.tsx";
import { Locomotive } from "./ui/Locomotive.tsx";

/** What each state of the page is for, said as its title. */
const invitePageTitles = {
  needed: { id: "settings-invite-needed-title" },
  redeeming: { id: "settings-invite-joining-title" },
  notValid: { id: "settings-invite-not-valid-title" },
  failed: { id: "settings-invite-failed-title" },
} as const satisfies Readonly<Record<string, Copy>>;

/** What a reader whose send failed does next, said under why. */
const inviteFailedNext: Copy = { id: "settings-invite-failed-next" };

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
  readonly title: Copy;
  readonly line: CopyOrData;
  readonly next?: Copy;
  readonly action?: Copy;
  readonly onAction?: () => void;
  readonly media?: ReactNode;
  readonly notes?: ReactNode;
}): ReactNode {
  const { action, onAction } = props;
  const text = useCopyText();
  return (
    <SessionCard
      title={text(props.title)}
      detail={copyOrDataText(text, props.line)}
      next={props.next === undefined ? undefined : text(props.next)}
      notes={props.notes}
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
      title={invitePageTitles.needed}
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

/** What `read` answers for `key`, held as the page's own state: undefined
 * where there is no key or while the latest read of it is unanswered, and the
 * retry that reads it again. `read` is a module's function, so a draw does
 * not read again. */
function useInviteRead<T>(
  key: string | undefined,
  read: (ports: ApiPorts, key: string) => Promise<ApiResult<T>>,
): {
  readonly answer: ApiResult<T> | undefined;
  readonly retry: () => void;
} {
  const ports = useApiPorts();
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly attempt: number;
    readonly result: ApiResult<T>;
  }>();
  useEffect(() => {
    if (key === undefined) return;
    let current = true;
    void read(ports, key).then((result) => {
      if (current) setAnswered({ key, attempt, result });
    });
    return () => {
      current = false;
    };
  }, [ports, key, attempt, read]);
  return {
    answer:
      key !== undefined && answered?.key === key && answered.attempt === attempt
        ? answered.result
        : undefined,
    retry: () => {
      setAttempt((last) => last + 1);
    },
  };
}

/** The plane's summary of `token`, undefined while the latest read of it is
 * unanswered, and the retry that reads it again. */
function useInviteSummary(token: string): {
  readonly summary: ApiResult<AccessInviteLinkSummary> | undefined;
  readonly retry: () => void;
} {
  const { answer, retry } = useInviteRead(token, apiInviteLinkSummary);
  return { summary: answer, retry };
}

/** The deployment's policies where its configuration asks for agreement,
 * read once with the card and never retried. */
function useInviteAgreements(
  agreements: boolean,
): ApiResult<AgreementPolicies> | undefined {
  return useInviteRead(
    agreements ? agreementPlaneRoutes.policies.path : undefined,
    apiAgreementPolicies,
  ).answer;
}

/** The lines an open card names the policies in, each a link to its text. */
function InviteAgreements(props: {
  readonly policies: readonly AgreementPolicyEntry[];
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <p>{text(invitePageWords.agreements)}</p>
      <p className="flex flex-wrap gap-x-4">
        {props.policies.map((entry) => (
          <ExternalLink key={entry.policy} href={entry.url}>
            {entry.title}
          </ExternalLink>
        ))}
      </p>
    </>
  );
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
  const agreements = useSessionSnapshot().configuration?.agreements === true;
  const policies = inviteAgreementPolicies(useInviteAgreements(agreements));
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
          notes={
            policies === undefined ? undefined : (
              <InviteAgreements policies={policies} />
            )
          }
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
        title={invitePageTitles.notValid}
        line={invitePageWords.notValid}
        action={invitePageWords.open}
        onAction={invite.elsewhere}
      />
    ) : (
      <InviteCard
        title={invitePageTitles.failed}
        line={refused.message}
        next={inviteFailedNext}
        action={invitePageWords.retry}
        onAction={retry}
      />
    );
  return (
    <InviteCard
      title={invitePageTitles.redeeming}
      line={invitePageWords.redeeming}
      media={<Locomotive />}
    />
  );
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
