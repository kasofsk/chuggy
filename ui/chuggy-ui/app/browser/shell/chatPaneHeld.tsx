/**
 * The chat pane's state as the shell holds it: read from the store once, and
 * held as the core says on every move, which writes it back only where the
 * viewport divides. A viewport that changes width redraws it.
 *
 * The frame draws from it and the pane's own controls move it, and the two are
 * far enough apart in the tree that passing it down would thread it through
 * every part between them. A store a browser refuses is read as empty and
 * written to in vain, so what a reader is looking at is the state held here and
 * never a re-read.
 *
 * The thread the reader picked is held here too, and in no store: the pane is
 * not drawn on a thread's own page, and returning from one draws it holding
 * that pick again. So is the thread the pane holds for a reader who picked
 * none, for the same reason.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  chatPaneHoldRead,
  chatPaneHoldState,
  chatPaneHoldWritten,
  chatPaneYielded,
} from "../../core/chatPane.ts";
import type { ChatPaneChosen, ChatPaneState } from "../../core/chatPane.ts";
import { persistentStore } from "../ports.ts";

interface ChatPaneHeld {
  readonly state: ChatPaneState;
  readonly twoColumn: boolean;
  readonly moveTo: (next: ChatPaneState) => void;
  readonly chosen: ChatPaneChosen | undefined;
  readonly choose: (next: ChatPaneChosen) => void;
  readonly defaulted: ChatPaneChosen | undefined;
  readonly holdDefault: (next: ChatPaneChosen | undefined) => void;
}

const chatPaneContext = createContext<ChatPaneHeld | undefined>(undefined);

export function ChatPaneProvider(props: {
  readonly twoColumn: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const twoColumn = props.twoColumn;
  const [hold, setHold] = useState(() => chatPaneHoldRead(persistentStore));
  const state = chatPaneHoldState(hold, twoColumn);
  const moveTo = useCallback(
    (next: ChatPaneState) => {
      setHold(chatPaneHoldWritten(persistentStore, hold, next, twoColumn));
    },
    [hold, twoColumn],
  );
  const [chosen, choose] = useState<ChatPaneChosen | undefined>(undefined);
  const [defaulted, holdDefault] = useState<ChatPaneChosen | undefined>(
    undefined,
  );
  const held = useMemo<ChatPaneHeld>(
    () => ({
      state,
      twoColumn,
      moveTo,
      chosen,
      choose,
      defaulted,
      holdDefault,
    }),
    [state, twoColumn, moveTo, chosen, defaulted],
  );
  return (
    <chatPaneContext.Provider value={held}>
      {props.children}
    </chatPaneContext.Provider>
  );
}

export function useChatPane(): ChatPaneHeld {
  const held = useContext(chatPaneContext);
  if (held === undefined)
    throw new Error("a chat pane control was drawn outside the shell");
  return held;
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
