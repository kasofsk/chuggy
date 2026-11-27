/**
 * The gate a signed-in session passes before the router is drawn: the opening
 * card while the standing is unread where the deployment asks for agreement to
 * its policies, the page listing what is still to be agreed, the page saying
 * the standing could not be read, or the router. Where the deployment does not
 * ask, the gate stands passed from the first draw, and the page takes the
 * router's place only once the API refuses the person for want of agreement.
 *
 * Which of them is drawn, and what each says, is `core/agreementGate.ts`'s;
 * the read and the send are the store's, in `agreementGate.ts`. It reads no
 * router, being drawn before there is one, so its links are `ExternalLink`s.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import type { AgreementStandingEntry } from "../../../../src/contract/agreementPlane.ts";

import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  agreementGateDrawn,
  agreementGateOpened,
  agreementWords,
} from "../core/agreementGate.ts";
import type { AgreementNoticeDrawn } from "../core/agreementGate.ts";
import {
  agreementGateOf,
  agreementGateOpen,
  agreementSend,
  agreementStandingRead,
} from "./agreementGate.ts";
import { SessionOpeningCard } from "./SessionCard.tsx";
import { useSessionHolder } from "./session.tsx";
import { useConsoleDispatch, useConsoleSelector } from "./store.ts";
import { Button } from "./ui/Button.tsx";
import { CenteredPage } from "./ui/CenteredPage.tsx";
import { ExternalLink } from "./ui/ExternalLink.tsx";
import { Notice } from "./ui/Notice.tsx";

/** The quiet sign-out both pages offer beside their action, ending the
 * session as the account menu's does. */
function AgreementSignOut(): ReactNode {
  const holder = useSessionHolder();
  const text = useCopyText();
  return (
    <Button
      variant="quiet"
      onClick={() => {
        void holder.signOut();
      }}
    >
      {text(agreementWords.signOut)}
    </Button>
  );
}

/** Each policy as a link to its text, its version beside it. */
function AgreementPolicies(props: {
  readonly policies: readonly AgreementStandingEntry[];
}): ReactNode {
  return (
    <ul className="grid gap-2">
      {props.policies.map((entry) => (
        <li
          key={entry.policy}
          className="flex flex-wrap items-baseline gap-x-3"
        >
          <ExternalLink href={entry.url}>{entry.title}</ExternalLink>
          <span className="text-sm text-ink-3">{entry.version}</span>
        </li>
      ))}
    </ul>
  );
}

function AgreementAsked(props: {
  readonly policies: readonly AgreementStandingEntry[];
  readonly notice: AgreementNoticeDrawn | undefined;
  readonly busy: boolean;
}): ReactNode {
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  const { notice } = props;
  return (
    <CenteredPage
      landmark
      title={text(agreementWords.title)}
      primary={
        <Button
          variant="primary"
          busy={props.busy}
          disabled={props.busy}
          onClick={() => {
            void dispatch(agreementSend());
          }}
        >
          {text(agreementWords.agree)}
        </Button>
      }
      secondary={<AgreementSignOut />}
    >
      {notice === undefined ? null : (
        <Notice
          tone={notice.tone}
          role={notice.tone === "danger" ? "alert" : "status"}
          detail={text(notice.line)}
        />
      )}
      <p>{text(agreementWords.needed)}</p>
      <AgreementPolicies policies={props.policies} />
    </CenteredPage>
  );
}

function AgreementNotRead(props: { readonly busy: boolean }): ReactNode {
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  return (
    <CenteredPage
      landmark
      title={text(agreementWords.notReadTitle)}
      primary={
        <Button
          variant="primary"
          busy={props.busy}
          disabled={props.busy}
          onClick={() => {
            void dispatch(agreementStandingRead("Retry"));
          }}
        >
          {text(agreementWords.retry)}
        </Button>
      }
      secondary={<AgreementSignOut />}
    >
      <p>{text(agreementWords.notRead)}</p>
    </CenteredPage>
  );
}

/** `children`, the router, once the standing says every policy is agreed, or
 * at once where the deployment has not `asked`. */
export function AgreementGate(props: {
  readonly asked: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const dispatch = useConsoleDispatch();
  const gate = useConsoleSelector(agreementGateOf);
  const { asked } = props;
  useEffect(() => {
    void dispatch(agreementGateOpen(asked));
  }, [dispatch, asked]);
  const drawn = agreementGateDrawn(agreementGateOpened(gate, asked));
  switch (drawn.drawn) {
    case "Opening":
      return <SessionOpeningCard />;
    case "Page":
      return (
        <AgreementAsked
          policies={drawn.policies}
          notice={drawn.notice}
          busy={drawn.busy}
        />
      );
    case "NotRead":
      return <AgreementNotRead busy={drawn.busy} />;
    case "Router":
      return props.children;
  }
}
