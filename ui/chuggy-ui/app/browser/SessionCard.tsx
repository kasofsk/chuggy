/**
 * The page a reader is drawn where there is no console to draw: a title, what
 * happened, what to do next where there is something to do, and at most one
 * action, which is that.
 *
 * The signed-out page is drawn by two callers, the tree's root and the invite
 * page a reader opens with no link, so it is here once. Its sign-in names the
 * page it was pressed on, because the issuer redirects to the one address this
 * client is registered with: a page reached with a query it needs — the
 * forge's setup return — would otherwise come back without it.
 *
 * A session that ended because another tab signed in is the one case with a
 * session to come back to without signing in: the browser already holds it,
 * and the document loaded again is that session's. So that page offers the
 * reload, and a sign-in pressed there would end the other tab's in its turn.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import { copyOrDataText } from "../core/copy.ts";
import { sessionChangedReason } from "../core/sessionHolder.ts";
import { currentPath, reloadLocation } from "./ports.ts";
import { useSessionHolder, useSessionSnapshot } from "./session.tsx";
import { Button } from "./ui/Button.tsx";
import { CenteredPage } from "./ui/CenteredPage.tsx";

export function SessionCard(props: {
  readonly title: string;
  readonly detail: string;
  readonly next?: string | undefined;
  readonly media?: ReactNode;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <CenteredPage
      landmark
      title={props.title}
      mark={props.media}
      primary={props.action}
    >
      <p>{props.detail}</p>
      {props.next === undefined ? null : <p>{props.next}</p>}
    </CenteredPage>
  );
}

/** The page of a browser that holds no session, with the reason it was ended where there is one. */
export function SignedOutCard(): ReactNode {
  const holder = useSessionHolder();
  const snapshot = useSessionSnapshot();
  const text = useCopyText();
  const changed = snapshot.reason === sessionChangedReason;
  const ended = snapshot.reason !== undefined;
  return (
    <SessionCard
      title={text(
        changed
          ? { id: "session-changed-title" }
          : { id: "session-sign-in-title" },
      )}
      detail={copyOrDataText(
        text,
        snapshot.reason ?? { id: "session-signed-out" },
      )}
      next={
        changed
          ? text({ id: "session-changed-next" })
          : ended
            ? text({ id: "session-signed-out-next" })
            : undefined
      }
      action={
        <Button
          variant="primary"
          onClick={() => {
            if (changed) reloadLocation();
            else void holder.signIn(currentPath());
          }}
        >
          {text(changed ? { id: "session-reload" } : { id: "session-sign-in" })}
        </Button>
      }
    />
  );
}
