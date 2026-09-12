/**
 * The chat pane's state as the shell holds it: read from the store once, and
 * written back on every move.
 *
 * The frame draws from it and the pane's own controls move it, and the two are
 * far enough apart in the tree that passing it down would thread it through
 * every part between them. A store a browser refuses is read as empty and
 * written to in vain, so what a reader is looking at is the state held here and
 * never a re-read.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { chatPaneRead, chatPaneWrite } from "../../core/chatPane.ts";
import type { ChatPaneState } from "../../core/chatPane.ts";
import { persistentStore } from "../ports.ts";

interface ChatPaneHeld {
  readonly state: ChatPaneState;
  readonly moveTo: (next: ChatPaneState) => void;
}

const chatPaneContext = createContext<ChatPaneHeld | undefined>(undefined);

export function ChatPaneProvider(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [state, setState] = useState<ChatPaneState>(() =>
    chatPaneRead(persistentStore),
  );
  const moveTo = useCallback((next: ChatPaneState) => {
    chatPaneWrite(persistentStore, next);
    setState(next);
  }, []);
  const held = useMemo<ChatPaneHeld>(
    () => ({ state, moveTo }),
    [state, moveTo],
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
