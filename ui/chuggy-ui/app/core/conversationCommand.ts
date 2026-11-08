/**
 * What the composer's `/` list offers, when it opens, and which typed messages
 * are a command rather than words for the agent.
 *
 * A COMMAND IS THE WHOLE BOX. The list opens only while everything typed is a
 * `/` and the start of a command's name, so a `/` further into a sentence, or
 * one that begins a path no command is named by, is text like any other and
 * Enter sends it.
 *
 * A COMMAND RUNS HERE AND IS NEVER SENT. Picking one out of the list runs it,
 * and so does sending a box that holds a command's name and nothing else, which
 * is what a member who closed the list or typed past it has written.
 */

import type { Copy, CopyText } from "./copy.ts";

/** Every command the composer knows, in the order the list offers them: the
 * one that closes the thread is last, so Enter on a bare `/` reads instead. */
export const conversationCommandNames = ["status", "usage", "clear"] as const;

export type ConversationCommandName = (typeof conversationCommandNames)[number];

/** The character that opens the list, which is also what a member deletes to
 * close it. */
export const conversationCommandChar = "/";

/** One offered command, in the shape the popover takes. */
export interface ConversationCommandItem {
  readonly id: ConversationCommandName;
  readonly type: "command";
  readonly label: string;
  readonly description: string;
}

/** What each command does, in the words the list shows beside its name. */
function conversationCommandDescription(name: ConversationCommandName): Copy {
  switch (name) {
    case "status":
      return { id: "chat-command-status" };
    case "usage":
      return { id: "chat-command-usage" };
    case "clear":
      return { id: "chat-command-clear" };
  }
}

/** A command as the console writes it everywhere, which is what a member types. */
export function conversationCommandLabel(
  name: ConversationCommandName,
): string {
  return `${conversationCommandChar}${name}`;
}

export function conversationCommandItem(
  name: ConversationCommandName,
  text: CopyText,
): ConversationCommandItem {
  return {
    id: name,
    type: "command",
    label: conversationCommandLabel(name),
    description: text(conversationCommandDescription(name)),
  };
}

/** The offered commands whose name begins with what was typed after the `/`,
 * in the order they are offered. */
function conversationCommandNamesFiltered(
  offered: readonly ConversationCommandName[],
  query: string,
): readonly ConversationCommandName[] {
  const lowered = query.toLowerCase();
  return offered.filter((name) => name.startsWith(lowered));
}

/** The offered commands `conversationCommandNamesFiltered` keeps, as the
 * list offers each. */
export function conversationCommandFiltered(
  offered: readonly ConversationCommandName[],
  query: string,
  text: CopyText,
): readonly ConversationCommandItem[] {
  return conversationCommandNamesFiltered(offered, query).map((name) =>
    conversationCommandItem(name, text),
  );
}

/** What the popover replaces and what it searches on. */
export interface ConversationCommandMatch {
  readonly query: string;
  readonly offset: number;
  readonly endOffset: number;
}

/**
 * The command the box is part way through, spanning the whole box so a pick
 * leaves it empty, or nothing where the box is not a `/` and the start of an
 * offered command's name. A caret on the `/` is outside the command, which is
 * how escape closes: the library answers it by moving the caret there.
 */
export function conversationCommandMatch(
  offered: readonly ConversationCommandName[],
  text: string,
  triggerChar: string,
  cursorPosition: number,
): ConversationCommandMatch | null {
  if (!text.startsWith(triggerChar)) return null;
  if (cursorPosition < triggerChar.length) return null;
  const query = text.slice(triggerChar.length);
  if (/\s/u.test(query)) return null;
  if (conversationCommandNamesFiltered(offered, query).length === 0)
    return null;
  return { query, offset: 0, endOffset: text.length };
}

/** The offered command a sent box names and nothing else, in any case as the
 * list matches it, or nothing where the box is words for the agent. */
export function conversationCommandTyped(
  offered: readonly ConversationCommandName[],
  text: string,
): ConversationCommandName | undefined {
  const trimmed = text.trim().toLowerCase();
  return offered.find((name) => trimmed === conversationCommandLabel(name));
}

/** The offered command a picked item stands for. */
export function conversationCommandPicked(
  offered: readonly ConversationCommandName[],
  item: { readonly id: string },
): ConversationCommandName | undefined {
  return offered.find((name) => name === item.id);
}
