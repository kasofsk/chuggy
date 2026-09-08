/**
 * The strip above the composer, holding its height whether or not the engine
 * is drawn in it, so a turn starting or ending never shifts the composer
 * beneath it.
 *
 * The crossing is a keyframe in `conversation.css`, not a value this
 * component measures: the strip's width belongs to layout, so no observer and
 * no style attribute feed it back into React as state. The engine drawn is
 * `Locomotive.tsx`'s own `LocomotiveEngine`, with no ground sliding under it —
 * that ground answers the Loading card's question, not this strip's.
 */

import type { ReactNode } from "react";

import { LocomotiveEngine } from "../ui/Locomotive.tsx";
import "./conversation.css";

export function ConversationWaiting(props: {
  readonly waiting: boolean;
}): ReactNode {
  return (
    <div className="conversation-waiting">
      {props.waiting ? (
        <div
          className="conversation-waiting-engine"
          role="img"
          aria-label="chuggy is under way"
        >
          <LocomotiveEngine />
        </div>
      ) : null}
    </div>
  );
}
