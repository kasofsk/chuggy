/**
 * The card a reader is drawn where there is no console to draw: a title, one
 * line, and at most one action.
 *
 * The signed-out card is drawn by two callers, the tree's root and the invite
 * page a reader opens with no link, so it is here once. Its sign-in names the
 * page it was pressed on, because the issuer redirects to the one address this
 * client is registered with: a page reached with a query it needs — the
 * forge's setup return — would otherwise come back without it.
 *
 * A session that ended because another tab signed in is the one case with a
 * session to come back to without signing in: the browser already holds it,
 * and the document loaded again is that session's. So that card offers the
 * reload, and a sign-in pressed there would end the other tab's in its turn.
 */

import type { ReactNode } from "react";

import { sessionChangedReason } from "../core/sessionHolder.ts";
import { currentPath, reloadLocation } from "./ports.ts";
import { useSessionHolder, useSessionSnapshot } from "./session.tsx";
import { Button } from "./ui/Button.tsx";

export function SessionCard(props: {
  readonly title: string;
  readonly detail: string;
  readonly media?: ReactNode;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div className="session-card">
      <h1>{props.title}</h1>
      {props.media}
      <p>{props.detail}</p>
      {props.action}
    </div>
  );
}

/** The card of a browser that holds no session, with the reason it was ended where there is one. */
export function SignedOutCard(): ReactNode {
  const holder = useSessionHolder();
  const snapshot = useSessionSnapshot();
  const changed = snapshot.reason === sessionChangedReason;
  return (
    <SessionCard
      title="chuggy"
      detail={snapshot.reason ?? "Signed out"}
      action={
        <Button
          variant="primary"
          onClick={() => {
            if (changed) reloadLocation();
            else void holder.signIn(currentPath());
          }}
        >
          {changed ? "Reload" : "Sign in"}
        </Button>
      }
    />
  );
}
