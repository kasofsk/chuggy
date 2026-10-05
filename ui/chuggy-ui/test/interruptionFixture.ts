/**
 * What the runtime writes to a session's store where a turn is interrupted,
 * copied from a recording of one: lines in the member's role that nobody
 * typed. A hand-written shape would prove the reader against what its author
 * expected rather than against what the store holds.
 */

export const interruptionSentence = "[Request interrupted by user]";

export const interruptionToolSentence =
  "[Request interrupted by user for tool use]";

/** The result the runtime gives the call it cut off. */
export const interruptionRefusal =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

/** The note itself, which is one text block and never a string. */
export function interruptionNote(sentence: string): unknown {
  return { role: "user", content: [{ type: "text", text: sentence }] };
}

/** A call's failed result saying `content`, which is the runtime's refusal of
 * a call it cut off unless a case says otherwise. */
export function interruptionResult(
  toolUse: string,
  content: string = interruptionRefusal,
): unknown {
  return {
    role: "user",
    content: [
      { type: "tool_result", content, is_error: true, tool_use_id: toolUse },
    ],
  };
}
