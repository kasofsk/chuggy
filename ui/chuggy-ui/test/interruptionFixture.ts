/**
 * What the runtime writes to a session's store where a turn is interrupted,
 * copied from a recording of one: lines in the member's role that nobody
 * typed, and the line it writes in the assistant's when the session is next
 * resumed. A hand-written shape would prove the reader against what its author
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

/** What the runtime puts where a model's name goes on a line it wrote
 * itself. */
export const fillerModel = "<synthetic>";

/** What the runtime writes for the assistant when it resumes a session whose
 * last turn ended without an answer. */
export const fillerSentence = "No response requested.";

/** What the runtime wrote, under the same mark, of a request the API
 * refused. */
export const fillerRefusedSentence =
  "There's an issue with the selected model (claude-no-such-model-0). It may not exist or you may not have access to it.";

/** The message of an assistant's line as the store holds it whole: the
 * runtime's filler, unless a case names another writer or other words. */
export function fillerMessage(
  model: string = fillerModel,
  text: string = fillerSentence,
): unknown {
  return {
    id: "be636f96-259f-4c20-baab-435e7ea1f24c",
    container: null,
    model,
    role: "assistant",
    stop_reason: "stop_sequence",
    stop_sequence: "",
    type: "message",
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: "text", text }],
    context_management: null,
  };
}
