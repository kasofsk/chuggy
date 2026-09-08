/**
 * The engine that runs above the composer while a turn is out, so a member
 * watching a thread sees motion for the whole time the surface is waiting on
 * it, not only at first paint.
 *
 * THE STRIP HOLDS ITS HEIGHT WHETHER OR NOT THE ENGINE IS DRAWN. It is always
 * mounted wherever a composer is, so the composer never shifts when a turn
 * starts or settles — only the engine inside the strip comes and goes.
 *
 * The crossing itself is `conversation.css`'s `@layer page`: a `@keyframes`
 * rule the strip's own width bounds in percentages, so nothing here measures
 * a width, holds one in state, or drives the motion from a timer.
 */

import type { ReactNode } from "react";

import { LocomotiveEngine } from "../ui/Locomotive.tsx";

export function ConversationWaiting(props: {
  /** Whether an exchange is `Running`, or a send is out — named once by the
   * caller so this component does not recompute either. */
  readonly waiting: boolean;
}): ReactNode {
  return (
    <div className="conversation-waiting">
      {props.waiting ? (
        <div
          className="conversation-waiting-engine"
          role="img"
          aria-label="chuggy is working"
        >
          <LocomotiveEngine />
        </div>
      ) : null}
    </div>
  );
}
