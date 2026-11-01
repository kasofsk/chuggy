/**
 * The chat pane's state as the shell draws it: the hold the store keeps, and
 * whether the viewport divides, which is a measurement and so stays out of the
 * store. A viewport that changes width redraws it.
 */

import { chatPaneHoldState, chatPaneYielded } from "../../core/chatPane.ts";
import type { ChatPaneState } from "../../core/chatPane.ts";
import { useConsoleDispatch, useConsoleSelector } from "../store.ts";
import { chatPaneHoldOf, chatPaneMoved } from "./chatPanes.ts";
import { useViewportAtLeastEm, viewportTwoColumnEm } from "./viewport.ts";

interface ChatPaneHeld {
  readonly state: ChatPaneState;
  readonly twoColumn: boolean;
  readonly moveTo: (next: ChatPaneState) => void;
}

export function useChatPane(): ChatPaneHeld {
  const twoColumn = useViewportAtLeastEm(viewportTwoColumnEm);
  const hold = useConsoleSelector(chatPaneHoldOf);
  const dispatch = useConsoleDispatch();
  return {
    state: chatPaneHoldState(hold, twoColumn),
    twoColumn,
    moveTo: (next) => {
      dispatch(chatPaneMoved(next, twoColumn));
    },
  };
}

/**
 * What pressing for a screen does to the pane: one that had filled the body
 * goes back beside the pages, or to the strip where the viewport does not
 * divide, since the reader is asking to see the screen. A pane the reader put
 * away stays away — that press was theirs too.
 */
export function useChatPaneYields(): () => void {
  const held = useChatPane();
  return () => {
    const yielded = chatPaneYielded(held.state, held.twoColumn);
    if (yielded !== held.state) held.moveTo(yielded);
  };
}
