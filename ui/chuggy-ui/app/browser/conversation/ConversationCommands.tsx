/**
 * The list a `/` opens over the composer, and what picking out of it runs.
 *
 * EVERYTHING BUT THE MATCHING IS THE LIBRARY'S, as it is for the `@` list: the
 * popover, the arrow keys, the tab and enter that take the highlighted item,
 * the escape that closes, and the removal of the typed command are all
 * `@assistant-ui/react`'s action trigger, and this supplies the commands, the
 * matcher that opens the list only over a box that is a command, and the run.
 *
 * A PICK RUNS ON THE PAGE AND LEAVES THE BOX EMPTY. The page owns what a
 * command does, so a pick is handed up by name, and nothing of it is sent.
 */

import { ComposerPrimitive } from "@assistant-ui/react";
import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";

import {
  conversationCommandChar,
  conversationCommandFiltered,
  conversationCommandMatch,
  conversationCommandPicked,
} from "../../core/conversationCommand.ts";
import type { ConversationCommandName } from "../../core/conversationCommand.ts";
import {
  ConversationTriggerItems,
  conversationTriggerListClass,
} from "./ConversationTriggerItems.tsx";

import "./conversation.css";

export function ConversationCommandsOffered(props: {
  readonly offered: readonly ConversationCommandName[];
  readonly onCommand: (name: ConversationCommandName) => void;
}): ReactNode {
  const { offered, onCommand } = props;
  const adapter = useMemo(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (typed: string) => conversationCommandFiltered(offered, typed),
    }),
    [offered],
  );
  const matcher = useCallback(
    (text: string, triggerChar: string, cursorPosition: number) =>
      conversationCommandMatch(offered, text, triggerChar, cursorPosition),
    [offered],
  );
  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      char={conversationCommandChar}
      matcher={matcher}
      adapter={adapter}
      className={conversationTriggerListClass}
    >
      <ComposerPrimitive.Unstable_TriggerPopover.Action
        removeOnExecute
        onExecute={(item) => {
          const name = conversationCommandPicked(offered, item);
          if (name !== undefined) onCommand(name);
        }}
      />
      <ConversationTriggerItems />
    </ComposerPrimitive.Unstable_TriggerPopover>
  );
}
